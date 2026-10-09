import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor, CommandResolution } from '../../app/lib/forms/command-recovery'
import type { QuantityBoqSource } from '../../app/lib/quantity/central-boq'
import type { QuantityBatchReadQuery, QuantityCommand, QuantityCommandResult, QuantityReadQuery, QuantityUnitReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityPhotoIdentity } from '../../app/lib/quantity/central-photo'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { decodeQuantityCommand } from '../../app/lib/quantity/central-command-decoder'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { isQuantityHollowActionKind, parseQuantityHollowCommand } from '../../app/lib/quantity/central-hollow-validation'
import { createQuantityService, quantityCommandConsumption } from '../../app/lib/quantity/central-service'
import { quantityRecoveryDescriptor } from '../../app/lib/quantity/command-recovery'
import { isStableRouteIdentity } from '../../app/lib/util/stable-route-identity'
import { readProductionBoqQuantityFacts } from './production-boq-record'
import { assertProductionQuantitySchema, productionQuantityPeople, productionQuantityProjects, productionQuantityVersion, quantityCanonical, quantityDigest, readProductionQuantityPhoto, validateProductionQuantityVersion, writeProductionQuantityOriginal } from './production-quantity-record'
import { productionScheduleVisibility as productionWbsVisibility } from './production-schedule-visibility'
import { loadQuantityHollowMigratedProof } from './quantity-hollow-migrated-proof'
import { createQuantityHollowService } from './quantity-hollow-service'
import { parseQuantityCommand } from './quantity-request'

type Session = () => BusinessSession
interface Receipt { project_id: string, fingerprint: string, request_json: string, result_json: string }
interface Intent { project_id: string, fingerprint: string, request_json: string }
const commandKey = (command: Pick<QuantityCommand, 'workspaceId' | 'actorId' | 'commandId'>) => [command.workspaceId, command.actorId, command.commandId]

export { quantityRecoveryDescriptor } from '../../app/lib/quantity/command-recovery'

async function replay(db: TransactionDb, command: QuantityCommand): Promise<QuantityCommandResult | null> {
  const [sealed] = await db.select<{ command_id: string }>('SELECT command_id FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey(command))
  if (sealed)
    throw quantityProblem('conflict', '原工程量提交已明确未应用，迟到请求不能复活')
  const [row] = await db.select<Receipt>('SELECT * FROM quantity_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey(command))
  if (!row)
    return null
  if (row.project_id !== command.projectId || row.fingerprint !== quantityDigest(command) || row.request_json !== quantityCanonical(command))
    throw quantityProblem('conflict', '同一原编号已绑定其他项目、动作或正文')
  try {
    return decodeQuantityCommand(JSON.parse(row.result_json), command)
  }
  catch { throw quantityProblem('unavailable', '工程量原回执与固定请求无法互证') }
}

/** Reuses the domain core inside the one storage transaction, without queue re-entry or mirroring. */
export function productionQuantityInTransaction(db: TransactionDb, session: Session, options: { boq?: QuantityBoqSource } = {}) {
  return createQuantityService({
    workspaceId: session().workspaceId,
    database: { withTransaction: work => work(db) },
    authoritativeMasters: true,
    planVisibility: productionWbsVisibility,
    project: async id => (await productionQuantityProjects(db)).find(project => project.id === id) ?? null,
    projects: () => productionQuantityProjects(db),
    people: context => productionQuantityPeople(db, context),
    boq: options.boq ?? ((projectId, context) => readProductionBoqQuantityFacts(db, projectId, context as BusinessSession)),
    sourceVersion: productionQuantityVersion,
    validateSourceVersion: validateProductionQuantityVersion,
    writeOriginal: writeProductionQuantityOriginal,
    readPhoto: readProductionQuantityPhoto,
    commands: {
      replay: (tx, command) => replay(tx, command),
      async complete(tx, command, _fingerprint, saved) {
        await tx.execute('INSERT INTO quantity_revisions(project_id,revision) VALUES (?,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1', [command.projectId])
        const result = { ...saved, commandId: command.commandId, sourceVersion: await productionQuantityVersion(tx, command.projectId, command, quantityCommandConsumption(command)) }
        await tx.execute('INSERT INTO quantity_commands VALUES (?,?,?,?,?,?,?,?)', [...commandKey(command), command.projectId, quantityDigest(command), quantityCanonical(command), quantityCanonical(result), new Date().toISOString()])
        return result
      },
    },
  })
}

function hollowInTransaction(db: TransactionDb, session: Session) {
  return createQuantityHollowService({
    session,
    authoritativeMasters: true,
    projects: async () => (await productionQuantityProjects(db)).map(project => ({ ...project, dataOrigin: 'real' as const })),
    people: () => productionQuantityPeople(db, session()),
    migratedProof: loadQuantityHollowMigratedProof,
    transaction: work => work(db, session()),
  })
}

/** Exact original commands and durable results survive process restarts. */
export function createProductionQuantityService(storage: ProductionStorage, options: { boq?: (db: TransactionDb, projectId: string, actor: BusinessSession) => ReturnType<QuantityBoqSource> } = {}) {
  const active = new Map<string, { fingerprint: string, promise: Promise<QuantityCommandResult> }>()
  function authorize(session: Session, write = false) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId
      || !actor.capabilities.includes('quantity:read') || !actor.capabilities.includes('project:list:read') || (write && !actor.capabilities.includes('quantity:write'))) {
      throw quantityProblem('forbidden', '当前身份无权读取或修改此正式工程量工作区')
    }
    return actor
  }
  async function run<T>(session: Session, write: boolean, work: (db: TransactionDb) => Promise<T>) {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (db) => {
      await assertProductionQuantitySchema(db)
      const result = await work(db)
      if (quantityCanonical(authorize(session, write)) !== quantityCanonical(actor))
        throw quantityProblem('forbidden', '工程量操作期间权限、来源或身份变化，原提交编号继续保留')
      return result
    })
  }
  const local = (db: TransactionDb, session: Session) => productionQuantityInTransaction(db, session, { boq: options.boq ? (projectId, context) => options.boq!(db, projectId, context as BusinessSession) : undefined })

  async function execute(input: unknown, session: Session): Promise<QuantityCommandResult> {
    const command = parseQuantityCommand(input)
    const actor = authorize(session, true)
    if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId || !isStableRouteIdentity(command.commandId))
      throw quantityProblem('forbidden', '原工程量提交身份或稳定编号不匹配')
    const encoded = quantityCanonical(command)
    const fingerprint = quantityDigest(command)
    const key = quantityCanonical(commandKey(command))
    const previous = active.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw quantityProblem('conflict', '原提交在处理中，不能改用另一正文')
      return previous.promise
    }
    const promise = (async () => {
      await run(session, true, async (db) => {
        if (!(await productionQuantityProjects(db)).some(project => project.id === command.projectId))
          throw quantityProblem('not-found', '原项目不可见或已删除')
        const [sealed] = await db.select('SELECT command_id FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey(command))
        if (sealed)
          throw quantityProblem('conflict', '原提交已封存为未应用，不能迟到重建')
        const [intent] = await db.select<Intent>('SELECT * FROM quantity_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey(command))
        if (intent && (intent.project_id !== command.projectId || intent.fingerprint !== fingerprint || intent.request_json !== encoded))
          throw quantityProblem('conflict', '原编号已固定其他项目、动作或完整正文')
        if (!intent)
          await db.execute('INSERT INTO quantity_command_intents VALUES (?,?,?,?,?,?,?)', [...commandKey(command), command.projectId, fingerprint, encoded, new Date().toISOString()])
      })
      if (quantityCanonical(authorize(session, true)) !== quantityCanonical(actor))
        throw quantityProblem('forbidden', '原请求固定后权限或身份变化，请先核对原提交')
      return run(session, true, async (db) => {
        const recovered = await replay(db, command)
        if (recovered)
          return recovered
        if (isQuantityHollowActionKind(command.action.kind)) {
          const result = await hollowInTransaction(db, session).executeHollow(parseQuantityHollowCommand(command))
          await db.execute('INSERT INTO quantity_commands VALUES (?,?,?,?,?,?,?,?)', [...commandKey(command), command.projectId, fingerprint, encoded, quantityCanonical(result), new Date().toISOString()])
          return result
        }
        if (command.action.kind === 'save-template' && !options.boq) {
          const selected = []
          for (const line of command.action.draft.lines) {
            if (!line.boqLineId)
              continue
            const [prior] = line.id ? await db.select<{ boq_line_id: string | null }>('SELECT boq_line_id FROM house_type_template_items WHERE id=?', [line.id]) : []
            if (prior?.boq_line_id !== line.boqLineId)
              selected.push(line)
          }
          if (selected.length) {
            const source = await readProductionBoqQuantityFacts(db, command.projectId, actor, { lineIds: selected.map(line => line.boqLineId!) })
            for (const line of selected) {
              const actual = source.lines.find(row => row.id === line.boqLineId)
              if (!actual || !actual.eligible || !line.boqBindingVersion || line.boqBindingVersion !== actual.bindingVersion)
                throw quantityProblem('stale-source', '所选真实清单原量、原件或施工主合同资格变化，请保留草稿重新选择；不会按名称替换来源')
            }
          }
        }
        return local(db, session).execute(command, session())
      })
    })()
    active.set(key, { fingerprint, promise })
    void promise.finally(() => {
      if (active.get(key)?.promise === promise)
        active.delete(key)
    }).catch(() => undefined)
    return promise
  }

  async function resolve(descriptor: CommandRecoveryDescriptor, session: Session): Promise<CommandResolution<QuantityCommandResult>> {
    const actor = authorize(session, true)
    if (descriptor.family !== 'quantity' || descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId
      || !isStableRouteIdentity(descriptor.commandId) || !descriptor.scopeId || !descriptor.action) {
      throw quantityProblem('forbidden', '原工程量恢复身份或项目范围无效')
    }
    const key = [actor.workspaceId, actor.actorId, descriptor.commandId]
    await active.get(quantityCanonical(key))?.promise.catch(() => undefined)
    return run(session, true, async (db) => {
      if (!(await productionQuantityProjects(db)).some(project => project.id === descriptor.scopeId))
        throw quantityProblem('not-found', '原工程量项目不可见，不能切换来源恢复')
      const [intent] = await db.select<Intent>('SELECT * FROM quantity_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
      let original: QuantityCommand | null = null
      if (intent) {
        const command = parseQuantityCommand(JSON.parse(intent.request_json))
        if (intent.fingerprint !== quantityDigest(command) || quantityCanonical(quantityRecoveryDescriptor(command)) !== quantityCanonical(descriptor))
          throw quantityProblem('conflict', '恢复描述与原工程量项目、目标或动作不同')
        original = command
      }
      const [sealed] = await db.select<{ descriptor_json: string | null }>('SELECT descriptor_json FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
      if (sealed && sealed.descriptor_json !== null && sealed.descriptor_json !== quantityCanonical(descriptor))
        throw quantityProblem('conflict', '原封存编号属于另一恢复范围')
      if (sealed) {
        if ((await db.select('SELECT command_id FROM quantity_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', key)).length)
          throw quantityProblem('unavailable', '原回执与未应用封存互相冲突，停止恢复')
        return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
      }
      if (original) {
        const result = await replay(db, original)
        if (result)
          return { outcome: 'applied' as const, result }
      }
      if (!sealed)
        await db.execute('INSERT INTO quantity_resolutions(workspace_id,actor_id,command_id,resolved_at,descriptor_json) VALUES (?,?,?,?,?)', [...key, new Date().toISOString(), quantityCanonical(descriptor)])
      return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
    })
  }

  return {
    execute,
    resolve,
    forSession(session: Session) {
      return {
        region: (query: QuantityReadQuery) => run(session, false, db => local(db, session).region(query, session())),
        templates: (query: QuantityReadQuery) => run(session, false, db => local(db, session).templates(query, session())),
        stages: (query: QuantityReadQuery) => run(session, false, db => local(db, session).stages(query, session())),
        assignments: (query: QuantityReadQuery) => run(session, false, db => local(db, session).assignments(query, session())),
        workspace: (query: QuantityReadQuery) => run(session, false, db => local(db, session).workspace(query, session())),
        completion: (query: QuantityUnitReadQuery) => run(session, false, db => local(db, session).completion(query, session())),
        batchPlan: (query: QuantityBatchReadQuery) => run(session, false, db => local(db, session).batchPlan(query, session())),
        photo: (query: QuantityReadQuery & QuantityPhotoIdentity) => run(session, false, db => local(db, session).photo(query, session())),
        variance: (query: QuantityReadQuery) => run(session, false, db => local(db, session).variance(query, session())),
        boq: (query: QuantityReadQuery) => run(session, false, db => local(db, session).boq(query, session())),
        hollow: (query: QuantityUnitReadQuery) => run(session, false, db => hollowInTransaction(db, session).hollow(query)),
        execute: (command: unknown) => execute(command, session),
      }
    },
  }
}
