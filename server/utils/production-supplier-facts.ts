import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SupplierContractSourceRow, SupplierDetailReadDTO, SupplierFactSource, SupplierPaymentAllocationSourceRow, SupplierPaymentApplicationSourceRow, SupplierPaymentRecordSourceRow, SupplierProjectSourceRow, SupplierSettlementSourceRow } from '../../app/lib/supplier/read-contract'
import type { MetricDTO, ReadProjection, SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { ProjectRow } from './production-project-record'
import { isEffectiveExpenditureContract } from '../../app/lib/contract/effective-status'
import { loadFinanceForm } from '../../app/lib/finance/domain'
import { readOtherSettlementStored, validateOtherSettlementJournal } from '../../app/lib/other-settlement/storage'
import { validateFinanceJournal } from './production-finance-journal'
import { readMaterialContractSupplierFacts } from './production-material-contract-service'
import { validateOtherSettlementImportEvidence } from './production-other-settlement-migration'
import { projectDraft } from './production-project-record'
import { productionSupplierFailure as fail } from './production-supplier-record'

export interface ProductionSupplierFacts {
  sources: SourceEvidenceDTO[]
  projects: SupplierProjectSourceRow[]
  contracts: SupplierContractSourceRow[]
  settlements: SupplierSettlementSourceRow[]
  paymentApplications: SupplierPaymentApplicationSourceRow[]
  paymentRecords: SupplierPaymentRecordSourceRow[]
  paymentAllocations: SupplierPaymentAllocationSourceRow[]
}

/** Every read uses the caller's existing owner transaction and current server authorization. */
export async function readProductionSupplierFacts(tx: TransactionDb, actor: BusinessSession, asOf: string): Promise<ProductionSupplierFacts> {
  const participants = await tx.select<{ domain: string, schema_version: number }>('SELECT domain,schema_version FROM production_participants')
  const hasOwner = (domain: string) => participants.some(row => row.domain === domain && row.schema_version === 1)
  const sources: SourceEvidenceDTO[] = []
  const data: ProductionSupplierFacts = { sources, projects: [], contracts: [], settlements: [], paymentApplications: [], paymentRecords: [], paymentAllocations: [] }
  async function source(key: string, domain: string, capabilities: string[], revisionTable: string): Promise<boolean> {
    if (!capabilities.every(capability => actor.capabilities.includes(capability))) {
      sources.push({ key, state: 'forbidden', sourceVersion: null, asOf: null })
      return false
    }
    if (!hasOwner(domain)) {
      sources.push({ key, state: 'unavailable', sourceVersion: null, asOf: null })
      return false
    }
    const revision = (await tx.select<{ revision: number }>(`SELECT revision FROM ${revisionTable} WHERE singleton=1`))[0]?.revision
    if (!Number.isSafeInteger(revision) || Number(revision) < 0)
      return fail('unavailable', '分供方关联来源版本损坏，不能显示旧结果或重建空事实。')
    sources.push({ key, state: 'readable', sourceVersion: `${domain}-${revision}`, asOf })
    return true
  }
  if (await source('projects', 'project', ['project:list:read'], 'project_revision')) {
    const projects = await tx.select<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY id')
    data.projects = projects.map((row): SupplierProjectSourceRow => {
      const draft = projectDraft(row)
      return { dataOrigin: 'real', id: row.id, name: row.name, status: draft.status ?? '', permission: 'allowed' }
    })
  }
  // A project master proves a row label, not the unregistered cooperation relation or its count.
  sources.push({ key: 'project-suppliers', state: 'unavailable', sourceVersion: null, asOf: null })
  if (await source('contracts', 'material-contracts', ['material-contract:read'], 'material_contract_revision')) {
    const material = await readMaterialContractSupplierFacts(tx, actor, undefined, asOf)
    if (!material.records || material.source.state !== 'readable')
      return fail('unavailable', '材采合同现行来源无法可靠读取。')
    sources.push(material.source)
    const records = material.records.filter(row => !row.migrationRetired && !row.migrationEvidence?.deletedAt)
    data.contracts = records.filter(row => !row.draft.isSupplement).map((row): SupplierContractSourceRow => {
      const supplements = records.filter(child => child.draft.isSupplement && child.draft.originalContractId === row.id && isEffectiveExpenditureContract(child.draft.status ?? ''))
      const supplementAmount = supplements.some(child => child.draft.amount == null) ? null : supplements.reduce((sum, child) => sum + child.draft.amount!, 0)
      return { dataOrigin: 'real', id: row.id, supplierId: row.draft.supplierId ?? null, projectId: row.draft.projectId ?? null, no: row.draft.no ?? '', name: row.draft.name ?? '', kind: '材采', amount: row.draft.amount ?? null, supplementAmount, signDate: row.draft.signDate || null, status: row.draft.status ?? '' }
    })
  }
  sources.push({ key: 'other-contract-domains', state: 'unavailable', sourceVersion: null, asOf: null })
  if (await source('settlements', 'other-settlements', ['other-settlement:read'], 'other_settlement_revision')) {
    await validateOtherSettlementJournal(tx, actor)
    await validateOtherSettlementImportEvidence(tx, actor)
    const stored = await readOtherSettlementStored(tx, actor)
    sources.push({ key: 'other-settlements', state: 'readable', sourceVersion: `other-settlements-${stored.revision}`, asOf })
    data.settlements = stored.records.flatMap((row) => {
      const draft = row.draft
      // The service supplier and the worker/personal payee are independent identities.
      return draft.supplierId ? [{ dataOrigin: 'real' as const, id: row.id, supplierId: draft.supplierId, projectId: draft.projectId ?? null, contractId: draft.contractId ?? null, no: draft.no ?? '', name: draft.name ?? '', settlementType: draft.settlementType ?? '', totalAmount: draft.totalAmount ?? null, settlementDate: draft.settlementDate || null, status: draft.status ?? '', navigationVariant: 'other_settlement' as const }] : []
    })
  }
  sources.push({ key: 'other-settlement-domains', state: 'unavailable', sourceVersion: null, asOf: null })
  // Output invoice applications do not prove archived purchase invoices.
  sources.push({ key: 'invoices', state: 'unavailable', sourceVersion: null, asOf: null })
  if (await source('payments', 'finance', ['finance-payment-application:read', 'finance-payment-record:read'], 'finance_revision')) {
    await validateFinanceJournal(tx, actor)
    const applications = await tx.select<{ id: string }>('SELECT id FROM payment_applications WHERE deleted_at IS NULL ORDER BY id')
    for (const head of applications) {
      const row = await loadFinanceForm('payment_application', head.id, tx)
      if (!row)
        return fail('unavailable', '付款申请实际正文缺失。')
      data.paymentApplications.push({ dataOrigin: 'real', id: row.id, supplierId: row.supplierId, projectId: row.projectId, contractId: row.contractId, no: row.no, name: row.name, applyAmount: row.applyAmount, approvedAmount: row.approvedAmount, approvedAmountOrigin: row.approvedAmountOrigin, applyDate: row.applyDate || null, status: row.status })
    }
    const records = await tx.select<{ id: string }>('SELECT id FROM payment_records WHERE deleted_at IS NULL ORDER BY id')
    for (const head of records) {
      const row = await loadFinanceForm('payment_record', head.id, tx)
      if (!row || typeof row.amount !== 'number')
        return fail('unavailable', '实付款实际正文缺失。')
      data.paymentRecords.push({ dataOrigin: 'real', id: row.id, supplierId: row.supplierId ?? null, projectId: row.projectId ?? null, no: row.no ?? '', amount: row.amount, paymentDate: row.paymentDate || null, confirmationStatus: row.confirmationStatus ?? '' })
      for (const line of row.applicationAllocations ?? []) {
        const application = data.paymentApplications.find(application => application.id === line.paymentApplicationId)
        if (application && application.supplierId !== (row.supplierId ?? null))
          return fail('unavailable', '付款分摊的收款身份与原申请不一致。')
        if (!line.id || !line.paymentApplicationId || typeof line.allocatedAmount !== 'number')
          return fail('unavailable', '付款分摊正文损坏。')
        data.paymentAllocations.push({ dataOrigin: 'real', id: line.id, paymentRecordId: row.id, paymentApplicationId: line.paymentApplicationId, allocatedAmount: line.allocatedAmount })
      }
    }
  }
  return data
}

export function supplierFactUnavailableSources(facts: ProductionSupplierFacts, list: boolean): SupplierFactSource[] {
  const sources: SupplierFactSource[] = ['projects', 'contracts', 'settlements', 'invoices', 'payments']
  return sources.filter(key => (list && key !== 'payments') || !facts.sources.some(source => source.key === key && source.state === 'readable'))
}
function partial(metric: MetricDTO, missing: string): MetricDTO {
  return { ...metric, value: null, status: 'partial', missingCount: null, missingSources: [...new Set([...metric.missingSources, missing])] }
}
export function projectSupplierPartialFacts(detail: ReadProjection<SupplierDetailReadDTO>, facts: ProductionSupplierFacts): ReadProjection<SupplierDetailReadDTO> {
  const readable = (key: string) => facts.sources.some(source => source.key === key && source.state === 'readable')
  // Related row labels may be real while the separate cooperation tab remains unavailable.
  return { ...detail, unavailableSources: [...new Set<SupplierFactSource>([...(detail.unavailableSources ?? []), 'projects'])], summary: { ...detail.summary, projectCount: null, contractCount: null, settlementCount: null, contractAmount: readable('contracts') ? partial(detail.summary.contractAmount, 'other-contract-domains') : detail.summary.contractAmount, settlementAmount: readable('settlements') ? partial(detail.summary.settlementAmount, 'other-settlement-domains') : detail.summary.settlementAmount,
    // A material-only contract subtotal cannot establish the supplier's complete payable balance.
    payableAmount: { ...detail.summary.payableAmount, value: null, knownValue: null, status: 'partial', participatingCount: null, missingCount: null, missingSources: ['other-contract-domains'] } } }
}
