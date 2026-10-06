import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SupplierCredentialCommand, SupplierCredentialFileQuery } from '../../app/lib/supplier/credential-contract'
import type { SupplierTaxpayerCommand } from '../../app/lib/supplier/taxpayer-verification'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import type { SupplierCredentialScope } from './supplier-credential-service'
import { isDeepStrictEqual } from 'node:util'
import { SUPPLIER_DETAIL_READ_SCHEMA, SUPPLIER_LIST_READ_SCHEMA } from '../../app/lib/supplier/read-contract'
import { buildSupplierDetailRead, buildSupplierListPage, parseSupplierDetailQuery, parseSupplierListQuery } from '../../app/lib/supplier/repository'
import { projectSupplierPartialFacts, readProductionSupplierFacts, supplierFactUnavailableSources } from './production-supplier-facts'
import { productionSupplierFailure as fail, loadProductionSuppliers, saveProductionSuppliers } from './production-supplier-record'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from './read-meta'
import { parseSupplierCommandRequest, parseSupplierImportCommandRequest } from './supplier-command-request'
import { createSupplierCommandService } from './supplier-command-service'
import { createPersistentSupplierCredentialOcrService } from './supplier-credential-ocr-service'
import { createSupplierCredentialService } from './supplier-credential-service'
import { createSupplierTaxpayerService } from './supplier-taxpayer-service'

type Session = () => BusinessSession
export function productionSupplierId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9][\w-]{2,79}$/i.test(value))
    return fail('validation-failed', '分供方身份或提交编号无效，请重新核对。')
  return value
}
function masterRequest(value: unknown, routeId?: string, imported = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('validation-failed', '分供方命令格式无效。')
  const input = value as Record<string, unknown>
  const allowed = imported ? ['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'draft'] : ['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments']
  if (Object.keys(input).some(key => !allowed.includes(key)))
    return fail('validation-failed', '正式分供方命令含不受支持的字段。')
  productionSupplierId(input.commandId)
  if (routeId)
    productionSupplierId(routeId)
  if (input.draft && typeof input.draft === 'object' && 'id' in input.draft && input.draft.id !== routeId)
    fail('validation-failed', '表单分供方身份与当前保存目标不一致。')
  return imported ? parseSupplierImportCommandRequest(value) : parseSupplierCommandRequest(value, routeId)
}

export function createProductionSupplierService(storage: ProductionStorage, options: { now?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString())
  const recognitionPending = new Map<string, { fingerprint: string, promise: Promise<unknown> }>()
  function authorize(session: Session, write = false, capability = 'supplier:write') {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('supplier:list:read') || (write && !actor.capabilities.includes(capability)))
      fail('forbidden', '当前会话无此工作区的分供方权限。')
    return actor
  }
  async function run<T>(session: Session, write: boolean, operation: (service: ReturnType<typeof createSupplierCommandService>, actor: BusinessSession, timestamp: string, tx: TransactionDb) => T | Promise<T>, commandId?: string, kind?: 'master' | 'credential', capability = 'supplier:write'): Promise<T> {
    const actor = authorize(session, write, capability)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      authorize(session, write, capability)
      if (commandId) {
        productionSupplierId(commandId)
        if ((await tx.select('SELECT command_id FROM supplier_command_resolutions WHERE command_id=?', [commandId])).length)
          fail('conflict', '原提交已确认为未保存并封存，迟到请求不会写入。')
        const previous = (await tx.select<{ kind: string }>('SELECT kind FROM supplier_command_receipts WHERE command_id=?', [commandId]))[0]
        if (previous && previous.kind !== kind)
          fail('conflict', '此提交编号已用于其他分供方操作。')
      }
      const before = await loadProductionSuppliers(tx, actor)
      // 一次事务内状态、来源版本及 asOf 共享同一时刻，避免上海午夜跨界时响应内部矛盾。
      const timestamp = now()
      const service = createSupplierCommandService({ initialState: before, now: () => timestamp })
      const result = await operation(service, actor, timestamp, tx)
      const after = service.snapshot()
      if (!isDeepStrictEqual(after, before)) {
        if (!write)
          fail('unavailable', '只读资料投影意外改变了持久事实，请停止操作并核对。')
        storage.assertBusinessWrite()
        await saveProductionSuppliers(tx, after, before, actor)
      }
      if (JSON.stringify(authorize(session, write, capability)) !== JSON.stringify(actor))
        fail('forbidden', '操作期间会话或权限变化，本次提交已撤回。')
      return result
    })
  }
  const ports = (service: ReturnType<typeof createSupplierCommandService>) => ({ read: service.readCredentialScope, transact: service.transactCredentialScope })
  const readContext = (service: ReturnType<typeof createSupplierCommandService>, actor: BusinessSession, timestamp: string, facts: Awaited<ReturnType<typeof readProductionSupplierFacts>>, list: boolean) => ({ ...facts, suppliers: service.rows(), projectSuppliers: [], invoices: [], sourceVersion: `production-${service.sourceVersion()}`, asOf: timestamp, capabilities: [...actor.capabilities], unavailableSources: supplierFactUnavailableSources(facts, list), incompleteContractSource: true })
  function readMeta(service: ReturnType<typeof createSupplierCommandService>, actor: BusinessSession, timestamp: string, schemaVersion: string, operation: string, dataOrigin: 'real' | 'demo', scope: unknown, facts: Awaited<ReturnType<typeof readProductionSupplierFacts>>) {
    return createReadMeta({ session: actor, schemaVersion, operation, dataOrigin, asOf: timestamp, coverage: dataOrigin === 'real' ? 'complete' : 'unknown', scope: typeof scope === 'object' && scope !== null ? readQueryScope(scope) : scope, sources: dataOrigin === 'demo'
      ? [{ key: 'suppliers', state: 'not-requested', sourceVersion: null, asOf: null }]
      : [{ key: 'suppliers', state: 'readable', sourceVersion: service.sourceVersion(), asOf: timestamp }, ...facts.sources] })
  }
  const instance = {
    list(input: Record<string, unknown>, session: Session) {
      return run(session, false, async (service, actor, timestamp, tx) => {
        const query = parseSupplierListQuery(input)
        if (query.includeDemo)
          fail('forbidden', '正式分供方不接受测试数据来源。')
        const facts = await readProductionSupplierFacts(tx, actor, timestamp)
        const projection = buildSupplierListPage({ ...readContext(service, actor, timestamp, facts, true), query })
        return withOriginReadMeta(projection, { real: readMeta(service, actor, timestamp, SUPPLIER_LIST_READ_SCHEMA, 'supplier-list', 'real', query, facts), demo: readMeta(service, actor, timestamp, SUPPLIER_LIST_READ_SCHEMA, 'supplier-list', 'demo', query, facts) })
      })
    },
    detail(id: string, input: Record<string, unknown>, session: Session) {
      return run(session, false, async (service, actor, timestamp, tx) => {
        const query = parseSupplierDetailQuery(id, input)
        if (query.origin !== 'real' || query.includeDemo)
          fail('forbidden', '正式分供方不接受测试数据来源。')
        const facts = await readProductionSupplierFacts(tx, actor, timestamp)
        const projection = buildSupplierDetailRead({ ...readContext(service, actor, timestamp, facts, false), query })
        return withReadMeta(projectSupplierPartialFacts(projection, facts), readMeta(service, actor, timestamp, SUPPLIER_DETAIL_READ_SCHEMA, 'supplier-detail', 'real', query, facts))
      })
    },
    execute(value: unknown, session: Session, routeId?: string) {
      const command = masterRequest(value, routeId)
      return run(session, true, (service, actor) => service.execute(command as Parameters<typeof service.execute>[0], actor), command.commandId, 'master')
    },
    importRow(value: unknown, session: Session) {
      const command = masterRequest(value, undefined, true)
      return run(session, true, (service, actor) => service.importRow(command, actor), command.commandId, 'master')
    },
    form(id: string, session: Session) {
      productionSupplierId(id)
      return run(session, false, (service, actor) => service.form(id, actor))
    },
    rows(session: Session) {
      return run(session, false, service => ({ rows: service.rows(), sourceVersion: service.sourceVersion() }))
    },
    credentials(supplierId: string, session: Session) {
      productionSupplierId(supplierId)
      return run(session, false, (service, actor, timestamp) => createSupplierCredentialService(ports(service), { now: () => timestamp }).read(supplierId, 'real', actor))
    },
    file(query: SupplierCredentialFileQuery, session: Session) {
      if (query.origin !== 'real')
        return fail('forbidden', '正式原件不接受其他数据来源。')
      return run(session, false, (service, actor) => createSupplierCredentialService(ports(service)).file(query, actor))
    },
    executeCredential(command: SupplierCredentialCommand, session: Session) {
      return run(session, true, (service, actor, timestamp) => createSupplierCredentialService(ports(service), { now: () => timestamp }).execute(command, actor), command.commandId, 'credential', 'supplier-credential:write')
    },
    recordTaxpayer(command: SupplierTaxpayerCommand, session: Session) {
      return run(session, true, (service, actor) => createSupplierTaxpayerService(ports(service)).execute(command, actor), command.commandId, 'credential')
    },
    /** External OCR waits outside this scope; its eventual mutation reopens fresh disk facts. */
    scope(supplierId: string, session: Session) {
      return run(session, false, (service, actor) => {
        createSupplierCredentialService(ports(service)).read(supplierId, 'real', actor)
        return service.readCredentialScope(supplierId)
      })
    },
    transactCredential<T>(supplierId: string, operation: (scope: SupplierCredentialScope) => {
      changed: boolean
      value: T
      commandId?: string
    }, session: Session, commandId: string) {
      return run(session, true, (service, actor) => {
        if (!actor.capabilities.includes('supplier-credential:write') || !actor.capabilities.includes('supplier-credential:read'))
          fail('forbidden', '当前会话无证照读取和写入权限。')
        return service.transactCredentialScope(supplierId, operation)
      }, commandId, 'credential', 'supplier-credential:write')
    },
    async executeOcr(command: Extract<SupplierCredentialCommand, { action: 'ocr-recognize' | 'ocr-confirm' }>, session: Session, recognize: Parameters<typeof createPersistentSupplierCredentialOcrService>[1]['recognize']) {
      const actor = authorize(session, true, 'supplier-credential:write')
      storage.assertBusinessWrite()
      productionSupplierId(command.commandId)
      const fingerprint = JSON.stringify(command)
      const key = `${actor.workspaceId}:${actor.actorId}:${command.commandId}`
      const pending = recognitionPending.get(key)
      if (pending) {
        if (pending.fingerprint !== fingerprint)
          fail('conflict', '此提交编号正在处理其他证照内容。')
        const result = await pending.promise
        authorize(session, true, 'supplier-credential:write')
        return result as Awaited<ReturnType<ReturnType<typeof createPersistentSupplierCredentialOcrService>['recognize']>>
      }
      const service = createPersistentSupplierCredentialOcrService({
        read: id => instance.scope(id, session),
        file: query => instance.file(query, session),
        transact: (id, operation) => instance.transactCredential(id, operation, session, command.commandId),
      }, { recognize })
      const promise = command.action === 'ocr-recognize' ? service.recognize(command, session) : service.confirm(command, actor)
      recognitionPending.set(key, { fingerprint, promise })
      try {
        return await promise
      }
      finally {
        if (recognitionPending.get(key)?.promise === promise)
          recognitionPending.delete(key)
      }
    },
    async command(commandId: string, session: Session) {
      productionSupplierId(commandId)
      const actor = authorize(session)
      return storage.withTransaction(async (tx) => {
        const state = await loadProductionSuppliers(tx, actor)
        const master = state.commands.get(commandId)
        const result = master ?? [...state.credentialScopes.values()].flatMap(item => item.commands).find(item => item.commandId === commandId)?.result ?? null
        if (result && (master || 'verification' in result ? !actor.capabilities.includes('supplier:write') : !actor.capabilities.includes('supplier-credential:read')))
          fail('forbidden', '当前权限不能读取此原提交结果。')
        if (JSON.stringify(authorize(session)) !== JSON.stringify(actor))
          fail('forbidden', '读取期间会话变化，请重新登录。')
        return { commandId, outcome: result ? 'applied' as const : 'not-applied' as const, result }
      })
    },
    async resolveCommand(commandId: string, session: Session) {
      productionSupplierId(commandId)
      const actor = authorize(session)
      if (!actor.capabilities.some(capability => ['supplier:write', 'supplier-credential:write'].includes(capability)))
        fail('forbidden', '当前权限不能核对分供方提交。')
      storage.assertBusinessWrite()
      return storage.withTransaction(async (tx) => {
        const state = await loadProductionSuppliers(tx, actor)
        const master = state.commands.get(commandId)
        const result = master ?? [...state.credentialScopes.values()].flatMap(item => item.commands).find(item => item.commandId === commandId)?.result ?? null
        if (result && (master || 'verification' in result ? !actor.capabilities.includes('supplier:write') : !actor.capabilities.includes('supplier-credential:read')))
          fail('forbidden', '当前权限不能读取此原提交结果。')
        if (!result)
          await tx.execute('INSERT OR IGNORE INTO supplier_command_resolutions VALUES(?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        if (JSON.stringify(authorize(session)) !== JSON.stringify(actor))
          fail('forbidden', '核对期间权限变化，本次封存已撤回。')
        return { commandId, outcome: result ? 'applied' as const : 'not-applied' as const, result }
      })
    },
  }
  return instance
}
