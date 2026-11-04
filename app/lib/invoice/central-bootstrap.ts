import type { RecoveryStorage } from '../forms/command-recovery'
import type { LocalInvoiceCandidate } from './recognize'
import { CentralInvoiceProblem, INVOICE_READ_CAPABILITY } from './central-contract'
import { createCentralInvoiceHttp } from './central-http'
import { createCentralInvoiceWorkspace } from './central-workspace'
import { recognizeInvoiceLocally } from './recognize'

type Fetcher = Parameters<typeof createCentralInvoiceHttp>[0]
interface Context { workspaceId: string, actorId: string, capabilities: string[] }

export function parseInvoiceSession(value: unknown): Context {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CentralInvoiceProblem('unavailable', '发票业务身份尚未可靠读取。')
  const data = value as Record<string, unknown>
  if (typeof data.workspaceId !== 'string' || !data.workspaceId.trim() || typeof data.actorId !== 'string' || !data.actorId.trim()
    || !Array.isArray(data.capabilities) || data.capabilities.some(item => typeof item !== 'string') || new Set(data.capabilities).size !== data.capabilities.length) {
    throw new CentralInvoiceProblem('unavailable', '发票业务身份或权限不完整。')
  }
  return { workspaceId: data.workspaceId, actorId: data.actorId, capabilities: [...data.capabilities] }
}

/** 暂不接入路由：只有 owner、迁入与备份验证完成后才允许正式启用。 */
export async function createInvoiceWorkspaceFromSession(options: {
  fetcher: Fetcher
  basePath: string
  binaryFetch?: typeof fetch
  storage?: () => RecoveryStorage
  commandId?: () => string
  localRecognition?: (file: File, basePath: string) => Promise<LocalInvoiceCandidate>
}) {
  const context = async () => parseInvoiceSession(await options.fetcher('/api/read/business-session'))
  const identity = await context()
  if (!identity.capabilities.includes(INVOICE_READ_CAPABILITY))
    throw new CentralInvoiceProblem('forbidden', '当前身份没有发票读取权限。')
  const client = createCentralInvoiceHttp(options.fetcher, identity, options.binaryFetch)
  const recognize = options.localRecognition ?? ((file: File, basePath: string) => recognizeInvoiceLocally({ file, basePath }))
  return createCentralInvoiceWorkspace({
    identity,
    client,
    context,
    recognizeLocal: file => recognize(file, options.basePath),
    storage: options.storage,
    commandId: options.commandId,
  })
}
