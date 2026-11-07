import type { RecoveryStorage } from '../forms/command-recovery'
import type { InvoiceContractReference } from './central-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../forms/command-recovery'
import { hasConsistentReadMeta } from '../read-model/meta'
import { CentralInvoiceProblem } from './central-contract'

interface Context { workspaceId: string, actorId: string, capabilities: readonly string[] }
interface Mapping { legacyId: string, targetId: string, version: string, sourceVersion: string }
export interface InvoiceMigrationMappings {
  projects: Mapping[]
  suppliers: Mapping[]
  contracts: Array<{ legacyId: string, target: InvoiceContractReference }>
  companyInvoices?: Array<{ invoiceId: string, legacyContractId: string, target: InvoiceContractReference & { domain: 'company' }, supplierId: string, supplierVersion: string, supplierSourceVersion: string, buyerId: string, buyerVersion: string }>
}
export interface InvoiceMigrationReceipt { commandId: string, batchId: string, sourceSha256: string, invoiceIds: string[], createdAt: string, retired?: true }
type Fetcher = (url: string, options?: { method?: 'GET' | 'POST', body?: unknown }) => Promise<unknown>
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
function unavailable(): never {
  throw new CentralInvoiceProblem('unavailable', '旧发票迁入回执或来源尚未可靠核对，请保留原提交编号。')
}
function receipt(value: unknown, commandId: string, action: 'publish' | 'retire', targetId: string | null): InvoiceMigrationReceipt {
  if (!object(value) || !id(value.batchId) || value.commandId !== commandId || (targetId !== null && value.batchId !== targetId)
    || typeof value.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSha256) || !isISODateTimeDTO(value.createdAt)
    || !Array.isArray(value.invoiceIds) || !value.invoiceIds.length || value.invoiceIds.some(invoiceId => !id(invoiceId)) || new Set(value.invoiceIds).size !== value.invoiceIds.length
    || (action === 'retire' ? value.retired !== true : value.retired !== undefined)) {
    return unavailable()
  }
  return value as unknown as InvoiceMigrationReceipt
}

/** 持久原命令身份与来源摘要，源文件与人工映射留在页面内存。 */
export function createInvoiceMigrationSession(options: { identity: Pick<Context, 'workspaceId' | 'actorId'>, verifiedIdentity?: Context, context: () => Promise<Context>, fetcher: Fetcher, storage?: () => RecoveryStorage, commandId?: () => string }) {
  const identity = { workspaceId: options.identity.workspaceId, actorId: options.identity.actorId }
  const recovery = createCommandRecoveryStorage(options.storage)
  let active = false
  const permitted = (actor: Context) => actor.workspaceId === identity.workspaceId && actor.actorId === identity.actorId
    && ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'].every(cap => actor.capabilities.includes(cap))
  let identityVerified = !!options.verifiedIdentity && permitted(options.verifiedIdentity)
  const key = (targetId: string | null) => commandRecoveryKey({ ...identity, family: 'invoice-legacy', targetId })
  async function authorize() {
    let actor: Context
    try {
      actor = await options.context()
    }
    catch (cause) {
      identityVerified = false
      throw cause
    }
    if (!permitted(actor)) {
      identityVerified = false
      throw new CentralInvoiceProblem('forbidden', '旧发票迁入身份或权限已变化，请保留原提交编号。')
    }
    identityVerified = true
    return JSON.stringify([...actor.capabilities].sort())
  }
  function pendingAll() {
    if (!identityVerified)
      return unavailable()
    const store = (options.storage ?? (() => globalThis.sessionStorage))()
    const enumerable = store as Partial<Pick<Storage, 'length' | 'key'>>
    if (!Number.isSafeInteger(enumerable.length) || enumerable.length! < 0 || typeof enumerable.key !== 'function')
      return unavailable()
    const prefix = key(null).slice(0, -3)
    const reader = createCommandRecoveryStorage(() => store)
    const commands = []
    const count = enumerable.length!
    for (let index = 0; index < count; index++) {
      const candidate = enumerable.key(index)
      if (typeof candidate !== 'string')
        return unavailable()
      if (!candidate.startsWith(prefix))
        continue
      const value = reader.read(candidate)
      if (!value || value.workspaceId !== identity.workspaceId || value.actorId !== identity.actorId || value.family !== 'invoice-legacy'
        || value.scopeId !== undefined || (value.action === 'publish' ? value.targetId !== null || !value.sourceSha256 : value.action !== 'retire' || !id(value.targetId))) {
        return unavailable()
      }
      commands.push(value)
    }
    if (enumerable.length !== count)
      return unavailable()
    return commands.sort((left, right) => left.commandId.localeCompare(right.commandId))
  }
  async function state(expectedCapabilities?: string) {
    const caps = await authorize()
    const value = await options.fetcher('/api/read/invoices/migration-state')
    if (await authorize() !== caps || (expectedCapabilities !== undefined && caps !== expectedCapabilities))
      throw new CentralInvoiceProblem('forbidden', '读取旧发票批次期间权限已变化。')
    if (!object(value) || value.dataOrigin !== 'real' || !hasConsistentReadMeta(value, 'invoice-read-v1', 'real') || !object(value.meta)
      || value.meta.workspaceId !== identity.workspaceId || value.meta.actorId !== identity.actorId || !object(value.meta.authorizedScope) || value.meta.authorizedScope.coverage !== 'complete'
      || !Array.isArray(value.meta.capabilities) || JSON.stringify([...value.meta.capabilities].sort()) !== caps
      || !Array.isArray(value.meta.sources) || value.meta.sources.length !== 1 || !object(value.meta.sources[0]) || value.meta.sources[0].key !== 'invoices' || value.meta.sources[0].state !== 'readable'
      || typeof value.meta.sources[0].sourceVersion !== 'string' || !/^invoices:\d+$/.test(value.meta.sources[0].sourceVersion)
      || !Array.isArray(value.batches)) {
      return unavailable()
    }
    const batches = value.batches.map((batch) => {
      if (!object(batch) || !id(batch.commandId))
        return unavailable()
      const saved = receipt(batch, batch.commandId, 'publish', null)
      if (!(batch.retiredAt === null || isISODateTimeDTO(batch.retiredAt)))
        return unavailable()
      return { ...saved, retiredAt: batch.retiredAt }
    })
    if (new Set(batches.map(batch => batch.batchId)).size !== batches.length)
      return unavailable()
    return batches
  }
  async function readback(saved: InvoiceMigrationReceipt, action: 'publish' | 'retire', expectedCapabilities?: string) {
    const batches = await state(expectedCapabilities)
    const actual = batches.find(batch => batch.batchId === saved.batchId)
    if (!actual || actual.sourceSha256 !== saved.sourceSha256 || JSON.stringify(actual.invoiceIds) !== JSON.stringify(saved.invoiceIds)
      || (action === 'retire' && actual.retiredAt !== saved.createdAt)) {
      return unavailable()
    }
  }
  async function guard<T>(work: () => Promise<T>) {
    if (active)
      throw new Error('发票迁入或恢复正在处理，请先等待原结果。')
    active = true
    try {
      return await work()
    }
    finally { active = false }
  }
  async function submit(action: 'publish' | 'retire', targetId: string | null, data: Record<string, unknown>, expectedSourceSha256?: string, beforeSubmit?: () => boolean) {
    return guard(async () => {
      const caps = await authorize()
      if (beforeSubmit && !beforeSubmit())
        throw new CentralInvoiceProblem('unavailable', '页面或迁入来源已变化，本次操作未发送。')
      const commandId = options.commandId?.() ?? crypto.randomUUID()
      const descriptor = { ...identity, commandId, family: 'invoice-legacy', targetId, action, ...(action === 'publish' ? { sourceSha256: expectedSourceSha256 } : {}) }
      recovery.remember(key(targetId), descriptor)
      const value = await options.fetcher(`/api/commands/invoices/migration-${action}`, { method: 'POST', body: { ...identity, commandId, ...data, confirmed: true } })
      const saved = receipt(value, commandId, action, targetId)
      if (action === 'publish' && saved.sourceSha256 !== expectedSourceSha256)
        return unavailable()
      if (await authorize() !== caps)
        throw new CentralInvoiceProblem('forbidden', '旧发票迁入后身份或权限已变化，请核对原提交。')
      await readback(saved, action, caps)
      if (beforeSubmit && !beforeSubmit())
        return unavailable()
      recovery.clear(key(targetId), commandId)
      return saved
    })
  }
  return {
    state,
    pendingAll,
    identityVerified: () => identityVerified,
    pending: (targetId: string | null) => recovery.read(key(targetId)),
    publish: (source: { sha256: string, payloadBase64: string }, mappings: InvoiceMigrationMappings, beforeSubmit?: () => boolean) => submit('publish', null, { source, mappings }, source.sha256, beforeSubmit),
    retire: (batchId: string, beforeSubmit?: () => boolean) => submit('retire', batchId, { batchId }, undefined, beforeSubmit),
    recover: (targetId: string | null, isCurrent?: () => boolean) => guard(async () => {
      const caps = await authorize()
      if (isCurrent && !isCurrent())
        return unavailable()
      const pending = recovery.read(key(targetId))
      if (!pending || pending.workspaceId !== identity.workspaceId || pending.actorId !== identity.actorId || pending.family !== 'invoice-legacy'
        || pending.targetId !== targetId || !['publish', 'retire'].includes(pending.action) || (pending.action === 'publish') !== (targetId === null)) {
        return unavailable()
      }
      if (pending.action === 'publish' && !pending.sourceSha256)
        return unavailable()
      const value = await options.fetcher('/api/commands/invoices/migration-resolve', { method: 'POST', body: { ...identity, commandId: pending.commandId } })
      if (await authorize() !== caps)
        throw new CentralInvoiceProblem('forbidden', '核对旧发票原提交期间权限已变化。')
      if (!object(value) || !['applied', 'not-applied'].includes(String(value.outcome)))
        return unavailable()
      if (value.outcome === 'not-applied') {
        if (value.commandId !== pending.commandId)
          return unavailable()
        if (isCurrent && !isCurrent())
          return unavailable()
        recovery.clear(key(targetId), pending.commandId)
        return { outcome: 'not-applied' as const, commandId: pending.commandId }
      }
      const saved = receipt(value.result, pending.commandId, pending.action as 'publish' | 'retire', targetId)
      if (pending.action === 'publish' && saved.sourceSha256 !== pending.sourceSha256)
        return unavailable()
      await readback(saved, pending.action as 'publish' | 'retire', caps)
      if (isCurrent && !isCurrent())
        return unavailable()
      recovery.clear(key(targetId), pending.commandId)
      return { outcome: 'applied' as const, result: saved }
    }),
  }
}
