import type { ReadMetaDTO } from '../../types/read-model'
import type { InvoiceCorrectionContent, InvoiceCorrectionDraft, InvoiceCorrectionResolutionRequest, InvoiceCorrectionResult, InvoiceCorrectionSaveCommand, InvoiceCorrectionSubmitCommand, InvoiceCorrectionSubmitResult } from './correction-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { hasConsistentReadMeta } from '../read-model/meta'
import { CentralInvoiceProblem, INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY } from './central-contract'
import { isCentralInvoiceRecord } from './central-http'

interface Context { workspaceId: string, actorId: string, capabilities: readonly string[] }
type Fetcher = (url: string, options?: { method?: 'GET' | 'POST', body?: unknown }) => Promise<unknown>
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
const optionalNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000)
const nullableId = (value: unknown) => value === null || id(value)
function unavailable(): never {
  throw new CentralInvoiceProblem('unavailable', '更正读取或原回执不完整，请保留输入和原提交编号。')
}
function content(value: unknown): value is InvoiceCorrectionContent {
  if (!object(value) || !object(value.fields) || !Array.isArray(value.items) || value.items.length > 2000)
    return false
  const fields = value.fields
  const contract = value.contract
  const buyer = value.buyer
  return ['invoiceNumber', 'invoiceDate', 'invoiceType', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'taxRate', 'remark'].every(key => typeof fields[key] === 'string')
    && (fields.invoiceDate === '' || isISODateDTO(fields.invoiceDate)) && ['amount', 'taxAmount', 'totalAmount'].every(key => optionalNumber(fields[key]))
    && value.items.every(item => object(item) && ['name', 'spec', 'unit', 'taxRate'].every(key => typeof item[key] === 'string') && ['quantity', 'unitPrice', 'amount', 'taxAmount'].every(key => optionalNumber(item[key])))
    && ['project', 'company', 'personal'].includes(String(value.ownerKind)) && nullableId(value.projectId) && nullableId(value.supplierId)
    && (value.ownerKind === 'project' ? id(value.projectId) : value.projectId === null)
    && (value.supplierVersion === null || (id(value.supplierId) && version(value.supplierVersion)))
    && (buyer === null || (object(buyer) && id(buyer.id) && version(buyer.version)))
    && (contract === null || (object(contract) && ['construction', 'subcontract', 'material', 'auxiliary', 'company'].includes(String(contract.domain)) && id(contract.id) && version(contract.version)))
    && (contract === null || !object(contract) || (contract.domain === 'company' ? value.ownerKind === 'company' : value.ownerKind !== 'company'))
}
function correction(value: unknown): value is InvoiceCorrectionDraft {
  if (!object(value) || !id(value.id) || !id(value.invoiceId) || !version(value.baseInvoiceVersion) || !version(value.version) || !['draft', 'submitted'].includes(String(value.state))
    || typeof value.reason !== 'string' || !content(value.baseline) || !content(value.proposed) || !Array.isArray(value.attachments) || value.attachments.length > 50
    || !isISODateTimeDTO(value.createdAt) || !isISODateTimeDTO(value.updatedAt)) {
    return false
  }
  if (value.state === 'draft' ? value.submittedAt !== null || value.resultInvoiceVersion !== null : !isISODateTimeDTO(value.submittedAt) || !version(value.resultInvoiceVersion))
    return false
  return value.attachments.every(file => object(file) && id(file.id) && typeof file.fileName === 'string' && !!file.fileName.trim() && Number.isSafeInteger(file.fileSize) && Number(file.fileSize) >= 0
    && typeof file.mimeType === 'string' && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)) && new Set(value.attachments.map(file => file.id)).size === value.attachments.length
}
function receipt(value: unknown, commandId: string, invoiceId: string, submitted: boolean): InvoiceCorrectionResult | InvoiceCorrectionSubmitResult {
  if (!object(value) || Object.keys(value).sort().join(',') !== (submitted ? 'commandId,correctionId,invoiceId,invoiceVersion,updatedAt,version' : 'commandId,correctionId,invoiceId,updatedAt,version')
    || value.commandId !== commandId || value.invoiceId !== invoiceId || !id(value.correctionId) || !version(value.version) || !isISODateTimeDTO(value.updatedAt)
    || (submitted && !version(value.invoiceVersion))) {
    return unavailable()
  }
  return value as unknown as InvoiceCorrectionResult | InvoiceCorrectionSubmitResult
}

/** Every read binds the real session and both monotonic source revisions. */
export function createInvoiceCorrectionHttp(options: { identity: Context, context: () => Promise<Context>, fetcher: Fetcher }) {
  async function authorize(write = false) {
    const current = await options.context()
    if (current.workspaceId !== options.identity.workspaceId || current.actorId !== options.identity.actorId || !current.capabilities.includes(INVOICE_READ_CAPABILITY)
      || (write && !current.capabilities.includes(INVOICE_WRITE_CAPABILITY))) {
      throw new CentralInvoiceProblem('forbidden', '发票更正身份或权限已变化，请保留原编号。')
    }
    return JSON.stringify([...current.capabilities].sort())
  }
  async function checkedRead(url: string, body?: object) {
    const capabilities = await authorize()
    const value = await options.fetcher(url, body ? { method: 'POST', body } : undefined)
    if (capabilities !== await authorize() || !object(value) || value.dataOrigin !== 'real' || !hasConsistentReadMeta(value, 'invoice-correction-read-v1', 'real') || !object(value.meta))
      return unavailable()
    const meta = value.meta as unknown as ReadMetaDTO
    if (meta.workspaceId !== options.identity.workspaceId || meta.actorId !== options.identity.actorId || meta.authorizedScope.coverage !== 'complete'
      || JSON.stringify([...meta.capabilities].sort()) !== capabilities || meta.sources.length !== 2
      || meta.sources[0]?.key !== 'invoice-corrections' || meta.sources[0].state !== 'readable' || !/^invoice-corrections:\d+$/.test(meta.sources[0].sourceVersion ?? '')
      || meta.sources[1]?.key !== 'invoices' || meta.sources[1].state !== 'readable' || !/^invoices:\d+$/.test(meta.sources[1].sourceVersion ?? '')) {
      return unavailable()
    }
    return value
  }
  async function write(url: string, body: InvoiceCorrectionSaveCommand | InvoiceCorrectionSubmitCommand) {
    const capabilities = await authorize(true)
    const value = await options.fetcher(url, { method: 'POST', body })
    if (capabilities !== await authorize(true))
      return unavailable()
    const result = receipt(value, body.commandId, body.invoiceId, body.action === 'submit')
    if ((body.correctionId !== null && result.correctionId !== body.correctionId)
      || Number(result.version) !== (body.baseCorrectionVersion === null ? 1 : Number(body.baseCorrectionVersion) + 1)
      || (body.action === 'submit' && (!('invoiceVersion' in result) || Number(result.invoiceVersion) !== Number(body.baseInvoiceVersion) + 1))) {
      return unavailable()
    }
    return result
  }
  return {
    async start(invoiceId: string, baseInvoiceVersion: string) {
      const value = await checkedRead('/api/read/invoice-corrections/start', { invoiceId, baseInvoiceVersion })
      if (!isCentralInvoiceRecord(value.invoice) || value.invoice.id !== invoiceId || value.invoice.version !== baseInvoiceVersion || !content(value.baseline))
        return unavailable()
      return { invoice: value.invoice, baseline: value.baseline, meta: value.meta as ReadMetaDTO }
    },
    async list(invoiceId: string) {
      const value = await checkedRead('/api/read/invoice-corrections/list', { invoiceId })
      if (!Array.isArray(value.items) || !value.items.every(item => correction(item) && item.invoiceId === invoiceId) || new Set(value.items.map(item => item.id)).size !== value.items.length)
        return unavailable()
      return value.items as InvoiceCorrectionDraft[]
    },
    async get(correctionId: string) {
      const value = await checkedRead(`/api/read/invoice-corrections/${encodeURIComponent(correctionId)}`)
      if (!correction(value.record) || value.record.id !== correctionId)
        return unavailable()
      return value.record
    },
    async history(correctionId: string) {
      const value = await checkedRead(`/api/read/invoice-corrections/${encodeURIComponent(correctionId)}/history`)
      if (!Array.isArray(value.items) || !value.items.length || !value.items.every((item, index) => object(item) && correction(item.record) && item.record.id === correctionId && Number(item.record.version) === index + 1 && id(item.actorId) && id(item.commandId) && isISODateTimeDTO(item.createdAt)))
        return unavailable()
      return value.items as Array<{ record: InvoiceCorrectionDraft, actorId: string, commandId: string, createdAt: string }>
    },
    async save(command: InvoiceCorrectionSaveCommand) { return await write('/api/commands/invoice-corrections/save', command) as InvoiceCorrectionResult },
    async submit(command: InvoiceCorrectionSubmitCommand) { return await write('/api/commands/invoice-corrections/submit', command) as InvoiceCorrectionSubmitResult },
    async resolve(request: InvoiceCorrectionResolutionRequest) {
      const capabilities = await authorize(true)
      const value = await options.fetcher('/api/commands/invoice-corrections/resolve', { method: 'POST', body: request })
      if (capabilities !== await authorize(true) || !object(value))
        return unavailable()
      if (value.outcome === 'not-applied' && value.commandId === request.commandId)
        return { outcome: 'not-applied' as const, commandId: request.commandId }
      if (value.outcome !== 'applied')
        return unavailable()
      const result = receipt(value.result, request.commandId, request.invoiceId, request.action === 'submit')
      if (request.correctionId && result.correctionId !== request.correctionId)
        return unavailable()
      return { outcome: 'applied' as const, result }
    },
  }
}
