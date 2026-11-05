import type { RecoveryStorage } from '../forms/command-recovery'
import { createOurSignatoryRepository } from '../our-signatory/http-repository'
import { CentralInvoiceProblem } from './central-contract'
import { createInvoiceMigrationSession } from './central-migration'
import { createInvoiceMigrationCatalogClient } from './central-migration-catalog'
import { createInvoiceMigrationPreview } from './central-migration-preview'

interface Context { workspaceId: string, actorId: string, capabilities: string[] }
type Fetcher = (url: string, options?: { method?: 'GET' | 'POST', body?: unknown }) => Promise<unknown>

function parseContext(value: unknown): Context {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CentralInvoiceProblem('unavailable', '发票迁入身份尚未可靠读取。')
  const data = value as Record<string, unknown>
  if (typeof data.workspaceId !== 'string' || !data.workspaceId.trim() || typeof data.actorId !== 'string' || !data.actorId.trim()
    || !Array.isArray(data.capabilities) || data.capabilities.some(item => typeof item !== 'string' || !item.trim())
    || new Set(data.capabilities).size !== data.capabilities.length) {
    throw new CentralInvoiceProblem('unavailable', '发票迁入身份或权限不完整。')
  }
  return { workspaceId: data.workspaceId, actorId: data.actorId, capabilities: [...data.capabilities] }
}

/** 身份只从业务会话获取，后续每次读取和命令均重新核对身份与权限。 */
export async function createInvoiceMigrationFromSession(options: { fetcher: Fetcher, storage?: () => RecoveryStorage, commandId?: () => string }) {
  const context = async () => parseContext(await options.fetcher('/api/read/business-session'))
  const identity = await context()
  if (!['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'].every(capability => identity.capabilities.includes(capability)))
    throw new CentralInvoiceProblem('forbidden', '当前身份没有旧发票迁入权限。')
  const shared = { identity, context, fetcher: options.fetcher }
  const loadBuyers = async () => {
    const current = await context()
    const fingerprint = (actor: Context) => JSON.stringify([actor.workspaceId, actor.actorId, [...actor.capabilities].sort()])
    if (current.workspaceId !== identity.workspaceId || current.actorId !== identity.actorId || !current.capabilities.includes('our-signatory:read'))
      throw new CentralInvoiceProblem('forbidden', '我方主体目录无读取权限。')
    const read = await createOurSignatoryRepository(options.fetcher).list()
    const after = await context()
    if (fingerprint(current) !== fingerprint(after) || read.meta.workspaceId !== current.workspaceId || read.meta.actorId !== current.actorId
      || read.meta.authorizedScope.coverage !== 'complete' || JSON.stringify([...read.meta.capabilities].sort()) !== JSON.stringify([...current.capabilities].sort())
      || read.meta.sources.length !== 1 || read.meta.sources[0]?.key !== 'our-signatories' || read.meta.sources[0]?.state !== 'readable' || !read.meta.sources[0]?.sourceVersion) {
      throw new CentralInvoiceProblem('unavailable', '我方主体目录或读取权限无法完整核验。')
    }
    return read.records.filter(record => record.draft.status === 'active').map(record => ({ id: record.id, label: record.draft.name, version: record.version }))
  }
  return {
    session: createInvoiceMigrationSession({ ...shared, verifiedIdentity: identity, storage: options.storage, commandId: options.commandId }),
    previewClient: createInvoiceMigrationPreview(shared),
    catalogClient: createInvoiceMigrationCatalogClient(shared),
    loadBuyers,
  }
}
