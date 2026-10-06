import type { NotificationCommand, NotificationCommandResult, NotificationPage, NotificationStoredReceipt, NotificationTarget } from '../../app/lib/notifications/contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { isNotificationStoredReceipt, NOTIFICATION_READ_SCHEMA } from '../../app/lib/notifications/contract'
import { reconcileCredentialExpiryProblems } from '../../app/lib/supplier/credential-domain'
import { credentialExpiryState, shanghaiBusinessDate } from '../../app/lib/supplier/credentials'
import { supplierProblem, SupplierRepositoryProblem } from '../../app/lib/supplier/repository'
import { isISODateTimeDTO } from '../../app/types/read-model'
import { PRODUCTION_SUPPLIER_CAPABILITIES } from './production-supplier-access'
import { productionSupplierFailure as fail, loadProductionSuppliers, saveProductionSuppliers } from './production-supplier-record'
import { createReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
interface EventRow { event_id: string, owner_domain: string, problem_id: string, supplier_id: string, occurred_at: string, read_at: string | null }
interface Revision { revision: number, evaluated_at: string | null, supplier_source_version: number | null }
const mayRead = (actor: BusinessSession) => actor.capabilities.includes('supplier:list:read') && actor.capabilities.includes('supplier-credential:read')
const eventIdentity = (problemId: string) => `credential-warning-${createHash('sha256').update(problemId).digest('hex')}`
export const notificationCommandFingerprint = (command: NotificationCommand) => createHash('sha256').update(JSON.stringify(parseNotificationCommand(command))).digest('hex')
export function parseNotificationCommand(input: unknown): NotificationCommand {
  const value = input as NotificationCommand | null
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'action,actorId,commandId,eventId,workspaceId'
    || !['commandId', 'workspaceId', 'actorId'].every(key => typeof value[key as keyof NotificationCommand] === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(String(value[key as keyof NotificationCommand])))
    || !['open', 'mark-all-read'].includes(value.action)
    || (value.action === 'open' ? typeof value.eventId !== 'string' || !/^credential-warning-[a-f0-9]{64}$/.test(value.eventId) : value.eventId !== null)) {
    fail('validation-failed', '消息操作身份或内容无效，请保留原操作编号核对。')
  }
  return { commandId: value!.commandId, workspaceId: value!.workspaceId, actorId: value!.actorId, action: value!.action, eventId: value!.eventId }
}

export function createProductionNotificationService(storage: ProductionStorage, options: { now?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString())
  const internalActor = { ...storage.identity, capabilities: PRODUCTION_SUPPLIER_CAPABILITIES }
  let lastError = false
  function authorize(session: Session) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId)
      fail('forbidden', '当前会话不能读取这个工作区的消息。')
    return structuredClone(actor)
  }
  function target(actor: BusinessSession, supplierId: string, name: string | undefined): NotificationTarget {
    if (!mayRead(actor))
      return { state: 'forbidden' }
    if (name === undefined)
      return { state: 'missing' }
    return { state: 'resolved', intent: { kind: 'entity-subview', subject: { state: 'resolved', entity: 'supplier', id: supplierId, label: name, no: null }, view: null, variant: 'credentials', filters: { dataOrigin: 'real' } } }
  }
  async function revision(tx: Pick<ProductionStorage, 'select'>) {
    const value = (await tx.select<Revision>('SELECT * FROM notification_revision WHERE singleton=1'))[0]
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
      || (value.evaluated_at !== null && !isISODateTimeDTO(value.evaluated_at))
      || (value.supplier_source_version !== null && (!Number.isSafeInteger(value.supplier_source_version) || value.supplier_source_version < 0))) {
      fail('unavailable', '消息评估依据损坏，请核对备份。')
    }
    return value
  }
  return {
    /** 每分钟检查事实版本及上海业务日；停机后首次检查补算，持续同日同版不产生重复事件。 */
    async scheduled() {
      try {
        storage.assertBusinessWrite()
        await storage.withTransaction(async (tx) => {
          const timestamp = now()
          if (!isISODateTimeDTO(timestamp))
            fail('unavailable', '当前消息评估时点无效。')
          const before = await loadProductionSuppliers(tx, internalActor)
          const current = await revision(tx)
          if (current.evaluated_at && timestamp < current.evaluated_at)
            fail('unavailable', '当前时钟早于上次资料评估，暂不能记录新的提醒历史。')
          if (current.evaluated_at && shanghaiBusinessDate(new Date(current.evaluated_at)) === shanghaiBusinessDate(new Date(timestamp)) && current.supplier_source_version === before.sourceVersion)
            return
          const after = structuredClone(before)
          for (const aggregate of after.credentialScopes.values()) {
            reconcileCredentialExpiryProblems(aggregate, timestamp)
            for (const problem of aggregate.expiryProblems ?? [])
              await tx.execute('INSERT OR IGNORE INTO notification_events VALUES(?,?,?,?,?)', [eventIdentity(problem.id), 'supplier', problem.id, problem.supplierId, problem.firstSeenAt])
          }
          if (!isDeepStrictEqual(after, before))
            await saveProductionSuppliers(tx, after, before, internalActor)
          await tx.execute('UPDATE notification_revision SET revision=revision+1,evaluated_at=?,supplier_source_version=? WHERE singleton=1', [timestamp, before.sourceVersion])
        })
        lastError = false
      }
      catch (cause) {
        lastError = true
        throw cause
      }
    },
    async list(input: Record<string, unknown>, session: Session): Promise<NotificationPage> {
      const actor = authorize(session)
      const requestedPage = input.page === undefined ? 1 : Number(input.page)
      const pageSize = input.pageSize === undefined ? 100 : Number(input.pageSize)
      const numericQuery = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[1-9]\d*$/.test(value))
      if (Object.keys(input).some(key => !['page', 'pageSize'].includes(key)) || !numericQuery(input.page) || !numericQuery(input.pageSize)
        || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || ![10, 20, 50, 100].includes(pageSize)) {
        throw new SupplierRepositoryProblem(supplierProblem('invalid-query', '消息分页条件无效。'))
      }
      return storage.withTransaction(async (tx) => {
        const state = await loadProductionSuppliers(tx, internalActor)
        const stamp = await revision(tx)
        const timestamp = now()
        if (!isISODateTimeDTO(timestamp))
          fail('unavailable', '当前消息读取时点无效。')
        const events = await tx.select<EventRow>('SELECT e.*,r.read_at FROM notification_events e LEFT JOIN notification_reads r ON r.event_id=e.event_id AND r.actor_id=? ORDER BY e.occurred_at DESC,e.event_id', [actor.actorId])
        const items: NotificationPage['items'] = []
        for (const event of events) {
          const aggregate = state.credentialScopes.get(event.supplier_id)
          const problem = aggregate?.expiryProblems?.find(row => row.id === event.problem_id)
          if (!problem || event.owner_domain !== 'supplier' || problem.supplierId !== event.supplier_id || !state.suppliers.has(event.supplier_id)
            || event.event_id !== eventIdentity(problem.id) || event.occurred_at !== problem.firstSeenAt
            || (event.read_at !== null && (!isISODateTimeDTO(event.read_at) || Date.parse(event.read_at) < Date.parse(event.occurred_at)))) {
            fail('unavailable', '消息与所属资料问题关系损坏，请核对备份。')
          }
          if (!mayRead(actor))
            continue
          const supplier = state.suppliers.get(event.supplier_id)!
          const credential = aggregate!.credentials.find(row => row.id === problem.credentialId)
          const validity = credential && credential.deletedAt === null ? credentialExpiryState(credential, new Date(timestamp)) : null
          const active = !!credential && credential.expiresAt.trim() === problem.expiresAt && (validity === 'expiring' || validity === 'expired')
          const severity = active ? validity as 'expiring' | 'expired' : problem.severity
          items.push({ eventId: event.event_id, eventType: 'supplier-credential-expiry', kind: 'notice', title: active ? severity === 'expired' ? '分供方证照已过期' : '分供方证照即将到期' : '分供方证照到期问题已解除', summary: `${supplier.draft.name} · ${credential?.category ?? '历史证照'} · 截止 ${problem.expiresAt}`, occurredAt: event.occurred_at, readAt: event.read_at, target: target(actor, event.supplier_id, supplier.draft.name), problem: { id: problem.id, state: active ? 'active' : 'resolved', severity, firstSeenAt: problem.firstSeenAt, lastSeenAt: problem.lastSeenAt, resolvedAt: active ? null : problem.resolvedAt, expiresAt: problem.expiresAt } })
        }
        if (JSON.stringify(authorize(session)) !== JSON.stringify(actor))
          fail('forbidden', '读取期间身份或权限变化，请重新读取消息。')
        const ready = !lastError && stamp.evaluated_at !== null && shanghaiBusinessDate(new Date(stamp.evaluated_at)) === shanghaiBusinessDate(new Date(timestamp)) && stamp.supplier_source_version === state.sourceVersion
        const page = Math.min(requestedPage, Math.max(1, Math.ceil(items.length / pageSize)))
        const businessDate = shanghaiBusinessDate(new Date(timestamp))
        const readable = mayRead(actor)
        const meta = createReadMeta({ session: actor, schemaVersion: NOTIFICATION_READ_SCHEMA, operation: 'notifications-list', dataOrigin: 'real', asOf: timestamp, coverage: readable ? ready ? 'complete' : 'unknown' : 'permission-filtered', scope: { actorId: actor.actorId }, sources: readable
          ? [{ key: 'notification-ledger', state: 'readable', sourceVersion: `notifications-${stamp.revision}`, asOf: timestamp }, { key: 'supplier-problems', state: 'readable', sourceVersion: `supplier-${state.sourceVersion}-${businessDate}`, asOf: timestamp }]
          : [{ key: 'notification-ledger', state: 'forbidden', sourceVersion: null, asOf: null }, { key: 'supplier-problems', state: 'forbidden', sourceVersion: null, asOf: null }] })
        return withReadMeta({ dataOrigin: 'real' as const, workspaceId: actor.workspaceId, actorId: actor.actorId, businessDate, evaluationState: ready ? 'ready' as const : 'unavailable' as const, unreadCount: items.filter(item => item.readAt === null).length, pagination: { requestedPage, page, pageSize, total: items.length }, items: items.slice((page - 1) * pageSize, page * pageSize) }, meta)
      })
    },
    async execute(input: unknown, session: Session): Promise<NotificationCommandResult> {
      const actor = authorize(session)
      const command = parseNotificationCommand(input)
      if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
        fail('forbidden', '消息操作与当前会话身份不一致。')
      storage.assertBusinessWrite()
      const fingerprint = notificationCommandFingerprint(command)
      return storage.withTransaction(async (tx) => {
        const state = await loadProductionSuppliers(tx, internalActor)
        const events = await tx.select<EventRow>('SELECT e.*,r.read_at FROM notification_events e LEFT JOIN notification_reads r ON r.event_id=e.event_id AND r.actor_id=?', [actor.actorId])
        for (const event of events) {
          const problem = state.credentialScopes.get(event.supplier_id)?.expiryProblems?.find(row => row.id === event.problem_id)
          if (!problem || event.owner_domain !== 'supplier' || problem.supplierId !== event.supplier_id || !state.suppliers.has(event.supplier_id)
            || event.event_id !== eventIdentity(problem.id) || event.occurred_at !== problem.firstSeenAt
            || (event.read_at !== null && (!isISODateTimeDTO(event.read_at) || Date.parse(event.read_at) < Date.parse(event.occurred_at)))) {
            fail('unavailable', '消息与所属资料问题或已读证据关系损坏，请核对备份。')
          }
        }
        const saved = (await tx.select<{ workspace_id: string, actor_id: string, fingerprint: string, result_json: string }>('SELECT workspace_id,actor_id,fingerprint,result_json FROM notification_commands WHERE command_id=?', [command.commandId]))[0]
        let receipt: NotificationStoredReceipt
        if (saved) {
          if (saved.workspace_id !== actor.workspaceId || saved.actor_id !== actor.actorId)
            fail('unavailable', '原消息回执所属工作区或操作者损坏，请核对备份。')
          if (saved.fingerprint !== fingerprint)
            fail('conflict', '此消息操作编号已用于其他内容，请恢复原操作。')
          let decoded: unknown
          try {
            decoded = JSON.parse(saved.result_json)
          }
          catch { return fail('unavailable', '原消息回执损坏，请核对备份。') }
          if (!isNotificationStoredReceipt(decoded) || decoded.commandId !== command.commandId || decoded.eventId !== command.eventId
            || decoded.eventIds.some(id => !events.some(row => row.event_id === id && row.read_at !== null && Date.parse(row.read_at) <= Date.parse(decoded.readAt)))) {
            fail('unavailable', '原消息回执与事件关系损坏，请核对备份。')
          }
          receipt = decoded as NotificationStoredReceipt
        }
        else {
          const event = command.eventId ? events.find(row => row.event_id === command.eventId) : null
          if (command.action === 'open' && !event)
            fail('not-found', '此消息已不存在，请重新核对消息列表。')
          if (command.action === 'open' && !mayRead(actor))
            fail('forbidden', '当前无权打开或标记这条资料消息。')
          const affected = command.action === 'open' ? [event!] : mayRead(actor) ? events : []
          receipt = { commandId: command.commandId, eventId: command.eventId, readAt: event?.read_at ?? now(), eventIds: affected.map(row => row.event_id) }
          if (!isNotificationStoredReceipt(receipt) || affected.some(row => Date.parse(receipt.readAt) < Date.parse(row.occurred_at)))
            fail('unavailable', '消息已读时点无效或早于事件，停止本次写入。')
          for (const row of affected)
            await tx.execute('INSERT OR IGNORE INTO notification_reads VALUES(?,?,?)', [row.event_id, actor.actorId, receipt.readAt])
          await tx.execute('INSERT INTO notification_commands VALUES(?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, fingerprint, JSON.stringify(receipt), now()])
          await tx.execute('UPDATE notification_revision SET revision=revision+1 WHERE singleton=1')
        }
        if (JSON.stringify(authorize(session)) !== JSON.stringify(actor))
          fail('forbidden', '操作期间身份或权限变化，本次已读提交已撤回。')
        const event = events.find(row => row.event_id === command.eventId)
        return { commandId: receipt.commandId, eventId: receipt.eventId, eventIds: [...receipt.eventIds], readAt: receipt.readAt, target: event ? target(actor, event.supplier_id, state.suppliers.get(event.supplier_id)?.draft.name) : null }
      })
    },
  }
}
