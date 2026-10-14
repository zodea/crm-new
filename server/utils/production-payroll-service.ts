import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import type { WorkerRosterScope } from '../../app/lib/worker-roster/contract'
import type { BusinessSession } from './business-session'
import type { PayrollIdentitySource } from './payroll-service'
import type { ProductionStorage } from './production-storage'
import { createHash } from 'node:crypto'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { readPayrollStatement } from '../../app/lib/payroll/central-read'
import { hasProductionPayrollSchema } from '../../app/lib/payroll/central-schema'
import { payrollCommandRecoveryScope } from '../../app/lib/payroll/command-recovery-scope'
import { createCrewWorkerCommandService } from './crew-worker-command-service'
import { loadPayrollAManagementScopeFacts } from './payroll-management-scope-facts'
import { loadPayrollMigratedHollow } from './payroll-migrated-hollow'
import { createPayrollService } from './payroll-service'
import { createPayrollWorkbookService } from './payroll-workbook-service'
import { loadProductionCrewWorkers } from './production-crew-worker-record'
import { loadProductionPayrollAQuantityFacts } from './production-payroll-quantity-facts'
import { productionWorkerOriginals } from './production-worker-originals'
import { loadQuantityHollowFacts } from './quantity-hollow-facts'
import { loadQuantityHollowMigratedProof } from './quantity-hollow-migrated-proof'
import { createWorkerRosterService } from './worker-roster-service'
import { rosterHash } from './worker-roster-storage'

type Session = () => BusinessSession
type Service = ReturnType<typeof createPayrollService>
const hash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')

/** Only the existing authoritative master rows are read; no synchronization or revival. */
export async function productionPayrollIdentitySource(db: TransactionDb, actor: BusinessSession): Promise<PayrollIdentitySource> {
  const domain = createCrewWorkerCommandService({ initialState: await loadProductionCrewWorkers(db, actor) })
  const projects = await db.select<{ id: string, name: string, code: string }>('SELECT id,name,code FROM projects WHERE deleted_at IS NULL ORDER BY id')
  const ratios = domain.payrollRatioFacts()
  const facts = domain.payrollWorkerFacts()
  const fees = domain.payrollCrewFeeDefaults()
  const crews = domain.crewRows().map(row => ({ id: row.id, name: row.name, defaultPayRatio: ratios.rows.find(value => value.crewId === row.id)?.value ?? null, ratioExplicitlyConfigured: ratios.rows.find(value => value.crewId === row.id)?.explicitlyConfigured ?? false, feeDefaults: fees.rows.find(value => value.crewId === row.id) }))
  const workers = domain.workerRows().filter(row => !row.crewId || crews.some(crew => crew.id === row.crewId)).map(row => ({ ...facts.rows.find(value => value.workerId === row.id), id: row.id, name: row.name, crewId: row.crewId }))
  return { projects, crews, workers, version: hash({ projects, crews, workers }) }
}

export async function productionPayrollStatements(db: TransactionDb, scope: WorkerRosterScope) {
  await hasProductionPayrollSchema(db)
  const rows = []
  for (const id of scope.statementIds) {
    const row = await readPayrollStatement(db, id)
    if (row.hidden || row.deletedAt || row.status !== 'released' || row.recordKind !== 'central' || row.snapshot.state !== 'complete')
      throw payrollProblem('validation-failed', '所选正式工资不可见、未发放或冻结资料不完整')
    rows.push({ id, projectId: row.projectId, status: row.status, formatFamily: row.formatFamily, members: row.members.map(member => ({ workerId: member.workerId ?? '', workerName: member.workerName ?? '', isLeader: member.isLeader })), proof: rosterHash({ snapshot: row.snapshot.originalRaw, members: row.members }) })
  }
  return rows
}

/** A transaction-local service never re-enters the storage queue or owns a second database. */
export function productionPayrollInTransaction(db: TransactionDb, session: Session): Service {
  return createPayrollService({
    schemaInitialized: true,
    session,
    identities: () => productionPayrollIdentitySource(db, session()),
    transaction: work => work(db, session()),
    quantityFacts: (tx, query) => loadProductionPayrollAQuantityFacts(tx, query, session()),
    managementScopeFacts: loadPayrollAManagementScopeFacts,
    hollowFacts: (tx, query) => loadQuantityHollowFacts(tx, query, { migratedProof: loadQuantityHollowMigratedProof }),
    hollowProjection: loadPayrollMigratedHollow,
  })
}

function metadata(command: object) {
  const value = command as Record<string, unknown>
  const action = value.action as Record<string, unknown> | undefined
  if (typeof value.commandId !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(value.commandId) || typeof action?.kind !== 'string')
    throw payrollProblem('validation-failed', '原工资命令身份或动作无效')
  const target = value.target as Record<string, unknown> | undefined
  const targetId = [value.statementId, value.recordId, target?.adjustmentId, target?.eventId, target?.statementId].find(id => typeof id === 'string') ?? null
  return { commandId: value.commandId, action: action.kind, targetId: targetId as string | null, scopeId: payrollCommandRecoveryScope(command) }
}
interface Intent { method: string, action: string, target_id: string | null, command_json: string, fingerprint: string }
interface Journal { action: string, target_id: string | null, fingerprint: string, outcome: 'applied' | 'not-applied', result_json: string | null }

/** Stable original commands and results are server history, including multi-step P7 execution. */
export function createProductionPayrollService(storage: ProductionStorage) {
  const active = new Map<string, { fingerprint: string, promise: Promise<unknown> }>()
  function authorize(session: Session, write = false) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('payroll:read') || (write && !actor.capabilities.includes('payroll:write')))
      throw payrollProblem('forbidden', '当前身份无此正式工作区的工资权限')
    return structuredClone(actor)
  }
  async function transaction<T>(session: Session, work: (db: TransactionDb) => Promise<T>) {
    const actor = authorize(session)
    return storage.withTransaction(async (db) => {
      await hasProductionPayrollSchema(db)
      const result = await work(db)
      if (hash(authorize(session)) !== hash(actor))
        throw payrollProblem('forbidden', '工资操作期间身份、工作区或权限变化，原提交编号继续保留')
      return result
    })
  }
  function service(session: Session): Service {
    const invoke = async (method: keyof Service, args: unknown[]) => transaction(session, async (db) => {
      const actor = session()
      if (!['project:list:read', 'crew:list:read', 'worker:list:read'].every(capability => actor.capabilities.includes(capability))) {
        const configuring = ['aConfig', 'c1Config', 'c2Config', 'aFeeConfig', 'aRounding'].includes(method)
        const form = ['aForm', 'c1Form', 'c2Form'].includes(method)
        const target = args[1] as { statementId?: string | null, draft?: unknown } | undefined
        const [head] = form && target?.statementId ? await db.select<{ status: string }>('SELECT status FROM wage_statements WHERE id=?', [target.statementId]) : []
        if (configuring || (form && (head?.status !== 'released' || target?.draft !== undefined)) || (method === 'dayworkForm' && !(args[1] as { recordId?: string | null })?.recordId))
          throw payrollProblem('forbidden', '新建候选和当前配置需要独立项目、班组与工人目录权限；已发原工资仍可按工资权限读取')
      }
      const local = productionPayrollInTransaction(db, session)
      const operation = local[method] as (...parameters: unknown[]) => Promise<unknown>
      return operation(...args)
    })
    const unavailable = async (): Promise<never> => {
      throw payrollProblem('unavailable', '正式工资服务只允许同一事务中的领域调用')
    }
    const template = createPayrollService({ schemaInitialized: true, session, identities: unavailable, transaction: unavailable })
    return Object.fromEntries(Object.keys(template).map(method => [method, (...args: unknown[]) => method.startsWith('execute') ? execute(method as keyof Service, args[0] as object, session) : invoke(method as keyof Service, args)])) as Service
  }
  async function execute(method: keyof Service, command: object, session: Session) {
    const actor = authorize(session, true)
    const request = command as Record<string, unknown>
    if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId || request.origin !== 'real' || request.requiredCapability !== 'payroll:write')
      throw payrollProblem('forbidden', '原工资提交身份、来源或能力不匹配')
    storage.assertBusinessWrite()
    const meta = metadata(command)
    const encoded = payrollCanonical(command)
    const fingerprint = hash(command)
    const key = payrollCanonical([actor.workspaceId, actor.actorId, meta.commandId])
    const running = active.get(key)
    if (running) {
      if (running.fingerprint !== fingerprint)
        throw payrollProblem('conflict', '原工资提交在处理中，编号不能复用另一正文')
      return running.promise
    }
    const promise = (async () => {
      await transaction(session, async (db) => {
        const [old] = await db.select<Intent>('SELECT * FROM payroll_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, meta.commandId])
        if (old) {
          if (old.method !== method || old.fingerprint !== fingerprint || old.command_json !== encoded)
            throw payrollProblem('conflict', '原工资编号已绑定另一动作或正文，不能改用')
        }
        else {
          const [sealed] = await db.select<Journal>('SELECT * FROM payroll_command_journal WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, meta.commandId])
          if (sealed)
            throw payrollProblem('conflict', '原工资提交已受控封存，不能迟到应用')
          await db.execute('INSERT INTO payroll_command_intents VALUES(?,?,?,?,?,?,?,?,?)', [actor.workspaceId, actor.actorId, meta.commandId, method, meta.action, meta.targetId, encoded, fingerprint, new Date().toISOString()])
        }
      })
      const previous = await transaction(session, async db => (await db.select<Journal>('SELECT * FROM payroll_command_journal WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, meta.commandId]))[0])
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.action !== meta.action || previous.target_id !== meta.targetId)
          throw payrollProblem('unavailable', '原工资回执与固定请求无法互证')
        if (previous.outcome === 'applied')
          return JSON.parse(previous.result_json!)
        const problem = payrollProblem('conflict', '原工资命令已明确未应用，请保留输入重新核对依据')
        Object.assign(problem.problem, { commandId: meta.commandId, commandOutcome: 'not-applied' })
        throw problem
      }
      try {
        const result = await transaction(session, async (db) => {
          const hasDirectory = ['project:list:read', 'crew:list:read', 'worker:list:read'].every(capability => actor.capabilities.includes(capability))
          if (!hasDirectory && ['execute', 'executeFees', 'executeARounding', 'executeAttendance', 'executeC1', 'executeC2', 'executeDaywork', 'executeHollow'].includes(method) && !(await db.select('SELECT command_id FROM payroll_command_receipts WHERE command_id=?', [meta.commandId])).length)
            throw payrollProblem('forbidden', '本次工资或来源写入需要当前独立目录资格，请保留原输入和提交编号')
          const local = productionPayrollInTransaction(db, session)
          const result = await (local[method] as (input: object) => Promise<unknown>)(command)
          await db.execute('INSERT INTO payroll_command_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [actor.workspaceId, actor.actorId, meta.commandId, 'payroll', meta.action, meta.targetId, meta.scopeId, fingerprint, encoded, 'applied', payrollCanonical(result), new Date().toISOString()])
          return result
        })
        return result
      }
      catch (cause) {
        const problem = (cause as { problem?: { code: string, commandOutcome?: string } }).problem
        if (problem?.commandOutcome === 'not-applied')
          await transaction(session, db => db.execute('INSERT INTO payroll_command_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [actor.workspaceId, actor.actorId, meta.commandId, 'payroll', meta.action, meta.targetId, meta.scopeId, fingerprint, encoded, 'not-applied', null, new Date().toISOString()]))
        throw cause
      }
    })()
    active.set(key, { fingerprint, promise })
    try {
      return await promise
    }
    finally {
      if (active.get(key)?.promise === promise)
        active.delete(key)
    }
  }
  async function resolve(descriptor: CommandRecoveryDescriptor, session: Session) {
    const actor = authorize(session, true)
    if (descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || descriptor.family !== 'payroll' || !/^[a-z0-9][\w-]{2,79}$/i.test(descriptor.commandId))
      throw payrollProblem('forbidden', '原工资恢复身份或命令族不匹配')
    const key = payrollCanonical([actor.workspaceId, actor.actorId, descriptor.commandId])
    if (active.has(key))
      await active.get(key)!.promise.catch(() => undefined)
    return transaction(session, async (db) => {
      const parameters = [actor.workspaceId, actor.actorId, descriptor.commandId]
      const [intent] = await db.select<Intent>('SELECT * FROM payroll_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', parameters)
      const [journal] = await db.select<Journal>('SELECT * FROM payroll_command_journal WHERE workspace_id=? AND actor_id=? AND command_id=?', parameters)
      if ([intent, journal].some(row => row && (row.action !== descriptor.action || row.target_id !== descriptor.targetId)))
        throw payrollProblem('conflict', '原工资恢复动作或目标不匹配')
      if (journal?.outcome === 'not-applied')
        return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
      const command = intent ? JSON.parse(intent.command_json) as object : null
      if (intent && (!command || hash(command) !== intent.fingerprint))
        throw payrollProblem('unavailable', '原工资固定正文摘要无法核实')
      if (command && ((descriptor.scopeId !== undefined && descriptor.scopeId !== payrollCommandRecoveryScope(command)) || (descriptor.targetId === null && descriptor.scopeId === undefined)))
        throw payrollProblem('conflict', '原工资恢复范围或请款簿不匹配，请保留原记录')
      const isBatch = intent?.method === 'executeBatch'
      const table = isBatch ? 'payroll_batch_command_receipts' : 'payroll_command_receipts'
      const [receipt] = await db.select<{ command_json: string | null, result_json: string }>(`SELECT command_json,result_json FROM ${table} WHERE command_id=?`, [descriptor.commandId])
      let resumedBatch = false
      if (intent && isBatch && descriptor.action === 'execute-batch-original' && !receipt) {
        const [attempt] = await db.select<{ plan_id: string, payroll_command_id: string, command_json: string, command_hash: string }>('SELECT plan_id,payroll_command_id,command_json,command_hash FROM payroll_batch_attempts WHERE execute_command_id=? AND state=\'prepared\'', [descriptor.commandId])
        if (attempt) {
          if (hash(JSON.parse(attempt.command_json)) !== attempt.command_hash)
            throw payrollProblem('unavailable', 'P7固定原执行正文无法核实')
          const [originalReceipt] = await db.select<{ command_json: string | null }>('SELECT command_json FROM payroll_command_receipts WHERE command_id=?', [attempt.payroll_command_id])
          if (originalReceipt) {
            if (originalReceipt.command_json === null || hash(JSON.parse(originalReceipt.command_json)) !== hash(JSON.parse(attempt.command_json)))
              throw payrollProblem('unavailable', 'P7原工资成功回执与固定执行不能互证')
            resumedBatch = true
          }
          else {
            storage.assertBusinessWrite()
            const problem = { code: 'conflict', message: '原执行编号已核实未应用并封存', commandId: descriptor.commandId, commandOutcome: 'not-applied' }
            await db.execute('UPDATE payroll_batch_attempts SET state=\'not-applied\',problem_json=?,finished_at=? WHERE execute_command_id=? AND state=\'prepared\'', [payrollCanonical(problem), new Date().toISOString(), descriptor.commandId])
            await db.execute('UPDATE payroll_batch_plans SET state=\'ready\',revision=revision+1 WHERE id=? AND state=\'prepared\'', [attempt.plan_id])
          }
        }
      }
      if (receipt || resumedBatch) {
        if (!intent || !command || (receipt && (receipt.command_json === null || hash(JSON.parse(receipt.command_json)) !== intent.fingerprint)))
          throw payrollProblem('unavailable', '原领域回执缺少同一授权原命令证明')
        const local = productionPayrollInTransaction(db, session)
        // A reliable original receipt is required before invoking any replay path.
        const result = await (local[intent.method as keyof Service] as (input: object) => Promise<unknown>)(command)
        if (journal && (journal.fingerprint !== intent.fingerprint || journal.result_json === null || hash(JSON.parse(journal.result_json)) !== hash(result)))
          throw payrollProblem('unavailable', '原统一结果与领域成功回执不一致')
        if (!journal)
          await db.execute('INSERT INTO payroll_command_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [...parameters, 'payroll', descriptor.action, descriptor.targetId, descriptor.scopeId ?? '', intent.fingerprint, intent.command_json, 'applied', payrollCanonical(result), new Date().toISOString()])
        return { outcome: 'applied' as const, command, result }
      }
      if (journal)
        throw payrollProblem('unavailable', '原统一成功结果缺少领域可靠回执，不能重执行')
      await db.execute('INSERT INTO payroll_command_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [...parameters, 'payroll', descriptor.action, descriptor.targetId, descriptor.scopeId ?? '', intent?.fingerprint ?? 'sealed', intent?.command_json ?? null, 'not-applied', null, new Date().toISOString()])
      return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
    })
  }
  function workbook(session: Session) {
    return createPayrollWorkbookService({ session, beforeWrite: () => storage.assertBusinessWrite(), transaction: work => transaction(session, work), payroll: db => productionPayrollInTransaction(db, session), roster: db => createWorkerRosterService({ schemaInitialized: true, session, originals: productionWorkerOriginals, transaction: work => work(db), source: async () => ({ workers: createCrewWorkerCommandService({ initialState: await loadProductionCrewWorkers(db, session()) }).workerRows(), projects: (await productionPayrollIdentitySource(db, session())).projects }), statements: productionPayrollStatements }) })
  }
  return { forSession: service, resolve, workbook }
}
