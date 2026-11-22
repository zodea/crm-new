import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PaymentContractReference } from '../../app/lib/finance/payment-contract'
import { financeFailure } from '../../app/lib/finance/central-contract'

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const version = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value)
const invalid = () => financeFailure('unavailable', '付款采用的结算合同冻结证据不完整，请核对原资料。')
function sourcesValid(value: Row) {
  const prefix = value.domain === 'subcontract' ? /^subcontract-contract-\d+$/ : /^auxiliary-contract-\d+$/
  return typeof value.sourceVersion === 'string' && prefix.test(value.sourceVersion)
    && version(value.projectVersion) && typeof value.projectSourceVersion === 'string' && /^projects:\d+$/.test(value.projectSourceVersion)
    && version(value.supplierVersion) && typeof value.supplierSourceVersion === 'string' && /^suppliers:\d+$/.test(value.supplierSourceVersion)
}

function settlementContractKindValid(value: Row) {
  return (value.domain === 'auxiliary' && value.kind === 'other_expense') || (value.domain === 'subcontract' && value.kind === 'subcontract')
}

/** Consumes only evidence returned by the settlement owner in the current transaction. */
export function createPaymentSettlementEvidence() {
  const proofs: Row[] = []
  return {
    checkNone(value: unknown, input: { settlementId: string, settlementVersion: unknown }) {
      if (!object(value) || value.settlementId !== input.settlementId || value.settlementVersion !== input.settlementVersion || typeof value.settlementVersion !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value.settlementVersion))
        return invalid()
      if (value.state === 'forbidden')
        return financeFailure('forbidden', '缺少结算来源的读取权限。')
      if (value.state === 'resolved')
        return financeFailure('validation-failed', '关联结算不属于无合同付款申请。')
      if (value.state !== 'none')
        return financeFailure('unavailable', '关联结算的无合同来源无法核实。')
    },
    check(value: unknown, input: { settlementId: string, settlementVersion: unknown, projectId: string | null, supplierId: string | null, contract: PaymentContractReference }) {
      if (!object(value))
        return invalid()
      if (value.state === 'forbidden')
        return financeFailure('forbidden', '缺少结算合同或关联资料的读取权限。')
      if (value.state !== 'resolved')
        return financeFailure('unavailable', '结算合同来源尚未核实，请先完成明确映射。')
      if (value.settlementId !== input.settlementId || value.settlementVersion !== input.settlementVersion || !version(value.settlementVersion)
        || !settlementContractKindValid(value) || value.domain !== input.contract.domain || value.id !== input.contract.id || value.version !== input.contract.version
        || value.projectId !== input.projectId || value.supplierId !== input.supplierId || !sourcesValid(value)
        || proofs.some(row => row.settlementId === value.settlementId)) {
        return invalid()
      }
      proofs.push(structuredClone(value))
    },
    evidence: () => structuredClone(proofs),
  }
}

/** Recheck frozen proofs against immutable settlement and contract versions. */
export async function validatePaymentSettlementEvidence(tx: Pick<TransactionDb, 'select'>, snapshot: Row) {
  if (!Object.hasOwn(snapshot, 'paymentSettlementEvidence'))
    return
  if (!object(snapshot.head) || !object(snapshot.relations) || !Array.isArray(snapshot.relations.payment_application_settlement_allocations) || !Array.isArray(snapshot.paymentSettlementEvidence))
    return invalid()
  const seen = new Set<string>()
  for (const proof of snapshot.paymentSettlementEvidence) {
    if (!object(proof) || proof.state !== 'resolved' || !settlementContractKindValid(proof)
      || typeof proof.settlementId !== 'string' || seen.has(proof.settlementId) || !version(proof.settlementVersion) || !version(proof.version) || !sourcesValid(proof)
      || proof.id !== snapshot.head.contract_id || proof.domain !== snapshot.head.contract_domain || proof.version !== snapshot.head.contract_version
      || proof.projectId !== snapshot.head.project_id || proof.supplierId !== snapshot.head.supplier_id
      || !snapshot.relations.payment_application_settlement_allocations.some(row => object(row) && row.settlement_id === proof.settlementId && row.deleted_at === null)) {
      return invalid()
    }
    seen.add(proof.settlementId)
    const subcontract = proof.domain === 'subcontract'
    const settlements = subcontract
      ? await tx.select<{ snapshot_json: string }>('SELECT after_json AS snapshot_json FROM owner_document_history WHERE kind=\'sub_settlement\' AND document_id=? AND json_extract(after_json,\'$.version\')=?', [proof.settlementId, Number(proof.settlementVersion)])
      : await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM other_settlement_history WHERE settlement_id=? AND version=?', [proof.settlementId, Number(proof.settlementVersion)])
    const [contract] = await tx.select<{ snapshot_json: string }>(subcontract
      ? 'SELECT snapshot_json FROM subcontract_contract_versions WHERE id=? AND version=?'
      : 'SELECT snapshot_json FROM auxiliary_contract_versions WHERE id=? AND version=?', [proof.id, Number(proof.version)])
    if (settlements.length !== 1)
      return invalid()
    let settlementSnapshot: unknown
    let contractSnapshot: unknown
    try {
      settlementSnapshot = JSON.parse(settlements[0]!.snapshot_json)
      contractSnapshot = JSON.parse(contract?.snapshot_json ?? '')
    }
    catch { return invalid() }
    if (!object(settlementSnapshot) || settlementSnapshot.id !== proof.settlementId || (subcontract && settlementSnapshot.kind !== 'sub_settlement'))
      return invalid()
    const settlementDraft = subcontract ? settlementSnapshot : settlementSnapshot.draft
    if (!object(settlementDraft) || settlementDraft.contractId !== proof.id || settlementDraft.projectId !== proof.projectId || settlementDraft.supplierId !== proof.supplierId
      || !object(contractSnapshot) || !object(contractSnapshot.draft) || contractSnapshot.draft.id !== proof.id || (!subcontract && contractSnapshot.draft.kind !== 'other_expense')
      || contractSnapshot.draft.projectId !== proof.projectId || contractSnapshot.draft.supplierId !== proof.supplierId) {
      return invalid()
    }
  }
  const active = snapshot.relations.payment_application_settlement_allocations.filter(row => object(row) && row.deleted_at === null)
  if (snapshot.head.contract_id && active.length !== seen.size)
    return invalid()
}
