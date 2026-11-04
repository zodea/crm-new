import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PaymentContractReference } from '../../app/lib/finance/payment-contract'
import type { BusinessSession } from './business-session'
import { financeFailure, FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { expenseContractKindsForPaymentType, expenseContractMatchesPaymentType } from '../../app/lib/finance/domain'
import { paymentContractSelectionKey } from '../../app/lib/finance/payment-contract'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { validateProductionAuxiliaryState } from './production-auxiliary-contract-record'
import { verifyInvoiceContractReference } from './production-invoice-contracts'
import { loadProductionMaterialContractState } from './production-material-contract-record'
import { validateProductionSubcontractState } from './production-subcontract-contract-record'

/** Resolve the selected owner in the same transaction as the payment command. */
export async function verifyPaymentContract(tx: TransactionDb, actor: BusinessSession, reference: PaymentContractReference, projectId: string | null, supplierId: string | null, bizType: string) {
  let actual: Awaited<ReturnType<typeof verifyInvoiceContractReference>>
  try {
    actual = await verifyInvoiceContractReference(tx, actor, reference, projectId, supplierId)
  }
  catch (cause) {
    if (cause instanceof CentralInvoiceProblem)
      throw new FinanceRepositoryProblem(cause.problem)
    throw cause
  }
  if (!actual.supplierId || actual.supplierId !== supplierId || (reference.domain === 'company' ? projectId !== null || actual.projectId !== null || bizType !== '公司付款' : !actual.projectId || actual.projectId !== projectId || bizType === '公司付款'))
    return financeFailure('validation-failed', '付款合同与项目或实际收款单位不一致。')
  if (reference.domain === 'company')
    return
  let kind = ''
  let subKind: string | null = null
  if (reference.domain === 'material') {
    kind = '材采'
  }
  else if (reference.domain === 'auxiliary') {
    kind = '其他支出'
  }
  else if (reference.domain === 'subcontract') {
    kind = '分包'
    const state = await validateProductionSubcontractState(tx, actor)
    const row = state.state.contracts.find(item => item.draft.id === reference.id)
    subKind = row?.draft.subKind ?? null
  }
  else {
    return financeFailure('validation-failed', '所选合同不属于付款支出合同。')
  }
  if (!expenseContractMatchesPaymentType(bizType, { kind, sub_kind: subKind }))
    return financeFailure('validation-failed', '关联合同类型与付款申请业务类型不一致。')
}

/** Complete authorized domain list; duplicate IDs remain distinct through their domain. */
export async function listPaymentContractCandidates(tx: TransactionDb, actor: BusinessSession, projectId: string | null, supplierId: string | null, bizType: string) {
  if (!supplierId || (bizType !== '公司付款' && !projectId) || (bizType === '公司付款' && projectId !== null))
    return []
  const kinds = expenseContractKindsForPaymentType(bizType)
  const candidates: Array<{ id: string, label: string, hint: string, paymentContract: PaymentContractReference }> = []
  for (const [kind, domain, participant, capability] of [
    ['材采', 'material', 'material-contracts', 'material-contract:read'],
    ['分包', 'subcontract', 'subcontract-contracts', 'subcontract-contract:read'],
    ['其他支出', 'auxiliary', 'auxiliary-contract', 'auxiliary-contract:read'],
    ['公司开销', 'company', 'auxiliary-contract', 'auxiliary-contract:read'],
  ] as const) {
    if (domain === 'company' ? bizType !== '公司付款' : bizType === '公司付款' || !kinds.includes(kind))
      continue
    if (!actor.capabilities.includes(capability))
      financeFailure('forbidden', '缺少付款合同候选来源读取权限。')
    const [source] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', [participant])
    if (source?.schema_version !== 1)
      financeFailure('unavailable', '付款合同候选来源尚未接通。')
    const rows: Array<{ id: string, version: number, name?: string, no?: string, projectId?: string | null, supplierId?: string | null, subKind?: string | null }> = []
    if (domain === 'material') {
      const state = await loadProductionMaterialContractState(tx, actor)
      for (const row of state.contracts.filter(item => !item.draft.isSupplement && !item.migrationRetired && !item.migrationEvidence?.deletedAt))
        rows.push({ id: row.id, version: row.version, name: row.draft.name, no: row.draft.no, projectId: row.draft.projectId, supplierId: row.draft.supplierId })
    }
    else if (domain === 'subcontract') {
      const state = await validateProductionSubcontractState(tx, actor)
      const heads = await tx.select<{ id: string, deleted_at: string | null }>('SELECT id,deleted_at FROM subcontract_contract_records')
      const restores = await tx.select<{ import_id: string }>('SELECT import_id FROM subcontract_contract_import_restores')
      for (const row of state.state.contracts.filter(item => heads.some(head => head.id === item.draft.id && head.deleted_at === null) && !restores.some(restore => restore.import_id === item.migrationBatchId)))
        rows.push({ id: row.draft.id, version: row.version, name: row.draft.name, no: row.draft.no, projectId: row.draft.projectId, supplierId: row.draft.supplierId, subKind: row.draft.subKind })
    }
    else {
      const state = await validateProductionAuxiliaryState(tx, actor)
      const heads = await tx.select<{ id: string, deleted_at: string | null }>('SELECT id,deleted_at FROM auxiliary_contract_records')
      for (const row of state.state.contracts.filter(item => item.draft.kind === (domain === 'company' ? 'company_expense' : 'other_expense') && heads.some(head => head.id === item.draft.id && head.deleted_at === null) && !state.restores.some(restore => restore.import_id === item.migrationBatchId)))
        rows.push({ id: row.draft.id, version: row.version, name: row.draft.name, no: row.draft.no, projectId: row.draft.projectId, supplierId: row.draft.supplierId })
    }
    for (const row of rows.filter(row => (row.projectId ?? null) === projectId && row.supplierId === supplierId && (domain === 'company' || expenseContractMatchesPaymentType(bizType, { kind, sub_kind: row.subKind ?? null })))) {
      const reference: PaymentContractReference = { domain, id: row.id, version: String(row.version) }
      await verifyPaymentContract(tx, actor, reference, projectId, supplierId, bizType)
      candidates.push({ id: paymentContractSelectionKey(reference), label: row.name || row.no || row.id, hint: `${row.no || '未编号'} · ${kind}`, paymentContract: reference })
    }
  }
  return candidates
}
