import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PaymentVerificationEdit, PaymentVerificationOriginal, PaymentVerificationProof, PaymentVerificationSource, PaymentVerificationState } from '../../app/lib/finance/payment-verification'
import type { FinanceDomainTx } from '../../app/lib/finance/reference'
import type { BusinessSession } from './business-session'
import { createHash, randomUUID } from 'node:crypto'
import { isConfirmedExpenditureSettlement } from '../../app/lib/contract/effective-status'
import { approvalPaymentCap } from '../../app/lib/finance/approval-amount'
import { financeFailure as fail, financeProblemFromUnknown } from '../../app/lib/finance/central-contract'
import { isPaymentVerificationProof, requiresPaymentVerification } from '../../app/lib/finance/payment-verification'
import { verifiedFinanceSum } from '../../app/lib/finance/persistent-rows'
import { otherSettlementOwnerPredicate } from '../../app/lib/other-settlement/storage'
import { validateFinanceContractHistory } from './production-finance-contract-history'
import { readOriginalExpenseReference } from './production-finance-expense-references'
import { financeCanonical, financeCommandFingerprint } from './production-finance-request'

type Row = Record<string, unknown>
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function head(tx: Pick<TransactionDb, 'select'>, id: string) {
  const record = (await tx.select<Row>('SELECT * FROM payment_applications WHERE id=? AND deleted_at IS NULL', [id]))[0]
  if (!record)
    fail('not-found', '付款申请不存在或已删除，不能生成业务核验。')
  return record
}
async function applicationSnapshot(tx: Pick<TransactionDb, 'select'>, id: string) {
  return { head: await head(tx, id), allocations: await tx.select<Row>('SELECT * FROM payment_application_settlement_allocations WHERE payment_application_id=? ORDER BY id', [id]) }
}
function source(owner: PaymentVerificationSource['owner'], id: string, version: string, sourceVersion: string, evidence: unknown): PaymentVerificationSource {
  return { owner, id, version, sourceVersion, fingerprint: financeCommandFingerprint(evidence), evidenceJson: financeCanonical(evidence) }
}
async function originalExpenseSnapshot(tx: Pick<TransactionDb, 'select'>, headerId: string, lineId: string, version: string) {
  const row = (await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'reimbursement\' AND id=? AND version=?', [headerId, Number(version)]))[0]
  if (!row)
    fail('unavailable', '原费用缺少对应稳定头与版本的真实冻结记录。')
  const snapshot = JSON.parse(row.snapshot_json)
  if (snapshot.head?.id !== headerId || !Array.isArray(snapshot.relations?.expense_reimbursement_lines)
    || !snapshot.relations.expense_reimbursement_lines.some((line: Row) => line.id === lineId && line.reimbursement_id === headerId)) {
    fail('unavailable', '原费用稳定行不属于该真实冻结版本。')
  }
  return snapshot
}
async function confirmedSettlementSnapshot(tx: Pick<TransactionDb, 'select'>, id: string, version: string) {
  const head = (await tx.select<Row>(`SELECT * FROM expenditure_settlements WHERE id=? AND ${await otherSettlementOwnerPredicate(tx)}`, [id]))[0]
  if (!head || String(head.version) !== version || !isConfirmedExpenditureSettlement(String(head.status)))
    fail('unavailable', '真实已确认结算版本缺失，不能以仅含摘要的外来证据替代。')
  // This owner freezes confirmed heads and adopted lines. Cash and unrelated owner revisions never edit this graph.
  // The v30 owner discriminator is technical routing, not a change to an existing PAY-08 frozen source.
  const { document_owner: _routing, ...originalHead } = head
  return { head: originalHead, allocations: await tx.select<Row>('SELECT * FROM expenditure_settlement_expense_allocations WHERE settlement_id=? ORDER BY id', [id]) }
}
async function validateFrozenSource(tx: Pick<TransactionDb, 'select'>, frozen: PaymentVerificationSource) {
  const evidence = JSON.parse(frozen.evidenceJson)
  if (typeof evidence.ownerSnapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.ownerSnapshotSha256))
    fail('unavailable', '业务核验源未绑定实际 owner 冻结记录。')
  if (frozen.owner === 'finance-expense') {
    if (typeof evidence.headerId !== 'string')
      fail('unavailable', '核验原费用稳定头身份缺失。')
    const snapshot = await originalExpenseSnapshot(tx, evidence.headerId, frozen.id, frozen.version)
    const line = snapshot.relations.expense_reimbursement_lines.find((row: Row) => row.id === frozen.id)
    let clearance: Row = {}
    let clearedAmount = 0
    if (evidence.clearanceVerificationId !== undefined) {
      const row = (await tx.select<{ proof_json: string }>('SELECT proof_json FROM finance_expense_clearance_verifications WHERE id=?', [evidence.clearanceVerificationId]))[0]
      const proof = row ? JSON.parse(row.proof_json) : null
      if (!proof || proof.originalExpenseLineId !== frozen.id || financeCommandFingerprint(proof) !== evidence.clearanceVerificationSha256)
        fail('unavailable', '付款核验引用的旧份额核定事实缺失或损坏。')
      clearance = { clearanceVerificationId: proof.id, clearanceVerificationSha256: financeCommandFingerprint(proof) }
      clearedAmount = verifiedFinanceSum(proof.sourceSnapshot.clearances.filter((record: Row) => record.head_status === 'confirmed' && record.deleted_at === null && record.head_deleted_at === null).map((record: Row) => record.amount))
    }
    const expected = { id: line.id, headerId: snapshot.head.id, projectId: snapshot.head.project_id, amount: line.amount, version: frozen.version, clearedAmount, expenseItem: line.expense_item, serviceSupplierId: line.counterparty_supplier_id, serviceSupplierNameSnapshot: line.counterparty_name_snapshot, applicantWorkerId: snapshot.head.applicant_worker_id, applicantSupplierId: snapshot.head.applicant_supplier_id, applicantNameSnapshot: snapshot.head.applicant_name_snapshot, ownerSnapshotSha256: financeCommandFingerprint(snapshot), ...clearance }
    if (financeCanonical(evidence) !== financeCanonical(expected) || line.original_expense_line_id !== null || line.deleted_at || snapshot.head.deleted_at || snapshot.head.status !== 'confirmed')
      fail('unavailable', '核验原费用身份、金额或采用名与真实冻结源不一致。')
  }
  else {
    const snapshot = await confirmedSettlementSnapshot(tx, frozen.id, frozen.version)
    if (evidence.ownerSnapshotSha256 !== financeCommandFingerprint(snapshot)
      || evidence.project_id !== snapshot.head.project_id || evidence.contract_id !== snapshot.head.contract_id
      || evidence.service_supplier_id !== snapshot.head.supplier_id
      || evidence.supplier_id !== snapshot.head.payee_supplier_id || evidence.worker_id !== snapshot.head.payee_worker_id
      || evidence.payee_name_snapshot !== snapshot.head.payee_name_snapshot
      || financeCanonical([...(evidence.original_expense_line_ids ?? [])].sort()) !== financeCanonical(snapshot.allocations.filter(row => !row.deleted_at).map(row => row.original_expense_line_id).sort())) {
      fail('unavailable', '核验结算源与实际不可变结算及原费用采用关系不一致。')
    }
  }
}
async function verifiedSources(tx: FinanceDomainTx, actor: BusinessSession, applicationId: string) {
  const application = await head(tx, applicationId)
  if (!actor.capabilities.includes('finance-payment-record:read'))
    fail('forbidden', '核验需读取同一申请的真实确认实付。')
  for (const [table, id] of [['projects', application.project_id], ['suppliers', application.supplier_id], ['workers', application.worker_id]] as const) {
    if (id && !await tx.references?.read(table, String(id)))
      fail('unavailable', '核验关联的真实项目或付款对象不可用，请保留历史。')
  }
  if (Boolean(application.supplier_id) === Boolean(application.worker_id))
    fail('unavailable', '历史付款对象尚未核实，不能按姓名生成业务核验。')
  if (application.contract_id || application.company_expense_contract_id) {
    if (application.contract_id)
      await tx.references?.read('contracts', String(application.contract_id))
    fail('unavailable', '合同或公司费用合同付款核验所需真实送货、合同结算及相关合同 owner 尚未完整接通；真实回单可保存草稿。')
  }
  const allocations = await tx.select<Row>('SELECT * FROM payment_application_settlement_allocations WHERE payment_application_id=? AND deleted_at IS NULL ORDER BY id', [applicationId])
  if (!allocations.length)
    fail('unavailable', '业务核验缺少真实已确认结算，请先沿原费用与结算链核实；不能只重填批复。')
  const sources: PaymentVerificationSource[] = []
  const seen = new Set<string>()
  for (const allocation of allocations) {
    const amount = verifiedFinanceSum([allocation.allocated_amount])
    const settlement = await tx.references?.read<Row>('expenditure_settlements', String(allocation.settlement_id))
    if (!settlement || !isConfirmedExpenditureSettlement(String(settlement.status)) || settlement.deleted_at
      || settlement.project_id !== application.project_id || (settlement.supplier_id ?? null) !== application.supplier_id || (settlement.worker_id ?? null) !== application.worker_id
      || settlement.contract_id || typeof settlement.version !== 'string' || typeof settlement.source_revision !== 'string'
      || !Array.isArray(settlement.original_expense_line_ids) || !settlement.original_expense_line_ids.length) {
      fail('unavailable', '结算当前状态、原费用、付款对象或版本不能证明本次核验。')
    }
    const net = verifiedFinanceSum([settlement.total_amount])
    if (!(amount > 0) || amount > net + 0.0001)
      fail('unavailable', '申请采用金额超过真实结算净额，不能生成可付结论。')
    const evidence: Row = { ...settlement, allocatedAmount: amount, ownerSnapshotSha256: financeCommandFingerprint(await confirmedSettlementSnapshot(tx, String(settlement.id), settlement.version)) }
    delete evidence.source_revision
    delete evidence.document_owner
    sources.push(source('other-settlements', String(settlement.id), settlement.version, `other-settlement-record-${settlement.version}`, evidence))
    for (const originalId of settlement.original_expense_line_ids) {
      if (typeof originalId !== 'string')
        fail('unavailable', '结算原费用稳定身份损坏。')
      const expense = await readOriginalExpenseReference(tx, actor, originalId)
      if (!expense || !['verified', 'not-required'].includes(expense.qualification.state))
        fail('unavailable', '原费用存在尚未核实的旧清偿承接或真实来源缺口，不能推定新付款额度。')
      if (expense.projectId !== application.project_id || expense.applicantSupplierId !== application.supplier_id || expense.applicantWorkerId !== application.worker_id)
        fail('unavailable', '原费用冻结的实际垫付身份或归属与申请不一致。')
      if (!seen.has(expense.id)) {
        seen.add(expense.id)
        // Global finance revisions also move when cash is confirmed; bind the actual source record version instead.
        const record = { id: expense.id, headerId: expense.headerId, projectId: expense.projectId, amount: expense.amount, version: expense.version, clearedAmount: expense.clearedAmount, expenseItem: expense.expenseItem, serviceSupplierId: expense.serviceSupplierId, serviceSupplierNameSnapshot: expense.serviceSupplierNameSnapshot, applicantWorkerId: expense.applicantWorkerId, applicantSupplierId: expense.applicantSupplierId, applicantNameSnapshot: expense.applicantNameSnapshot, ...(expense.qualification.verificationId ? { clearanceVerificationId: expense.qualification.verificationId, clearanceVerificationSha256: financeCommandFingerprint(expense.clearanceProofs.find(proof => proof.id === expense.qualification.verificationId)) } : {}) }
        sources.push(source('finance-expense', expense.id, expense.version, `finance-record-${expense.version}`, { ...record, ownerSnapshotSha256: financeCommandFingerprint(await originalExpenseSnapshot(tx, expense.headerId, expense.id, expense.version)) }))
      }
    }
  }
  return { application, sources, allocated: verifiedFinanceSum(allocations.map(row => row.allocated_amount)) }
}
async function originals(tx: Pick<TransactionDb, 'select'>, applicationId: string, ids: string[], active = true): Promise<PaymentVerificationOriginal[]> {
  const result: PaymentVerificationOriginal[] = []
  for (const id of ids) {
    const row = (await tx.select<{ id: string, owner_type: string, owner_id: string, file_name: string, file_size: number, deleted_at: string | null, content: Uint8Array | null, sha256: string | null }>('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [id]))[0]
    if (!row || row.owner_type !== 'payment_application' || row.owner_id !== applicationId || (active && row.deleted_at)
      || !(row.content instanceof Uint8Array) || row.content.length !== row.file_size || hash(row.content) !== row.sha256) {
      fail('unavailable', '核验依据必须是本申请已保存且实际字节、大小及摘要可靠的原件；历史缺件不能冒充空文件。')
    }
    result.push({ id, ownerType: row.owner_type, ownerId: row.owner_id, fileName: row.file_name, fileSize: row.file_size, sha256: row.sha256! })
  }
  return result
}
export async function createPaymentVerification(tx: FinanceDomainTx, actor: BusinessSession, input: { id: string, version: string, commandId: string, occurredAt: string, edit: PaymentVerificationEdit }): Promise<PaymentVerificationProof> {
  if (!await requiresPaymentVerification(tx, input.id))
    fail('validation-failed', '此申请没有历史未知批复核验要求，不能冒充历史核验。')
  const facts = await verifiedSources(tx, actor, input.id)
  const apply = verifiedFinanceSum([facts.application.apply_amount])
  const approved = facts.application.approved_amount
  const origin = facts.application.approved_amount_origin
  if (!(approved === null || (typeof approved === 'number' && Number.isFinite(approved) && approved >= 0)) || (origin !== 'legacy' && origin !== 'user-entry'))
    fail('unavailable', '原批复金额或来源损坏，不能由核验输入覆盖。')
  const approval = approvalPaymentCap(apply, approved, origin)
  if (input.edit.actualDueAmount > facts.allocated + 0.0001 || input.edit.cumulativePayableAmount > apply + 0.0001
    || (approval !== null && input.edit.cumulativePayableAmount > approval + 0.0001)) {
    fail('validation-failed', '累计核验结论超过真实采用结算、申请或明确批复上限；本次回单金额不能代替累计额度。')
  }
  const paid = await tx.select<{ amount: unknown }>('SELECT a.allocated_amount AS amount FROM payment_record_application_allocations a JOIN payment_records p ON p.id=a.payment_record_id WHERE a.payment_application_id=? AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND p.confirmation_status=\'confirmed\'', [input.id])
  if (verifiedFinanceSum(paid.map(row => row.amount)) > input.edit.cumulativePayableAmount + 0.0001)
    fail('validation-failed', '累计可付结论小于已确认实付，请核实真实依据；不会改写旧现金对平。')
  const proof: PaymentVerificationProof = { ...input.edit, schemaVersion: 'payment-verification-v1', applicationId: input.id, applicationVersion: input.version, commandId: input.commandId, workspaceId: actor.workspaceId, actorId: actor.actorId, verifiedAt: input.occurredAt, applicationSnapshotSha256: financeCommandFingerprint(await applicationSnapshot(tx, input.id)), sources: facts.sources, originals: await originals(tx, input.id, input.edit.fileIds) }
  await tx.execute('INSERT INTO finance_payment_verifications VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), input.id, Number(input.version), input.commandId, actor.workspaceId, actor.actorId, input.occurredAt, JSON.stringify(proof)])
  return proof
}
async function storedProof(tx: Pick<TransactionDb, 'select'>, id: string): Promise<PaymentVerificationProof | null> {
  const row = (await tx.select<{ proof_json: string }>('SELECT proof_json FROM finance_payment_verifications WHERE application_id=? ORDER BY application_version DESC LIMIT 1', [id]))[0]
  if (!row)
    return null
  const proof: unknown = JSON.parse(row.proof_json)
  if (!isPaymentVerificationProof(proof))
    fail('unavailable', '冻结业务核验记录损坏，请核对备份。')
  return proof
}
async function currentProof(tx: FinanceDomainTx, actor: BusinessSession, id: string): Promise<PaymentVerificationProof> {
  await validatePaymentVerificationJournal(tx, actor)
  const proof = await storedProof(tx, id)
  const version = (await tx.select<{ version: number }>('SELECT version FROM finance_versions WHERE kind=\'payment_application\' AND id=?', [id]))[0]
  if (!proof || proof.workspaceId !== actor.workspaceId || proof.actorId !== actor.actorId)
    fail('unavailable', '历史批复未知需先完成真实业务核验，不能重填批复后直接确认支付。')
  const snapshot = await applicationSnapshot(tx, id)
  const history = await validateFinanceContractHistory(tx)
  if (history.isLegacy(id, version?.version)) {
    if (snapshot.head.contract_domain !== null || snapshot.head.contract_version !== null)
      fail('unavailable', '付款合同身份已变化，请重新核验当前依据。')
    delete snapshot.head.contract_domain
    delete snapshot.head.contract_version
  }
  if (proof.applicationVersion !== String(version?.version) || proof.applicationSnapshotSha256 !== financeCommandFingerprint(snapshot))
    fail('unavailable', '付款申请或采用关系已变化，请重新核验当前依据；旧核验继续冻结保留。')
  const facts = await verifiedSources(tx, actor, id)
  if (financeCanonical(facts.sources) !== financeCanonical(proof.sources) || financeCanonical(await originals(tx, id, proof.fileIds)) !== financeCanonical(proof.originals))
    fail('unavailable', '核验源版本或依据原件已变化，请重新核验，不能沿用旧结论确认新支付。')
  return proof
}
export async function paymentVerificationCap(tx: FinanceDomainTx, actor: BusinessSession, id: string): Promise<number> {
  const proof = await currentProof(tx, actor, id)
  return Math.min(proof.actualDueAmount, proof.cumulativePayableAmount)
}
export async function paymentVerificationState(tx: FinanceDomainTx, actor: BusinessSession, id: string): Promise<PaymentVerificationState> {
  const required = await requiresPaymentVerification(tx, id)
  if (!required)
    return { required, status: 'not-required', message: '', proof: null }
  try {
    const proof = await currentProof(tx, actor, id)
    return { required, status: 'verified', message: '已冻结当前业务核验，确认支付时仍复验源版本与累计实付。', proof }
  }
  catch (cause) {
    const problem = financeProblemFromUnknown(cause).problem
    if (problem.code === 'forbidden')
      return { required, status: 'unavailable', message: problem.message, proof: null }
    const proof = await storedProof(tx, id)
    return { required, status: proof ? 'stale' : 'missing', message: problem.message, proof: null }
  }
}
/** Historical proofs need their original command/history and bytes; current source edits do not erase old proofs. */
export async function validatePaymentVerificationJournal(tx: Pick<TransactionDb, 'select'>, identity: { workspaceId: string, actorId: string }): Promise<void> {
  const table = await tx.select<{ name: string }>('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'finance_payment_verifications\'')
  if (!table.length) {
    const metadata = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_metadata WHERE singleton=1'))[0]
    if (!metadata || !Number.isSafeInteger(metadata.schema_version) || metadata.schema_version >= 13)
      fail('unavailable', '业务核验子记录结构缺失，请核对备份。')
    return
  }
  const proofs = await tx.select<Row>('SELECT * FROM finance_payment_verifications')
  for (const command of await tx.select<{ command_id: string, request_json: string, result_json: string }>('SELECT command_id,request_json,result_json FROM finance_commands WHERE result_json IS NOT NULL')) {
    const request = JSON.parse(command.request_json)
    const result = JSON.parse(command.result_json)
    if (request.draft?.verificationEdit) {
      if (request.kind !== 'payment_application' || request.action !== 'save' || proofs.filter(row => row.command_id === command.command_id).length !== 1)
        fail('unavailable', '原业务核验已保存回执缺少唯一的实际冻结子记录。')
    }
    else if (Object.hasOwn(result, 'paymentVerificationSha256')) {
      fail('unavailable', '普通财务回执不能冒充业务核验回执。')
    }
  }
  for (const row of proofs) {
    const proof: unknown = typeof row.proof_json === 'string' ? JSON.parse(row.proof_json) : null
    if (!isPaymentVerificationProof(proof) || proof.applicationId !== row.application_id || proof.applicationVersion !== String(row.application_version)
      || proof.commandId !== row.command_id || proof.workspaceId !== identity.workspaceId || proof.actorId !== identity.actorId || row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId || proof.verifiedAt !== row.verified_at) {
      fail('unavailable', '业务核验冻结身份或内容损坏。')
    }
    const history = (await tx.select<{ snapshot_json: string, command_id: string, actor_id: string, occurred_at: string }>('SELECT * FROM finance_history WHERE kind=\'payment_application\' AND id=? AND version=?', [proof.applicationId, Number(proof.applicationVersion)]))[0]
    const command = (await tx.select<{ request_json: string, result_json: string | null }>('SELECT * FROM finance_commands WHERE command_id=?', [proof.commandId]))[0]
    if (!history || !command?.result_json || history.command_id !== proof.commandId || history.actor_id !== proof.actorId || history.occurred_at !== proof.verifiedAt)
      fail('unavailable', '业务核验缺少对应原命令或申请冻结版本。')
    const snapshot = JSON.parse(history.snapshot_json)
    const request = JSON.parse(command.request_json)
    const result = JSON.parse(command.result_json)
    if (request.kind !== 'payment_application' || request.action !== 'save' || result.id !== proof.applicationId || result.version !== proof.applicationVersion
      || result.paymentVerificationSha256 !== financeCommandFingerprint(proof)
      || financeCanonical(request.draft.verificationEdit) !== financeCanonical({ actualDueAmount: proof.actualDueAmount, cumulativePayableAmount: proof.cumulativePayableAmount, basis: proof.basis, fileIds: proof.fileIds })
      || proof.applicationSnapshotSha256 !== financeCommandFingerprint({ head: snapshot.head, allocations: snapshot.relations.payment_application_settlement_allocations })) {
      fail('unavailable', '核验结论与原提交、源申请冻结关系不一致。')
    }
    for (const source of proof.sources) {
      if (financeCommandFingerprint(JSON.parse(source.evidenceJson)) !== source.fingerprint)
        fail('unavailable', '核验源冻结摘要损坏。')
      await validateFrozenSource(tx, source)
    }
    if (financeCanonical(await originals(tx, proof.applicationId, proof.fileIds, false)) !== financeCanonical(proof.originals))
      fail('unavailable', '核验依据原件与冻结证据不一致。')
  }
}
