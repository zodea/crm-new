import type { InvoiceContractDomain } from './central-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { CentralInvoiceProblem } from './central-contract'

export type InvoiceCatalogKey = 'projects' | 'suppliers' | InvoiceContractDomain
export interface InvoiceMasterOption { id: string, label: string, version: string, sourceVersion: string }
export interface InvoiceContractOption { id: string, label: string, domain: InvoiceContractDomain, version: string, projectId: string | null, supplierId: string | null }
export interface InvoiceMigrationCatalog { projects: InvoiceMasterOption[], suppliers: InvoiceMasterOption[], contracts: InvoiceContractOption[] }
interface Context { workspaceId: string, actorId: string, capabilities: readonly string[] }
const keys: InvoiceCatalogKey[] = ['projects', 'suppliers', 'construction', 'subcontract', 'material', 'auxiliary', 'company']
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
const version = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
function unavailable(message: string): never {
  throw new CentralInvoiceProblem('unavailable', message)
}

/** 必须逐项核验所需来源完整可读，不能把缺权限或不可用误当成空目录。 */
function createInvoiceCatalogClient(options: { identity: Pick<Context, 'workspaceId' | 'actorId'>, context: () => Promise<Context>, fetcher: (url: string, options: { method: 'POST', body: unknown }) => Promise<unknown> }, migration: boolean) {
  async function authorize() {
    const actor = await options.context()
    if (!actor || actor.workspaceId !== options.identity.workspaceId || actor.actorId !== options.identity.actorId || !Array.isArray(actor.capabilities)
      || actor.capabilities.some(cap => typeof cap !== 'string') || new Set(actor.capabilities).size !== actor.capabilities.length
      || !actor.capabilities.includes('finance-invoice:read') || (migration && !actor.capabilities.includes('finance-invoice:import'))) {
      throw new CentralInvoiceProblem('forbidden', '发票迁入目录身份或权限已变化。')
    }
    return JSON.stringify([...actor.capabilities].sort())
  }
  return {
    async load(requested: InvoiceCatalogKey[]): Promise<InvoiceMigrationCatalog> {
      if (!Array.isArray(requested) || requested.some(key => !keys.includes(key)) || new Set(requested).size !== requested.length)
        return unavailable('所需目标目录无效。')
      const expected = [...requested]
      const caps = await authorize()
      const value = await options.fetcher(migration ? '/api/read/invoices/migration-catalog' : '/api/read/invoices/workspace-catalog', { method: 'POST', body: { requested: expected } })
      if (caps !== await authorize())
        throw new CentralInvoiceProblem('forbidden', '读取发票迁入目录期间身份或权限已变化。')
      if (!object(value) || !object(value.context) || value.context.workspaceId !== options.identity.workspaceId || value.context.actorId !== options.identity.actorId
        || !Array.isArray(value.context.capabilities) || JSON.stringify([...value.context.capabilities].sort()) !== caps || !isISODateTimeDTO(value.asOf)
        || !Array.isArray(value.sources) || value.sources.length !== expected.length || !Array.isArray(value.projects) || !Array.isArray(value.suppliers) || !Array.isArray(value.contracts)) {
        return unavailable('发票迁入目标目录的身份或来源证据不完整。')
      }
      if (value.sources.some(source => !object(source) || !expected.includes(source.key as InvoiceCatalogKey) || !['readable', 'forbidden', 'unavailable'].includes(String(source.state))
        || (source.state === 'readable' ? typeof source.sourceVersion !== 'string' || !source.sourceVersion : source.sourceVersion !== null))
      || new Set(value.sources.map(source => source.key)).size !== expected.length) {
        return unavailable('发票迁入目标目录来源证据无效。')
      }
      const missing = value.sources.filter(source => source.state !== 'readable')
      if (missing.length)
        return unavailable(`目标目录无法完整读取：${missing.map(source => `${source.key}（${source.state === 'forbidden' ? '无权限' : '来源不可用'}）`).join('、')}。`)
      for (const key of ['projects', 'suppliers'] as const) {
        const rows = key === 'projects' ? value.projects : value.suppliers
        const source = value.sources.find(item => item.key === key)
        if ((!expected.includes(key) && rows.length) || rows.some(row => !object(row) || !id(row.id) || typeof row.label !== 'string' || !version(row.version) || row.sourceVersion !== source?.sourceVersion)
          || new Set(rows.map(row => row.id)).size !== rows.length) {
          return unavailable('项目或分供方目录身份、版本或来源不一致。')
        }
      }
      if (value.contracts.some(row => !object(row) || !id(row.id) || typeof row.label !== 'string' || !version(row.version) || !expected.includes(row.domain as InvoiceCatalogKey)
        || !['construction', 'subcontract', 'material', 'auxiliary', 'company'].includes(String(row.domain)) || !(row.projectId === null || id(row.projectId)) || !(row.supplierId === null || id(row.supplierId)))
      || new Set(value.contracts.map(row => `${row.domain}:${row.id}`)).size !== value.contracts.length) {
        return unavailable('合同目录身份、版本或关联不一致。')
      }
      return { projects: value.projects, suppliers: value.suppliers, contracts: value.contracts } as InvoiceMigrationCatalog
    },
  }
}

export function createInvoiceMigrationCatalogClient(options: Parameters<typeof createInvoiceCatalogClient>[0]) {
  return createInvoiceCatalogClient(options, true)
}

export function createInvoiceWorkspaceCatalogClient(options: Parameters<typeof createInvoiceCatalogClient>[0]) {
  return createInvoiceCatalogClient(options, false)
}
