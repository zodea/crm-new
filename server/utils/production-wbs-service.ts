import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor, CommandResolution } from '../../app/lib/forms/command-recovery'
import type { ScheduleCommand, ScheduleCommandResult, ScheduleRead, ScheduleReadQuery } from '../../app/lib/schedule/central-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { ConstructionContractRepositoryProblem } from '../../app/lib/construction-contract/repository'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { QuantityRepositoryProblem } from '../../app/lib/quantity/central-contract'
import { ensureQuantityExternalReferences } from '../../app/lib/quantity/central-reference'
import { bindCentralScheduleContract, readScheduleBinding } from '../../app/lib/schedule/central-binding'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { assertScheduleDependencyGraph } from '../../app/lib/schedule/central-invariants'
import { createScheduleEngine } from '../../app/lib/schedule/engine'
import { loadScheduleHistory } from '../../app/lib/schedule/history'
import { toLocalDateInputValue } from '../../app/lib/util/local-date'
import { readProductionProcessLibraryState } from './production-process-library-record'
import { productionWbsBindingAdapters, productionWbsBoqLines, productionWbsBoqReadable, productionWbsContract, productionWbsLinesByItem } from './production-wbs-boq-sources'
import { advanceProductionWbsRevision, productionWbsEngineAdapters, productionWbsLegacyCommandExists, productionWbsProject, productionWbsVisibility, verifyProductionWbsState, wbsDigest } from './production-wbs-record'
import { checkProductionWbsVersion, productionWbsVersion } from './production-wbs-version'
import { parseScheduleCommand, parseScheduleRead } from './schedule-request'
import { assertScheduleUndoScope, executeScheduleEngineAction } from './schedule-service'

type Session = () => BusinessSession
function authorize(actor: BusinessSession, storage: ProductionStorage, write = false) {
  if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('schedule:read') || (write && !actor.capabilities.includes('schedule:write')))
    throw scheduleProblem('forbidden', '当前可信身份不能读取或维护这份正式WBS')
}
function descriptor(input: unknown): CommandRecoveryDescriptor {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'action,actorId,commandId,family,targetId,workspaceId')
    throw scheduleProblem('validation-failed', 'WBS恢复只接受原编号与最小定位证据')
  const value = input as CommandRecoveryDescriptor
  if (value.family !== 'schedule' || !value.targetId || !['workspaceId', 'actorId', 'targetId', 'action'].every(key => typeof value[key as keyof CommandRecoveryDescriptor] === 'string' && String(value[key as keyof CommandRecoveryDescriptor]).trim()) || !/^[a-z0-9][\w-]{2,79}$/i.test(value.commandId) || !['create-group', 'update-task', 'update-floors', 'update-dependency', 'save-task-plan', 'reschedule-task', 'remove-dependency', 'restore-dependency', 'set-baseline', 'add-task', 'remove-task', 'undo', 'bind-contract'].includes(value.action))
    throw scheduleProblem('validation-failed', '原WBS恢复编号或动作无效')
  return value
}
export function createProductionWbsService(storage: ProductionStorage) {
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const queued = structuredClone(session())
    authorize(queued, storage, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const actor = structuredClone(session())
      authorize(actor, storage, write)
      if (wbsDigest(actor) !== wbsDigest(queued))
        throw scheduleProblem('forbidden', '排队期间身份或权限已变化，请保留原编号')
      await verifyProductionWbsState(tx, actor)
      let result: T
      try {
        result = await work(tx, actor)
      }
      catch (cause) {
        if (cause instanceof QuantityRepositoryProblem || cause instanceof ConstructionContractRepositoryProblem)
          throw scheduleProblem(cause.problem.code, cause.problem.message)
        throw cause
      }
      const latest = session()
      authorize(latest, storage, write)
      if (wbsDigest(latest) !== wbsDigest(actor))
        throw scheduleProblem('forbidden', 'WBS操作期间身份或权限已变化，请保留原编号')
      return result
    })
  }
  async function engineFor(tx: TransactionDb, actor: BusinessSession, queryInput: ScheduleReadQuery) {
    const query = parseScheduleRead(queryInput)
    if (query.origin !== 'real')
      throw scheduleProblem('forbidden', '正式WBS只读取真实来源')
    await productionWbsProject(tx, query.projectId)
    const engine = createScheduleEngine(tx, work => work(tx), undefined, productionWbsEngineAdapters(actor))
    await engine.loadProject(query.projectId, query.today ?? toLocalDateInputValue())
    return engine
  }
  async function prepareSelectedReferences(tx: TransactionDb, actor: BusinessSession, command: ScheduleCommand, engine: ReturnType<typeof createScheduleEngine>) {
    const action = command.action
    const group = action.kind === 'add-task' ? engine.snapshot.value?.groups.find(group => group.id === action.groupId) : null
    const contractId = action.kind === 'bind-contract' ? action.contractId : action.kind === 'create-group' && action.draft.scopeBasis !== 'provisional' ? action.draft.contractId : group?.scopeBasis === 'contract' ? group.contractId : null
    if (!contractId)
      return
    const head = await productionWbsContract(tx, actor, command.projectId, contractId)
    const lines: Array<{ id: string, projectId: string, contractId: string }> = []
    if (action.kind === 'create-group' || action.kind === 'add-task') {
      const libraryId = action.kind === 'create-group' ? action.draft.processLibraryId : group?.processLibraryId
      const library = (await readProductionProcessLibraryState(tx, actor)).versions.find(row => row.id === libraryId)
      const tasks = library?.tasks.filter(task => action.kind === 'create-group' ? action.draft.tasks.some(input => input.enabled && input.templateKey === task.key) : action.draft.templateKey === task.key) ?? []
      const codes = tasks.flatMap(task => task.itemCodes)
      const items = (await tx.select<{ id: string, code: string }>('SELECT id,code FROM items WHERE project_id=? AND deleted_at IS NULL', [command.projectId])).filter(item => codes.includes(item.code)).map(item => item.id)
      const buildings = action.kind === 'create-group' ? action.draft.buildingIds : group!.buildingIds
      const mapped = await productionWbsLinesByItem(tx, actor, command.projectId, contractId, items, buildings)
      for (const id of new Set([...mapped.values()].flatMap(rows => rows.map(row => row.id))))
        lines.push({ id, projectId: command.projectId, contractId })
    }
    await ensureQuantityExternalReferences(tx, { contracts: [{ id: head.id, projectId: command.projectId }], lines })
  }
  async function resolveOriginal(tx: TransactionDb, actor: BusinessSession, value: CommandRecoveryDescriptor): Promise<CommandResolution<ScheduleCommandResult>> {
    if (value.workspaceId !== actor.workspaceId || value.actorId !== actor.actorId)
      throw scheduleProblem('forbidden', '原WBS命令与当前可信身份不匹配')
    const receipt = (await tx.select<{ actor_id: string, project_id: string, result_json: string }>('SELECT * FROM schedule_command_receipts WHERE command_id=?', [value.commandId]))[0]
    const original = (await tx.select<{ request_json: string }>('SELECT * FROM schedule_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, value.commandId]))[0]
    if (original) {
      const command = parseScheduleCommand(JSON.parse(original.request_json))
      if (command.projectId !== value.targetId || command.action.kind !== value.action)
        throw scheduleProblem('conflict', '恢复目标或动作与原意图不一致')
    }
    if (receipt) {
      if (!original || receipt.actor_id !== actor.actorId || receipt.project_id !== value.targetId)
        throw scheduleProblem('forbidden', '原回执不属于相同项目和身份')
      return { outcome: 'applied', result: JSON.parse(receipt.result_json) as ScheduleCommandResult }
    }
    if (!original && await productionWbsLegacyCommandExists(tx, value.commandId))
      throw scheduleProblem('unavailable', '原库保有同编号历史回执或意图，但相同可信身份及完整映射证明尚未核对；保留原编号，不能认定未应用或重发')
    const sealed = (await tx.select<{ descriptor_json: string }>('SELECT descriptor_json FROM schedule_command_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, value.commandId]))[0]
    if (sealed && wbsDigest(JSON.parse(sealed.descriptor_json)) !== wbsDigest(value))
      throw scheduleProblem('conflict', '原编号已按另一定位证据封存')
    await tx.execute('INSERT OR IGNORE INTO schedule_command_resolutions VALUES (?,?,?,?,?)', [actor.workspaceId, actor.actorId, value.commandId, JSON.stringify(value), new Date().toISOString()])
    return { outcome: 'not-applied', commandId: value.commandId }
  }
  return {
    catalog(origin: 'real' | 'demo', _includeDemo: boolean, session: Session) {
      if (origin !== 'real')
        throw scheduleProblem('forbidden', '当前正式排程来源没有授权演示目录')
      return run(session, false, async (tx, actor) => {
        if (!actor.capabilities.includes('project:list:read'))
          throw scheduleProblem('forbidden', '当前身份不能读取项目目录')
        const projects = await productionWbsEngineAdapters(actor).catalog!(tx)
        return { ...actor, origin: 'real' as const, sourceVersion: `wbs-catalog:${wbsDigest(projects)}`, projects: projects.map(row => ({ ...row, origin: 'real' as const })) }
      })
    },
    read(query: ScheduleReadQuery, contractId = '', session: Session): Promise<ScheduleRead> {
      return run(session, false, async (tx, actor) => {
        const engine = await engineFor(tx, actor, query)
        const contractsAvailable = productionWbsBoqReadable(actor)
        if (contractsAvailable)
          await engine.loadContracts(query.projectId)
        await engine.loadBuildings(query.projectId, contractId)
        const snapshot = structuredClone(engine.snapshot.value!)
        const quantities = await tx.select<{ id: string, snapshot_json: string, legacy_missing: number }>('SELECT * FROM schedule_floor_quantity_snapshots WHERE project_id=?', [query.projectId])
        for (const group of snapshot.groups) {
          for (const task of group.tasks) {
            for (const floor of task.floorPlans) {
              const row = quantities.find(row => row.id === floor.id)
              floor.legacyQuantityDetailMissing = !row || Boolean(row.legacy_missing)
              floor.quantitySnapshot = row && !row.legacy_missing ? JSON.parse(row.snapshot_json) : null
            }
          }
        }
        const history = await loadScheduleHistory(tx, query.projectId, productionWbsVisibility)
        for (const row of await tx.select<{ evidence_json: string }>('SELECT evidence_json FROM schedule_source_imports')) {
          const evidence = JSON.parse(row.evidence_json)
          for (const log of history.logs) {
            const original = evidence.rawDomain.operation_logs.find((row: { legacyId: string }) => row.legacyId === log.id)
            if (original) {
              log.beforeJson = original.columns.before_data.exactValue
              log.afterJson = original.columns.after_data.exactValue
              log.createdAt = original.columns.created_at.exactValue
              log.operator = original.columns.operator.exactValue
            }
          }
        }
        return { ...actor, origin: 'real', sourceVersion: await productionWbsVersion(tx, actor, query.projectId), snapshot, history, contracts: [...engine.contracts.value], buildings: engine.buildings.value, buildingCoverage: [...engine.buildingCoverage.value], contractSourceState: contractsAvailable ? 'available' : 'unavailable', contractSourceMessage: contractsAvailable ? '施工主合同与BOQ按真实正式来源读取，既有暂估和原执行继续保留。' : '当前无施工主合同及BOQ完整读取权限；内部暂估仍可用，原绑定与冻结历史保留。' }
      })
    },
    scope(query: ScheduleReadQuery, buildingIds: string[], session: Session) {
      return run(session, false, async (tx, actor) => {
        const engine = await engineFor(tx, actor, query)
        await engine.loadBuildings(query.projectId)
        if (!buildingIds.length || new Set(buildingIds).size !== buildingIds.length || buildingIds.some(id => !engine.buildings.value.some(row => row.id === id)))
          throw scheduleProblem('relationship-mismatch', '楼栋不属于本项目、已隐藏或已被当前排程占用')
        return { ...actor, origin: 'real' as const, sourceVersion: await productionWbsVersion(tx, actor, query.projectId), preview: await engine.previewProvisionalScope(buildingIds) }
      })
    },
    binding(query: ScheduleReadQuery, groupId: string, contractId = '', session: Session) {
      return run(session, false, async (tx, actor) => {
        await engineFor(tx, actor, query)
        if (!productionWbsBoqReadable(actor))
          throw scheduleProblem('forbidden', '绑定核对需要读取真实施工主合同及BOQ')
        const lines = contractId ? await productionWbsBoqLines(tx, actor, query.projectId, contractId) : []
        return readScheduleBinding(tx, { ...actor, origin: 'real', sourceVersion: await productionWbsVersion(tx, actor, query.projectId) }, query.projectId, groupId, contractId, lines, productionWbsBindingAdapters(actor))
      })
    },
    groupUsage(query: ScheduleReadQuery, session: Session) {
      return run(session, false, async (tx, actor) => {
        const engine = await engineFor(tx, actor, query)
        const counts = new Map<string, number>()
        for (const group of engine.snapshot.value?.groups ?? [])
          counts.set(group.processLibraryId, (counts.get(group.processLibraryId) ?? 0) + 1)
        return { sourceVersion: await productionWbsVersion(tx, actor, query.projectId), groups: [...counts].map(([libraryId, groupCount]) => ({ libraryId, groupCount })) }
      })
    },
    async execute(input: ScheduleCommand, session: Session): Promise<ScheduleCommandResult> {
      const command = parseScheduleCommand(input)
      if (command.origin !== 'real' || !/^[a-z0-9][\w-]{2,79}$/i.test(command.commandId))
        throw scheduleProblem('validation-failed', '正式WBS命令原编号或来源无效')
      const fingerprint = wbsDigest(command)
      // The original intent commits before business execution; a lost response can be resolved without a client body.
      await run(session, true, async (tx, actor) => {
        if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
          throw scheduleProblem('forbidden', '命令身份与当前可信身份不一致')
        const original = (await tx.select<{ fingerprint: string }>('SELECT fingerprint FROM schedule_command_intents WHERE command_id=?', [command.commandId]))[0]
        if (original && original.fingerprint !== fingerprint)
          throw scheduleProblem('conflict', '同一原编号不能改用另一份正文')
        if (!original) {
          if (await productionWbsLegacyCommandExists(tx, command.commandId))
            throw scheduleProblem('unavailable', '原库已有这个历史编号，不能用新正式命令覆盖其未知结果；保留原编号核对')
          await productionWbsProject(tx, command.projectId)
          await tx.execute('INSERT INTO schedule_command_intents VALUES (?,?,?,?,?,?,?)', [actor.workspaceId, actor.actorId, command.commandId, command.projectId, fingerprint, JSON.stringify(command), new Date().toISOString()])
        }
      })
      let confirmedAbsent = false
      try {
        return await run(session, true, async (tx, actor) => {
          const receipt = (await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM schedule_command_receipts WHERE command_id=?', [command.commandId]))[0]
          if (receipt) {
            if (receipt.fingerprint !== fingerprint)
              throw scheduleProblem('conflict', '原编号已用于另一份正文')
            return JSON.parse(receipt.result_json) as ScheduleCommandResult
          }
          confirmedAbsent = true
          if ((await tx.select('SELECT command_id FROM schedule_command_resolutions WHERE command_id=?', [command.commandId]))[0])
            throw scheduleProblem('conflict', '原编号已封存为未应用，迟到请求不能写入')
          const engine = await engineFor(tx, actor, { projectId: command.projectId, origin: 'real', includeDemo: false })
          await checkProductionWbsVersion(tx, actor, command)
          if (command.action.kind === 'create-group') {
            const selected = (await productionWbsEngineAdapters(actor).libraries!(tx)).find(row => row.id === (command.action as Extract<ScheduleCommand['action'], { kind: 'create-group' }>).draft.processLibraryId)
            if (!selected || selected.sourceVersion !== command.action.draft.librarySourceVersion)
              throw scheduleProblem('stale-source', '采用的正式工序库不可变版本依据不一致')
          }
          await assertScheduleUndoScope(tx, command, productionWbsVisibility)
          await prepareSelectedReferences(tx, actor, command, engine)
          let value
          try {
            value = command.action.kind === 'bind-contract'
              ? await bindCentralScheduleContract(tx, { ...actor, origin: 'real', sourceVersion: command.sourceVersion }, command.projectId, command.action.groupId, command.action.contractId, await productionWbsBoqLines(tx, actor, command.projectId, command.action.contractId), productionWbsBindingAdapters(actor))
              : await executeScheduleEngineAction(engine, command.action, command.projectId)
            await assertScheduleDependencyGraph(tx, command.projectId, productionWbsVisibility)
          }
          catch (cause) {
            if (cause instanceof ProjectRepositoryProblem)
              throw cause
            throw scheduleProblem('validation-failed', cause instanceof Error ? cause.message : 'WBS事实图校验未通过')
          }
          await advanceProductionWbsRevision(tx, command.projectId)
          const result: ScheduleCommandResult = { commandId: command.commandId, projectId: command.projectId, sourceVersion: await productionWbsVersion(tx, actor, command.projectId), value: value ?? null }
          await tx.execute('INSERT INTO schedule_command_receipts VALUES (?,?,?,?,?)', [command.commandId, command.projectId, actor.actorId, fingerprint, JSON.stringify(result)])
          return result
        })
      }
      catch (cause) {
        if (confirmedAbsent && cause instanceof ProjectRepositoryProblem && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(cause.problem.code)) {
          await run(session, true, (tx, actor) => resolveOriginal(tx, actor, { commandId: command.commandId, workspaceId: actor.workspaceId, actorId: actor.actorId, family: 'schedule', targetId: command.projectId, action: command.action.kind }))
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        }
        throw cause
      }
    },
    resolve(input: unknown, session: Session) {
      const value = descriptor(input)
      return run(session, true, (tx, actor) => resolveOriginal(tx, actor, value))
    },
  }
}
