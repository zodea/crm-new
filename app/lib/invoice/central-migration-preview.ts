import type { InvoiceMigrationMappings } from './central-migration'
import { CentralInvoiceProblem } from './central-contract'

interface Context { workspaceId: string, actorId: string, capabilities: readonly string[] }
interface Source { sha256: string, payloadBase64: string }
type Fetcher = (url: string, options: { method: 'POST', body: unknown }) => Promise<unknown>
interface Reference { table: 'projects' | 'suppliers' | 'contracts' | 'company_expense_contracts', legacyId: string, label: string, deleted: boolean, kind?: string | null, projectId?: string | null, supplierId?: string | null }
interface Invoice { legacyId: string, invoiceNumber: string, deleted: boolean, sourceState: string, ambiguousZeroFields: string[], historicalAllocationCount: number, originalCount: number, originalBodyStates: string[], companyContractId?: string }
export interface InvoiceSourcePreview { sourceSha256: string, schemaVersion: number, invoices: Invoice[], references: Reference[], orphanLogCount: number }
export interface InvoiceMappingPreview { sourceSha256: string, invoiceCount: number, missingAllocationIds: string[], orphanLogCount: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
function unavailable(): never {
  throw new CentralInvoiceProblem('unavailable', '旧发票预检结果无法可靠核对，请保留原库。')
}

/** 预检结果只作为当前身份、权限和来源下的暂时证据，提交时由服务端重新核对。 */
export function createInvoiceMigrationPreview(options: { identity: Pick<Context, 'workspaceId' | 'actorId'>, context: () => Promise<Context>, fetcher: Fetcher }) {
  async function authorize() {
    const actor = await options.context()
    if (!actor || actor.workspaceId !== options.identity.workspaceId || actor.actorId !== options.identity.actorId || !Array.isArray(actor.capabilities)
      || actor.capabilities.some(cap => typeof cap !== 'string') || new Set(actor.capabilities).size !== actor.capabilities.length
      || !['finance-invoice:read', 'finance-invoice:import'].every(cap => actor.capabilities.includes(cap))) {
      throw new CentralInvoiceProblem('forbidden', '旧发票预检身份或权限已变化。')
    }
    return JSON.stringify([...actor.capabilities].sort())
  }
  async function fetch(url: string, source: Source, body: unknown) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256))
      return unavailable()
    const expectedSha256 = source.sha256
    const capabilities = await authorize()
    const value = await options.fetcher(url, { method: 'POST', body })
    if (capabilities !== await authorize())
      throw new CentralInvoiceProblem('forbidden', '旧发票预检期间身份或权限已变化。')
    if (source.sha256 !== expectedSha256 || !object(value) || value.sourceSha256 !== expectedSha256)
      return unavailable()
    return value
  }
  return {
    async source(source: Source): Promise<InvoiceSourcePreview> {
      const value = await fetch('/api/read/invoices/migration-preview', source, source)
      if ((value.schemaVersion !== 59 && value.schemaVersion !== 60) || !count(value.orphanLogCount) || !Array.isArray(value.invoices) || !Array.isArray(value.references))
        return unavailable()
      const invoiceStates = ['recorded', 'legacy-path-unverified', 'session-original-unavailable', 'no-original-recorded']
      if (value.invoices.some(row => !object(row) || !id(row.legacyId) || typeof row.invoiceNumber !== 'string' || typeof row.deleted !== 'boolean'
        || !invoiceStates.includes(String(row.sourceState)) || !Array.isArray(row.ambiguousZeroFields) || row.ambiguousZeroFields.some(field => !['amount', 'tax_amount', 'total_amount'].includes(field))
        || !count(row.historicalAllocationCount) || !count(row.originalCount) || (row.sourceState === 'recorded') !== (row.originalCount > 0)
        || !Array.isArray(row.originalBodyStates) || row.originalBodyStates.length !== row.originalCount
        || row.originalBodyStates.some(state => !['embedded', 'metadata-only', 'external-required'].includes(state)) || (row.companyContractId !== undefined && !id(row.companyContractId)))
      || value.references.some(row => !object(row) || !['projects', 'suppliers', 'contracts', 'company_expense_contracts'].includes(String(row.table)) || !id(row.legacyId)
        || typeof row.label !== 'string' || typeof row.deleted !== 'boolean'
        || (row.table === 'contracts' && !['kind', 'projectId', 'supplierId'].every(key => row[key] === null || typeof row[key] === 'string')))
      || new Set(value.invoices.map(row => row.legacyId)).size !== value.invoices.length
      || new Set(value.references.map(row => `${row.table}:${row.legacyId}`)).size !== value.references.length) {
        return unavailable()
      }
      const references = value.references
      if (value.invoices.some(row => row.companyContractId && !references.some(reference => reference.table === 'company_expense_contracts' && reference.legacyId === row.companyContractId)))
        return unavailable()
      return value as unknown as InvoiceSourcePreview
    },
    async mappings(source: Source, mappings: InvoiceMigrationMappings): Promise<InvoiceMappingPreview> {
      const value = await fetch('/api/read/invoices/migration-mapping', source, { source, mappings })
      if (!count(value.invoiceCount) || !count(value.orphanLogCount) || !Array.isArray(value.missingAllocationIds)
        || value.missingAllocationIds.some(item => !id(item)) || new Set(value.missingAllocationIds).size !== value.missingAllocationIds.length) {
        return unavailable()
      }
      return value as unknown as InvoiceMappingPreview
    },
  }
}
