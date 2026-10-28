import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { TargetCostCommand, TargetCostCommandResult, TargetCostContext, TargetCostDetailRead, TargetCostFormRead, TargetCostListRead, TargetCostQuery } from '../../app/lib/target-cost/central-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { restoreRecord, softDelete } from '../../app/lib/db/soft-delete'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { encodeTargetCostWire, parseTargetCostCommand } from '../../app/lib/target-cost/central-codec'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { persistTargetCostHeader, targetCostEditableDraft } from '../../app/lib/target-cost/central-domain'
import { loadTargetCostHistory } from '../../app/lib/target-cost/central-history'
import { targetCostHeaderFromRow, targetCostItemFromRow } from '../../app/lib/target-cost/detail'
import { persistTargetCostItems, TargetCostItemValidationError } from '../../app/lib/target-cost/items'
import { loadTargetCostList } from '../../app/lib/target-cost/list'
import { generateId } from '../../app/lib/util/id'
import { loadProductionBudgetActual } from './production-target-cost-actual'
import { applyProductionBudgetFiles, budgetDigest, loadProductionBudgetFiles, readProductionBudgetFile } from './production-target-cost-files'
import { advanceProductionBudgetVersion, productionBudgetProjectRows, verifyProductionBudgetState } from './production-target-cost-state'
import { buildTargetCostComparison } from './target-cost-actual'

type Session = () => BusinessSession
interface Basis { targetId: string | null, version: number, projects: Record<string, string>, baselines: Record<string, string> }
function authorize(actor: BusinessSession, identity: ProductionStorage['identity'], write = false) {
  if (actor.workspaceId !== identity.workspaceId || actor.actorId !== identity.actorId || !actor.capabilities.includes('target-cost:read') || (write && !actor.capabilities.includes('target-cost:write')))
    throw targetCostProblem('forbidden', '当前会话无权读取或维护这份正式预算')
}
async function head(tx: TransactionDb, id: string, deleted = true) {
  if ((await tx.select('SELECT r.import_id FROM target_cost_import_restores r,json_each(r.result_json,\'$.ids\') retired WHERE retired.value=?', [id]))[0])
    throw targetCostProblem('not-found', '预算已随原批次恢复归档，请从原来源核对')
  const row = (await tx.select<Record<string, unknown>>('SELECT * FROM target_costs WHERE id=?', [id]))[0]
  if (!row || (!deleted && row.deleted_at !== null))
    throw targetCostProblem('not-found', '预算版本不存在或已删除')
  if (row.project_id !== null) {
    const project = (await productionBudgetProjectRows(tx, String(row.project_id)))[0]
    if (!project || project.deleted_at !== null)
      throw targetCostProblem('not-found', '预算所属项目已删除或不可读取')
  }
  return row
}
async function context(tx: TransactionDb, actor: BusinessSession, id: string | null): Promise<TargetCostContext> {
  const row = id ? await head(tx, id) : null
  const basis: Basis = { targetId: id, version: id ? (await tx.select<{ version: number }>('SELECT version FROM target_cost_versions WHERE id=?', [id]))[0]!.version : 0, projects: {}, baselines: {} }
  const candidates = actor.capabilities.includes('project:list:read')
    ? (await productionBudgetProjectRows(tx)).filter(project => project.deleted_at === null)
    : row?.project_id ? await productionBudgetProjectRows(tx, String(row.project_id)) : []
  for (const project of candidates) {
    basis.projects[project.id] = budgetDigest([project.id, project.deleted_at])
    basis.baselines[project.id] = budgetDigest(await tx.select('SELECT id,is_baseline,status FROM target_costs WHERE project_id=? AND deleted_at IS NULL AND is_baseline=1 ORDER BY id', [project.id]))
  }
  return { ...actor, origin: 'real', sourceVersion: `target-cost-v1:${Buffer.from(JSON.stringify(basis)).toString('base64url')}` }
}
function decodeBasis(version: string): Basis {
  try {
    if (!version.startsWith('target-cost-v1:'))
      throw new Error('version')
    const basis = JSON.parse(Buffer.from(version.slice(15), 'base64url').toString())
    if (!basis || !(basis.targetId === null || typeof basis.targetId === 'string') || !Number.isSafeInteger(basis.version) || !basis.projects || !basis.baselines)
      throw new Error('version')
    return basis
  }
  catch { throw targetCostProblem('stale-source', '预算原读取依据不可核验，请保留输入并重新核对') }
}
async function checkBasis(tx: TransactionDb, actor: BusinessSession, command: TargetCostCommand, existing: Record<string, unknown> | null) {
  const expected = decodeBasis(command.sourceVersion)
  const current = decodeBasis((await context(tx, actor, command.targetCostId)).sourceVersion)
  if (expected.targetId !== command.targetCostId || expected.version !== current.version)
    throw targetCostProblem('stale-source', '当前预算版本已经变化，请保留原草稿并核对')
  const action = command.action
  const projectId = action.kind === 'save-header' ? action.draft.projectId ?? null : existing?.project_id ?? null
  if (projectId && (expected.projects[String(projectId)] === undefined || expected.projects[String(projectId)] !== current.projects[String(projectId)]))
    throw targetCostProblem('stale-source', '实际采用的项目资格已变化，请重新核对')
  const usesBaseline = (action.kind === 'save-header' && action.draft.isBaseline) || (action.kind === 'restore' && existing?.is_baseline)
  if (usesBaseline && projectId && expected.baselines[String(projectId)] !== current.baselines[String(projectId)])
    throw targetCostProblem('stale-source', '当前项目的预算基线已变化，请重新核对')
}
export function createProductionTargetCostService(storage: ProductionStorage) {
  async function run<T>(query: TargetCostQuery, session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    if (query.origin !== 'real')
      throw targetCostProblem('forbidden', '正式磁盘预算只读取真实来源')
    const scheduled = structuredClone(session())
    authorize(scheduled, storage.identity, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const actor = structuredClone(session())
      authorize(actor, storage.identity, write)
      if (budgetDigest(actor) !== budgetDigest(scheduled))
        throw targetCostProblem('forbidden', '排队期间身份或权限已变化')
      await verifyProductionBudgetState(tx)
      const result = await work(tx, actor)
      const latest = session()
      authorize(latest, storage.identity, write)
      if (budgetDigest(latest) !== budgetDigest(actor))
        throw targetCostProblem('forbidden', '预算操作期间会话或权限已变化，请保留原编号')
      return result
    })
  }
  async function history(tx: TransactionDb, id: string) {
    const rows = await loadTargetCostHistory(tx, id)
    for (const imported of await tx.select<{ evidence_json: string }>('SELECT evidence_json FROM target_cost_imports')) {
      const evidence = JSON.parse(imported.evidence_json)
      for (const entry of rows) {
        const original = evidence.logs?.find((log: Record<string, unknown>) => log.id === entry.id)
        if (original) {
          entry.operatedAt = original.created_at ?? null
          entry.operator = original.operator ?? null
        }
      }
    }
    return rows
  }
  return {
    list(query: TargetCostQuery, session: Session): Promise<TargetCostListRead> {
      return run(query, session, false, async (tx, actor) => {
        const retired = new Set((await tx.select<{ id: string }>('SELECT retired.value AS id FROM target_cost_import_restores r,json_each(r.result_json,\'$.ids\') retired')).map(row => row.id))
        const rows = (await loadTargetCostList(tx, true)).filter(row => !retired.has(row.id))
        for (const projectId of new Set(rows.flatMap(row => row.projectId ? [row.projectId] : [])))
          await productionBudgetProjectRows(tx, projectId)
        return { context: { ...actor, origin: 'real', sourceVersion: `budget-list:${budgetDigest(await tx.select('SELECT * FROM target_cost_versions ORDER BY id'))}` }, rows }
      })
    },
    form(query: TargetCostQuery, id: string | null, draftKey: string | undefined, session: Session): Promise<TargetCostFormRead> {
      return run(query, session, false, async (tx, actor) => {
        const row = id ? await head(tx, id) : null
        return { context: await context(tx, actor, id), targetCostId: id, draftKey: id ? null : draftKey ?? null, draft: row ? targetCostEditableDraft(targetCostHeaderFromRow(row)) : {}, deletedAt: row?.deleted_at == null ? null : String(row.deleted_at), files: id ? await loadProductionBudgetFiles(tx, id) : [], projects: actor.capabilities.includes('project:list:read') ? (await productionBudgetProjectRows(tx)).filter(project => project.deleted_at === null).map(project => ({ id: project.id, name: project.name, code: project.code })) : [], projectOptionsStatus: actor.capabilities.includes('project:list:read') ? 'available' : 'forbidden' }
      })
    },
    detail(query: TargetCostQuery, id: string, session: Session): Promise<TargetCostDetailRead> {
      return run(query, session, false, async (tx, actor) => {
        const row = await head(tx, id)
        const project = row.project_id ? (await tx.select<Record<string, unknown>>('SELECT name,code FROM projects WHERE id=?', [row.project_id]))[0] : null
        const header = targetCostHeaderFromRow({ ...row, project_name: project?.name, project_code: project?.code })
        const items = (await tx.select<Record<string, unknown>>('SELECT * FROM target_cost_items WHERE target_cost_id=? AND deleted_at IS NULL ORDER BY sort_order,created_at,id', [id])).map(targetCostItemFromRow)
        const actual = await loadProductionBudgetActual(tx, header.projectId, actor)
        return { context: await context(tx, actor, id), targetCostId: id, deletedAt: row.deleted_at == null ? null : String(row.deleted_at), view: { header, items, ...buildTargetCostComparison(id, items, actual) }, actualSourceVersion: actual.sourceVersion, files: await loadProductionBudgetFiles(tx, id), history: await history(tx, id) }
      })
    },
    file(query: TargetCostQuery, id: string, fileId: string, session: Session) {
      return run(query, session, false, async (tx, actor) => {
        await head(tx, id, false)
        return { context: await context(tx, actor, id), content: await readProductionBudgetFile(tx, id, fileId) }
      })
    },
    async execute(input: TargetCostCommand, session: Session): Promise<TargetCostCommandResult> {
      const command = parseTargetCostCommand(encodeTargetCostWire(input))
      if (!/^[a-z0-9][\w-]{2,79}$/i.test(command.commandId) || command.requiredCapability !== 'target-cost:write')
        throw targetCostProblem('validation-failed', '预算原编号或写入能力无效')
      let confirmedAbsent = false
      try {
        return await run({ origin: command.origin }, session, true, async (tx, actor) => {
          if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
            throw targetCostProblem('forbidden', '预算命令身份与可信会话不匹配')
          const fingerprint = budgetDigest(command)
          const original = (await tx.select<{ workspace_id: string, actor_id: string, fingerprint: string, result_json: string }>('SELECT * FROM target_cost_commands WHERE command_id=?', [command.commandId]))[0]
          if (original) {
            if (original.workspace_id !== actor.workspaceId || original.actor_id !== actor.actorId || original.fingerprint !== fingerprint)
              throw targetCostProblem('conflict', '同一原编号不能改用其他内容')
            return JSON.parse(original.result_json) as TargetCostCommandResult
          }
          confirmedAbsent = true
          if ((await tx.select('SELECT command_id FROM target_cost_resolutions WHERE command_id=?', [command.commandId]))[0])
            throw targetCostProblem('conflict', '原编号已经封存为未应用，迟到请求不能再写入')
          const existing = command.targetCostId ? await head(tx, command.targetCostId, command.action.kind === 'restore') : null
          await checkBasis(tx, actor, command, existing)
          if (!command.targetCostId && (command.action.kind !== 'save-header' || !command.draftKey))
            throw targetCostProblem('validation-failed', '新建预算须有独立且稳定的草稿身份')
          if (command.action.kind === 'save-header' && command.action.draft.id && command.action.draft.id !== command.targetCostId)
            throw targetCostProblem('relationship-mismatch', '版本头草稿指向另一预算')
          if (!command.targetCostId && (await tx.select('SELECT draft_key FROM target_cost_draft_claims WHERE draft_key=?', [command.draftKey]))[0])
            throw targetCostProblem('conflict', '这个草稿已保存，先核对原版本，不能重复创建')
          const id = command.targetCostId ?? generateId('target_cost')
          const start = (await tx.select<{ sequence: number }>('SELECT COALESCE(MAX(rowid),0) AS sequence FROM operation_logs'))[0]!.sequence
          let affectedVersionIds = [id]
          let attachmentIds: string[] = []
          const action = command.action
          if (action.kind === 'save-header') {
            affectedVersionIds = await persistTargetCostHeader(tx, id, action.draft, action.saveAction, actor.actorId)
            attachmentIds = await applyProductionBudgetFiles(tx, id, action.files ?? {}, actor.actorId)
          }
          else if (action.kind === 'save-items') {
            await persistTargetCostItems(tx, id, action.items, actor.actorId)
          }
          else if (action.kind === 'delete') {
            await softDelete(tx, 'target_costs', id, actor.actorId)
          }
          else {
            if (existing?.is_baseline && existing.project_id && (await tx.select('SELECT id FROM target_costs WHERE project_id=? AND id<>? AND is_baseline=1 AND deleted_at IS NULL', [existing.project_id, id]))[0])
              throw targetCostProblem('conflict', '项目已有后来预算基线，恢复不能抢占')
            await restoreRecord(tx, 'target_costs', id, actor.actorId)
          }
          for (const target of affectedVersionIds)
            await advanceProductionBudgetVersion(tx, target)
          const result: TargetCostCommandResult = { commandId: command.commandId, id, sourceVersion: (await context(tx, actor, id)).sourceVersion, logIds: (await tx.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid>? ORDER BY rowid', [start])).map(row => row.id), attachmentIds, affectedVersionIds }
          await tx.execute('INSERT INTO target_cost_commands VALUES (?,?,?,?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, id, action.kind, fingerprint, JSON.stringify(command), JSON.stringify(result), new Date().toISOString()])
          if (!command.targetCostId)
            await tx.execute('INSERT INTO target_cost_draft_claims VALUES (?,?,?)', [command.draftKey, id, command.commandId])
          return result
        })
      }
      catch (cause) {
        const error = cause instanceof TargetCostItemValidationError ? targetCostProblem('validation-failed', cause.message, { [cause.field]: [cause.message] }) : cause
        if (confirmedAbsent && error instanceof ProjectRepositoryProblem && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(error.problem.code))
          Object.assign(error.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw error
      }
    },
    resolve(input: { commandId: string, workspaceId: string, actorId: string }, session: Session) {
      return run({ origin: 'real' }, session, true, async (tx, actor) => {
        if (input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId || !/^[a-z0-9][\w-]{2,79}$/i.test(input.commandId))
          throw targetCostProblem('forbidden', '原预算编号与当前身份不匹配')
        const row = (await tx.select<{ result_json: string, workspace_id: string, actor_id: string }>('SELECT * FROM target_cost_commands WHERE command_id=?', [input.commandId]))[0]
        if (row) {
          if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId)
            throw targetCostProblem('forbidden', '原预算编号属于其他身份')
          return { outcome: 'applied' as const, result: JSON.parse(row.result_json) as TargetCostCommandResult }
        }
        await tx.execute('INSERT OR IGNORE INTO target_cost_resolutions VALUES (?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId: input.commandId }
      })
    },
  }
}
