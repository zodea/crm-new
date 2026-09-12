import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityContext } from '../../app/lib/quantity/central-contract'
import type { ScheduleAction, ScheduleCommand, ScheduleCommandResult, ScheduleRead, ScheduleReadQuery } from '../../app/lib/schedule/central-contract'
import type { BusinessSession } from './business-session'
import type { ScheduleSources } from './schedule-sources'
import { createHash } from 'node:crypto'
import { fetchRowById, hiddenCtesFor, PARENT_REFS, selectVisibleSql, visibleCond } from '../../app/lib/db/soft-delete'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { QuantityRepositoryProblem } from '../../app/lib/quantity/central-contract'
import { bindCentralScheduleContract, readScheduleBinding } from '../../app/lib/schedule/central-binding'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { assertScheduleDependencyGraph } from '../../app/lib/schedule/central-invariants'
import { initializeScheduleSchema } from '../../app/lib/schedule/central-schema'
import { SCHEDULE_CONTRACT_BIND_OPERATOR } from '../../app/lib/schedule/contract-binding'
import { createScheduleEngine } from '../../app/lib/schedule/engine'
import { loadScheduleHistory } from '../../app/lib/schedule/history'
import { loadScheduleBuildingCoverage } from '../../app/lib/schedule/read-model'
import { toLocalDateInputValue } from '../../app/lib/util/local-date'
import { parseScheduleCommand, parseScheduleRead } from './schedule-request'
import { synchronizeScheduleSources } from './schedule-sources'

interface Options {
  session: (sessionId?: string | null) => BusinessSession
  sources: (projectId: string, sessionId?: string | null) => ScheduleSources | Promise<ScheduleSources>
  withSchedule: <T>(query: ScheduleReadQuery, consume: (db: TransactionDb, context: QuantityContext, quantityVersion: string) => Promise<T>, sessionId?: string | null) => Promise<T>
}
function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
    : entry)).digest('hex')
}
function authorize(context: BusinessSession, write = false) {
  if (!context.capabilities.includes('schedule:read') || (write && !context.capabilities.includes('schedule:write')))
    throw scheduleProblem('forbidden', '当前身份无排程读取或维护权限')
}
async function executeEngine(engine: ReturnType<typeof createScheduleEngine>, action: ScheduleAction, projectId: string): Promise<unknown> {
  switch (action.kind) {
    case 'create-group':
      if (action.draft.projectId !== projectId)
        throw scheduleProblem('relationship-mismatch', '建组草稿不属于当前项目')
      return engine.createGroup(action.draft)
    case 'update-task': {
      if (engine.previewTaskReschedule(action.taskId, action.patch).conflicts.length)
        throw scheduleProblem('validation-failed', '调期涉及依赖冲突，请先确认关系')
      return engine.updateTask(action.taskId, action.patch)
    }
    case 'update-floors': return engine.updateFloorPlans(action.taskId, action.patches)
    case 'update-dependency': {
      const result = await engine.updateDependency(action.successorId, action.predecessorId, action.lagDays)
      if (result.conflicts.length)
        throw scheduleProblem('validation-failed', '前置关系与当前日期冲突，请先核对日期')
      return result
    }
    case 'save-task-plan': return engine.saveTaskPlan(action.taskId, action.draft)
    case 'reschedule-task': return engine.rescheduleTask(action.taskId, action.patch, action.dependencyIdsToDisable)
    case 'remove-dependency': return engine.removeDependency(action.dependencyId)
    case 'restore-dependency': return engine.restoreDependency(action.dependencyId)
    case 'set-baseline': return engine.setBaseline(projectId)
    case 'add-task': return engine.addTask(action.groupId, action.draft)
    case 'remove-task': return engine.removeTask(action.taskId)
    case 'undo': return engine.undo(action.logIds)
    case 'bind-contract': throw scheduleProblem('validation-failed', '合同绑定必须经过中央来源核验')
  }
}

/** WBS 回执、计划、日志及当前工程量来源在同一中央 SQL 事务内。 */
export function createScheduleService(options: Options) {
  async function run<T>(queryInput: ScheduleReadQuery, sessionId: string | null | undefined, work: (db: TransactionDb, engine: ReturnType<typeof createScheduleEngine>, sourceVersion: string, sources: ScheduleSources, context: BusinessSession) => Promise<T>): Promise<T> {
    const query = parseScheduleRead(queryInput)
    if (query.origin !== 'real')
      throw scheduleProblem('forbidden', '演示排程只经授权后的隔离只读适配器读取')
    return options.withSchedule(query, async (db, _quantityContext, quantityVersion) => {
      const context = options.session(sessionId)
      authorize(context)
      const sources = await options.sources(query.projectId, sessionId)
      await initializeScheduleSchema(db)
      await synchronizeScheduleSources(db, query.projectId, sources)
      const [revision] = await db.select<{ revision: number }>('SELECT revision FROM schedule_revisions WHERE project_id = ?', [query.projectId])
      const version = `${quantityVersion}+wbs:${revision?.revision ?? 0}+${sources.version}`
      const engine = createScheduleEngine(db, work => work(db))
      await engine.loadProject(query.projectId, query.today ?? toLocalDateInputValue())
      const result = await work(db, engine, version, sources, context)
      const currentSession = options.session(sessionId)
      authorize(currentSession)
      if (currentSession.workspaceId !== context.workspaceId || currentSession.actorId !== context.actorId)
        throw scheduleProblem('forbidden', '排程会话已变化，请保留草稿并重新读取')
      if ((await options.sources(query.projectId, sessionId)).version !== sources.version)
        throw scheduleProblem('stale-source', '项目、合同清单或工序库来源已变化，请保留草稿并重新核对')
      const finalContext = options.session(sessionId)
      authorize(finalContext)
      if (finalContext.workspaceId !== context.workspaceId || finalContext.actorId !== context.actorId || JSON.stringify(finalContext.capabilities) !== JSON.stringify(context.capabilities))
        throw scheduleProblem('forbidden', '提交期间身份或权限已变化，请保留原提交并重新核对')
      return result
    }, sessionId)
  }
  return {
    binding(query: ScheduleReadQuery, groupId: string, contractId = '', sessionId?: string | null) {
      return run(query, sessionId, (db, _engine, sourceVersion, sources, context) => readScheduleBinding(db, { ...context, origin: 'real', sourceVersion }, query.projectId, groupId, contractId, sources.boq.lines))
    },
    groupUsage(query: ScheduleReadQuery, sessionId?: string | null) {
      return run(query, sessionId, async (_db, engine, sourceVersion) => {
        const counts = new Map<string, number>()
        // 使用正文的可见分组投影，保持合同及项目等语义祖先过滤一致。
        for (const group of engine.snapshot.value?.groups ?? [])
          counts.set(group.processLibraryId, (counts.get(group.processLibraryId) ?? 0) + 1)
        return { sourceVersion, groups: [...counts].map(([libraryId, groupCount]) => ({ libraryId, groupCount })) }
      })
    },
    read(query: ScheduleReadQuery, contractId = '', sessionId?: string | null): Promise<ScheduleRead> {
      return run(query, sessionId, async (db, engine, sourceVersion, _sources, context) => {
        await engine.loadContracts(query.projectId)
        await engine.loadBuildings(query.projectId, contractId)
        if (!engine.snapshot.value)
          throw scheduleProblem('not-found', '项目不存在或已删除')
        const quantities = await db.select<{ id: string, snapshot_json: string, legacy_missing: number }>('SELECT id, snapshot_json, legacy_missing FROM schedule_floor_quantity_snapshots WHERE project_id = ?', [query.projectId])
        const snapshot = structuredClone(engine.snapshot.value)
        for (const group of snapshot.groups) {
          for (const task of group.tasks) {
            for (const floor of task.floorPlans) {
              const quantity = quantities.find(row => row.id === floor.id)
              floor.legacyQuantityDetailMissing = Boolean(quantity?.legacy_missing)
              floor.quantitySnapshot = quantity && !quantity.legacy_missing ? JSON.parse(quantity.snapshot_json) : null
            }
          }
        }
        return { ...context, origin: 'real', sourceVersion, snapshot, history: await loadScheduleHistory(db, query.projectId), contracts: engine.contracts.value, buildings: engine.buildings.value, buildingCoverage: contractId ? await loadScheduleBuildingCoverage(db, query.projectId, contractId) : [] }
      })
    },
    scope(query: ScheduleReadQuery, buildingIds: string[], sessionId?: string | null) {
      return run(query, sessionId, async (_db, engine, sourceVersion, _sources, context) => {
        await engine.loadBuildings(query.projectId)
        if (buildingIds.some(id => !engine.buildings.value.some(row => row.id === id)))
          throw scheduleProblem('relationship-mismatch', '楼栋不属于当前项目或已排程')
        return { ...context, origin: 'real' as const, sourceVersion, preview: await engine.previewProvisionalScope(buildingIds) }
      })
    },
    async execute(input: ScheduleCommand, sessionId?: string | null): Promise<ScheduleCommandResult> {
      const command = parseScheduleCommand(input)
      let confirmedAbsent = false
      return run({ projectId: command.projectId, origin: command.origin, includeDemo: false }, sessionId, async (db, engine, sourceVersion, sources, context) => {
        authorize(context, true)
        if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
          throw scheduleProblem('forbidden', '提交身份已变化，请重新读取')
        const digest = fingerprint(command)
        const [receipt] = await db.select<{ fingerprint: string, result_json: string, actor_id: string }>('SELECT fingerprint, result_json, actor_id FROM schedule_command_receipts WHERE command_id = ?', [command.commandId])
        if (receipt) {
          if (receipt.fingerprint !== digest || receipt.actor_id !== context.actorId)
            throw scheduleProblem('conflict', '同一提交编号不能使用不同内容')
          return JSON.parse(receipt.result_json) as ScheduleCommandResult
        }
        confirmedAbsent = true
        if (command.sourceVersion !== sourceVersion)
          throw scheduleProblem('stale-source', '排程或当前来源已变化，请保留草稿并重新核对')
        if (command.action.kind === 'create-group' && command.action.draft.librarySourceVersion) {
          const selected = sources.libraries.find(row => row.id === (command.action as Extract<ScheduleAction, { kind: 'create-group' }>).draft.processLibraryId)
          if (!selected || selected.sourceVersion !== command.action.draft.librarySourceVersion)
            throw scheduleProblem('stale-source', '所选工序库版本已变化')
        }
        // 通用撤销只接受本项目 WBS 动作的日志，不能越过中央领域边界。
        if (command.action.kind === 'undo') {
          for (const id of command.action.logIds) {
            const [log] = await db.select<{ table_name: string, record_id: string, operator: string }>('SELECT table_name, record_id, operator FROM operation_logs WHERE id = ?', [id])
            if (!log || !['schedule_groups', 'schedule_group_buildings', 'schedule_tasks', 'task_item_map', 'task_dependencies', 'schedule_task_floor_plans'].includes(log.table_name))
              throw scheduleProblem('relationship-mismatch', '撤销记录不属于排程')
            if (log.operator === SCHEDULE_CONTRACT_BIND_OPERATOR)
              throw scheduleProblem('validation-failed', '合同绑定是既有依据，不支持通过普通撤销解绑或换绑')
            const relation = log.table_name === 'schedule_tasks' || log.table_name === 'schedule_groups'
              ? `SELECT project_id FROM ${log.table_name} WHERE id = ?`
              : log.table_name === 'schedule_group_buildings'
                ? 'SELECT g.project_id FROM schedule_group_buildings r JOIN schedule_groups g ON g.id = r.group_id WHERE r.id = ?'
                : log.table_name === 'task_dependencies'
                  ? 'SELECT t.project_id FROM task_dependencies r JOIN schedule_tasks t ON t.id = r.succ_id WHERE r.id = ?'
                  : `SELECT t.project_id FROM ${log.table_name} r JOIN schedule_tasks t ON t.id = r.task_id WHERE r.id = ?`
            const [owner] = await db.select<{ project_id: string }>(relation, [log.record_id])
            if (owner?.project_id !== command.projectId)
              throw scheduleProblem('relationship-mismatch', '撤销记录不属于当前项目')
            if (log.table_name === 'schedule_tasks') {
              // 自身可能正等待撤销删除；其语义父级仍须全部处于当前可见范围。
              const task = await fetchRowById(db, 'schedule_tasks', log.record_id)
              for (const parent of PARENT_REFS.schedule_tasks!) {
                const parentId = task?.[parent.column]
                if (parentId != null && !(await db.select(selectVisibleSql(parent.table, 'AND id = ?'), [parentId]))[0])
                  throw scheduleProblem('validation-failed', '该历史任务的上级范围已隐藏，不能通过普通撤销修改')
              }
            }
            const groupRelation = log.table_name === 'schedule_groups'
              ? 'SELECT id AS group_id FROM schedule_groups WHERE id = ?'
              : log.table_name === 'schedule_group_buildings'
                ? 'SELECT group_id FROM schedule_group_buildings WHERE id = ?'
                : log.table_name === 'schedule_tasks'
                  ? 'SELECT group_id FROM schedule_tasks WHERE id = ?'
                  : log.table_name === 'task_dependencies'
                    ? `${hiddenCtesFor('schedule_tasks')} SELECT task.group_id FROM task_dependencies edge JOIN schedule_tasks task ON task.id IN (edge.pred_id, edge.succ_id) WHERE edge.id = ? AND ${visibleCond('schedule_tasks', 'task')}`
                    : `${hiddenCtesFor('schedule_tasks')} SELECT task.group_id FROM ${log.table_name} row JOIN schedule_tasks task ON task.id = row.task_id WHERE row.id = ? AND ${visibleCond('schedule_tasks', 'task')}`
            const groupOwners = await db.select<{ group_id: string | null }>(groupRelation, [log.record_id])
            if (groupOwners.length !== (log.table_name === 'task_dependencies' ? 2 : 1))
              throw scheduleProblem('validation-failed', '该历史记录没有当前可维护的任务范围，请在历史记录中核对')
            for (const groupOwner of groupOwners) {
              const [activeGroup] = groupOwner.group_id ? await db.select(selectVisibleSql('schedule_groups', 'AND id = ? AND project_id = ?'), [groupOwner.group_id, command.projectId]) : []
              if (!activeGroup)
                throw scheduleProblem('validation-failed', '该历史记录不在当前有效分组中，不能通过普通撤销修改')
            }
          }
        }
        let value: unknown
        try {
          value = command.action.kind === 'bind-contract'
            ? await bindCentralScheduleContract(db, { ...context, origin: 'real', sourceVersion }, command.projectId, command.action.groupId, command.action.contractId, sources.boq.lines)
            : await executeEngine(engine, command.action, command.projectId)
          await assertScheduleDependencyGraph(db, command.projectId)
        }
        catch (cause) {
          if (cause && typeof cause === 'object' && 'problem' in cause)
            throw cause
          throw scheduleProblem('validation-failed', cause instanceof Error ? cause.message : '排程字段校验未通过')
        }
        authorize(options.session(sessionId), true)
        await db.execute('INSERT INTO schedule_revisions (project_id, revision) VALUES (?, 1) ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1', [command.projectId])
        const [revision] = await db.select<{ revision: number }>('SELECT revision FROM schedule_revisions WHERE project_id = ?', [command.projectId])
        const result: ScheduleCommandResult = { commandId: command.commandId, projectId: command.projectId, sourceVersion: sourceVersion.replace(/\+wbs:\d+\+/, `+wbs:${revision!.revision}+`), value: value ?? null }
        await db.execute('INSERT INTO schedule_command_receipts (command_id, project_id, actor_id, fingerprint, result_json) VALUES (?, ?, ?, ?, ?)', [command.commandId, command.projectId, context.actorId, digest, JSON.stringify(result)])
        return result
      }).catch((cause) => {
        if (confirmedAbsent && (cause instanceof ProjectRepositoryProblem || cause instanceof QuantityRepositoryProblem) && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found'].includes(cause.problem.code))
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      })
    },
  }
}
