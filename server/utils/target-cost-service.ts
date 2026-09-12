import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityContext } from '../../app/lib/quantity/central-contract'
import type { TargetCostCommand, TargetCostCommandResult, TargetCostContext, TargetCostDetailRead, TargetCostFormRead, TargetCostProjectOption, TargetCostQuery } from '../../app/lib/target-cost/central-contract'
import type { BusinessSession } from './business-session'
import type { TargetCostActualFacts } from './target-cost-actual'
import { createHash } from 'node:crypto'
import { fetchRowById, hiddenCtesFor, restoreRecord, selectVisibleSql, softDelete, visibleCond } from '../../app/lib/db/soft-delete'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { persistTargetCostHeader } from '../../app/lib/target-cost/central-domain'
import { loadTargetCostHistory } from '../../app/lib/target-cost/central-history'
import { advanceTargetCostRevision, initializeTargetCostSchema, targetCostRevision } from '../../app/lib/target-cost/central-schema'
import { targetCostHeaderFromRow, targetCostItemFromRow } from '../../app/lib/target-cost/detail'
import { persistTargetCostItems, TargetCostItemValidationError } from '../../app/lib/target-cost/items'
import { loadTargetCostList } from '../../app/lib/target-cost/list'
import { generateId } from '../../app/lib/util/id'
import { buildTargetCostComparison } from './target-cost-actual'
import { applyBudgetFileChanges, loadBudgetFiles, readBudgetFileContent } from './target-cost-files'

export interface TargetCostProjectSource { projects: TargetCostProjectOption[], version: string, status: 'available' | 'forbidden' | 'unavailable', options?: TargetCostProjectOption[], optionsStatus?: 'available' | 'forbidden' | 'unavailable' }
export interface TargetCostServiceOptions {
  session: (sessionId?: string | null) => BusinessSession
  projects: (sessionId?: string | null) => TargetCostProjectSource | Promise<TargetCostProjectSource>
  actual: (projectId: string | null, sessionId?: string | null) => Promise<TargetCostActualFacts>
  transaction: <T>(work: (db: TransactionDb, context: QuantityContext) => Promise<T>, sessionId?: string | null) => Promise<T>
}
function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)).digest('hex')
}
function authorize(context: BusinessSession, write = false) {
  if (!context.capabilities.includes('target-cost:read') || (write && !context.capabilities.includes('target-cost:write')))
    throw targetCostProblem('forbidden', '当前身份无预算读取或维护权限')
}
function sameSession(left: BusinessSession, right: BusinessSession, write: boolean) {
  authorize(right, write)
  if (left.workspaceId !== right.workspaceId || left.actorId !== right.actorId || digest([...left.capabilities].sort()) !== digest([...right.capabilities].sort()))
    throw targetCostProblem('forbidden', '预算会话或权限已变化，请保留原草稿与提交编号')
}
async function syncProjects(db: TransactionDb, source: TargetCostProjectSource) {
  if (source.status !== 'available')
    return
  // 已受控授权的完整项目事实决定镜像资格；不以工程量项目表充当预算项目目录。
  const ids = new Set(source.projects.map(project => project.id))
  const existing = await db.select<{ id: string }>('SELECT id FROM projects')
  for (const row of existing) {
    if (!ids.has(row.id))
      await db.execute('UPDATE projects SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?', [new Date().toISOString(), row.id])
  }
  for (const project of source.projects) {
    await db.execute(`INSERT INTO projects(id, code, name) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, deleted_at = NULL`, [project.id, project.code, project.name])
  }
}
async function requireHead(db: TransactionDb, id: string, source: TargetCostProjectSource, allowDeleted = false) {
  const row = await fetchRowById(db, 'target_costs', id)
  if (!row || (!allowDeleted && row.deleted_at != null))
    throw targetCostProblem('not-found', '预算版本不存在或已删除')
  if (row.project_id != null) {
    if (source.status !== 'available')
      throw targetCostProblem(source.status === 'forbidden' ? 'forbidden' : 'unavailable', '无法核验预算所属项目，请稍后重新读取')
    if (!(await db.select(selectVisibleSql('projects', 'AND id = ?'), [row.project_id]))[0])
      throw targetCostProblem('not-found', '预算所属项目已隐藏或删除')
  }
  return row
}

/** 头、明细、附件、唯一基线和命令回执共用同一个工作区事务。 */
export function createTargetCostService(options: TargetCostServiceOptions) {
  async function run<T>(query: TargetCostQuery, sessionId: string | null | undefined, write: boolean, work: (db: TransactionDb, context: TargetCostContext, projects: TargetCostProjectSource) => Promise<T>) {
    if (query.origin !== 'real')
      throw targetCostProblem('forbidden', '演示预算只经授权后的隔离只读适配器读取')
    return options.transaction(async (db) => {
      const identity = structuredClone(options.session(sessionId))
      authorize(identity, write)
      const projects = structuredClone(await options.projects(sessionId))
      await initializeTargetCostSchema(db)
      await syncProjects(db, projects)
      const context: TargetCostContext = { ...identity, origin: 'real', sourceVersion: `budget:${await targetCostRevision(db)}+projects:${projects.version}` }
      const result = await work(db, context, projects)
      const latest = await options.projects(sessionId)
      if (latest.version !== projects.version || latest.status !== projects.status)
        throw targetCostProblem('stale-source', '预算所属项目来源已变化，请重新核对')
      sameSession(identity, options.session(sessionId), write)
      return result
    }, sessionId)
  }
  return {
    list(query: TargetCostQuery, sessionId?: string | null) {
      return run(query, sessionId, false, async (db, context, source) => ({ context, rows: (await loadTargetCostList(db, true)).filter(row => source.status === 'available' || !row.projectId) }))
    },
    form(query: TargetCostQuery, id: string | null, draftKey?: string, sessionId?: string | null): Promise<TargetCostFormRead> {
      return run(query, sessionId, false, async (db, context, source) => {
        const row = id ? await requireHead(db, id, source, true) : null
        const header = row ? targetCostHeaderFromRow(row) : null
        return { context, targetCostId: id, draftKey: id ? null : draftKey ?? null, draft: header ? { ...header } : {}, deletedAt: row?.deleted_at == null ? null : String(row.deleted_at), files: id ? await loadBudgetFiles(db, id) : [], projects: source.options ?? source.projects, projectOptionsStatus: source.optionsStatus ?? source.status }
      })
    },
    detail(query: TargetCostQuery, id: string, sessionId?: string | null): Promise<TargetCostDetailRead> {
      return run(query, sessionId, false, async (db, context, source) => {
        const row = await requireHead(db, id, source, true)
        const project = source.projects.find(project => project.id === row.project_id)
        const header = targetCostHeaderFromRow({ ...row, project_name: project?.name, project_code: project?.code })
        // 删除版本可读自身归档；此前单独删除的明细仍在历史，不重现为当前明细。
        const items = (await db.select<Record<string, unknown>>('SELECT * FROM target_cost_items WHERE target_cost_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at, id', [id])).map(targetCostItemFromRow)
        const actual = await options.actual(header.projectId, sessionId)
        const comparison = buildTargetCostComparison(id, items, actual)
        return { context, targetCostId: id, deletedAt: row.deleted_at == null ? null : String(row.deleted_at), view: { header, items, ...comparison }, files: await loadBudgetFiles(db, id), actualSourceVersion: actual.sourceVersion, history: await loadTargetCostHistory(db, id) }
      })
    },
    file(query: TargetCostQuery, id: string, fileId: string, sessionId?: string | null) {
      return run(query, sessionId, false, async (db, context, source) => {
        await requireHead(db, id, source)
        return { context, content: await readBudgetFileContent(db, id, fileId) }
      })
    },
    async execute(command: TargetCostCommand, sessionId?: string | null): Promise<TargetCostCommandResult> {
      let confirmedAbsent = false
      try {
        return await run({ origin: command.origin }, sessionId, true, async (db, context, source) => {
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId || command.requiredCapability !== 'target-cost:write')
            throw targetCostProblem('forbidden', '提交身份或预算能力不匹配')
          const fingerprint = digest(command)
          const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT * FROM target_cost_command_receipts WHERE command_id = ?', [command.commandId])
          if (receipt) {
            if (receipt.actor_id !== context.actorId || receipt.fingerprint !== fingerprint)
              throw targetCostProblem('conflict', '同一提交编号不能改用其他内容')
            return JSON.parse(receipt.result_json) as TargetCostCommandResult
          }
          confirmedAbsent = true
          if (!command.commandId || !command.sourceVersion || command.sourceVersion !== context.sourceVersion)
            throw targetCostProblem('stale-source', '预算版本或项目来源已变化，请保留草稿并重新核对')
          const action = command.action
          if (!command.targetCostId && (action.kind !== 'save-header' || !command.draftKey))
            throw targetCostProblem('validation-failed', '新建预算必须提供固定草稿身份')
          if (action.kind === 'save-header' && action.draft.id && action.draft.id !== command.targetCostId)
            throw targetCostProblem('relationship-mismatch', '草稿与当前预算版本不一致')
          const id = command.targetCostId ?? generateId('target_cost')
          const existing = command.targetCostId ? await requireHead(db, id, source, action.kind === 'restore') : null
          const [logStart] = await db.select<{ sequence: number }>('SELECT COALESCE(MAX(rowid), 0) AS sequence FROM operation_logs')
          let attachmentIds: string[] = []
          let affectedVersionIds = [id]
          if (action.kind === 'save-header') {
            if (action.draft.projectId && source.status !== 'available')
              throw targetCostProblem(source.status === 'forbidden' ? 'forbidden' : 'unavailable', '无法核验所选项目')
            affectedVersionIds = await persistTargetCostHeader(db, id, action.draft, action.saveAction, context.actorId)
            attachmentIds = await applyBudgetFileChanges(db, id, action.files ?? {}, { actorId: context.actorId, timestamp: new Date().toISOString() })
          }
          else if (action.kind === 'save-items') {
            await persistTargetCostItems(db, id, action.items, context.actorId)
          }
          else if (action.kind === 'delete') {
            await softDelete(db, 'target_costs', id, context.actorId)
          }
          else if (action.kind === 'restore') {
            if (existing?.is_baseline && existing.project_id && (await db.select(`${hiddenCtesFor('target_costs')} SELECT t.id FROM target_costs t WHERE ${visibleCond('target_costs', 't')} AND t.project_id = ? AND t.id <> ? AND t.is_baseline = 1`, [existing.project_id, id]))[0])
              throw targetCostProblem('conflict', '所属项目已有基准预算，请先取消其他版本的基准再恢复')
            await restoreRecord(db, 'target_costs', id, context.actorId)
          }
          else {
            throw targetCostProblem('validation-failed', '预算动作无效')
          }
          await advanceTargetCostRevision(db)
          const logIds = (await db.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid > ? ORDER BY rowid', [logStart?.sequence ?? 0])).map(row => row.id)
          const result: TargetCostCommandResult = { commandId: command.commandId, id, sourceVersion: `budget:${await targetCostRevision(db)}+projects:${source.version}`, logIds, attachmentIds, affectedVersionIds }
          await db.execute('INSERT INTO target_cost_command_receipts(command_id, actor_id, target_cost_id, action, fingerprint, result_json) VALUES (?, ?, ?, ?, ?, ?)', [command.commandId, context.actorId, id, action.kind, fingerprint, JSON.stringify(result)])
          return result
        })
      }
      catch (cause) {
        const error = cause instanceof TargetCostItemValidationError ? targetCostProblem('validation-failed', cause.message, { [cause.field]: [cause.message] }) : cause
        if (confirmedAbsent && error instanceof ProjectRepositoryProblem) {
          Object.assign(error.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        }
        throw error
      }
    },
  }
}
