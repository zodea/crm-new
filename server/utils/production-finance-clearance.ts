import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ExpenseClearanceAllocationInput, ExpenseClearanceLink, ExpenseClearanceProof, ExpenseClearanceQualification, ExpenseClearanceSourceDTO, ExpenseClearanceVerificationEdit, ExpenseClearanceVerificationState } from '../../app/lib/finance/clearance-verification'
import type { FinanceExpenseReference } from '../../app/lib/finance/expense-reference'
import type { BusinessSession } from './business-session'
import { createHash, randomUUID } from 'node:crypto'
import { CONFIRMED_SETTLEMENT_SQL_VALUES } from '../../app/lib/contract/effective-status'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { isExpenseClearanceProof } from '../../app/lib/finance/clearance-verification'
import { readVerifiedOriginalExpense } from '../../app/lib/finance/expense-reference'
import { verifiedFinanceSum } from '../../app/lib/finance/persistent-rows'
import { otherSettlementFingerprint, otherSettlementKey } from '../../app/lib/other-settlement/storage'
import { decodeOtherSettlementCommand } from '../../app/lib/other-settlement/validation'
import { declaredMissingClearanceOriginals } from './production-finance-clearance-originals'
import { financeCanonical, financeCommandFingerprint, parseFinanceCommand } from './production-finance-request'

type Db = Pick<TransactionDb, 'select'>
type Row = Record<string, unknown>
const cents = (amount: number) => Math.round(amount * 100)
const fail = (message: string): never => financeFailure('unavailable', message)
export async function hasClearanceTables(tx: Db) {
  return (await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'finance_expense_clearance_verifications\'')).length > 0
}
const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function baseExpense(tx: Db, id: string): Promise<FinanceExpenseReference> {
  const expense = await readVerifiedOriginalExpense(tx, id)
  if (!expense)
    return fail('原费用不是可核验的已确认独立费用。')
  const version = (await tx.select<{ version: number }>('SELECT version FROM finance_versions WHERE kind=\'reimbursement\' AND id=?', [expense.headerId]))[0]
  const revision = (await tx.select<{ revision: number }>('SELECT revision FROM finance_revision WHERE singleton=1'))[0]
  if (!version || !revision)
    return fail('原费用真实版本缺失。')
  return { ...expense, version: String(version.version), sourceRevision: `finance-${revision.revision}` }
}
async function sourceGraph(tx: Db, original: FinanceExpenseReference) {
  const originalRow = (await tx.select<Row>('SELECT * FROM expense_reimbursement_lines WHERE id=?', [original.id]))[0]
  const head = (await tx.select<Row>('SELECT * FROM expense_reimbursements WHERE id=?', [original.headerId]))[0]
  const rows = await tx.select<Row>('SELECT l.*,h.status AS head_status,h.deleted_at AS head_deleted_at,h.applicant_worker_id,h.applicant_supplier_id,h.applicant_name_snapshot,h.project_id,h.updated_at AS head_updated_at FROM expense_reimbursement_lines l JOIN expense_reimbursements h ON h.id=l.reimbursement_id WHERE l.original_expense_line_id=? ORDER BY l.id', [original.id])
  const clearances = []
  const clearanceHeads: Record<string, Row> = {}
  const clearanceVersions: Record<string, number | null> = {}
  const clearanceFiles: Record<string, Row[]> = {}
  const clearanceDeclaredOriginals: Record<string, Row[]> = {}
  let damagedElectronicOriginal = false
  async function originals(ownerId: string) {
    const files = await tx.select<Row>('SELECT f.*,p.sha256,p.content FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.owner_type=\'expense_reimbursement\' AND f.owner_id=? ORDER BY f.id', [ownerId])
    const known = (await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'reimbursement\' AND id=? ORDER BY version DESC LIMIT 1', [ownerId]))[0]
    const historic = known ? JSON.parse(known.snapshot_json).files as Row[] : []
    return files.map(({ content, ...file }) => {
      const body = content instanceof Uint8Array ? content : null
      const old = historic.find(row => row.id === file.id)
      if ((body && (body.length !== file.file_size || hashBytes(body) !== file.sha256)) || (!body && old?.sha256 !== null && old?.sha256 !== undefined))
        damagedElectronicOriginal = true
      return { ...file, byteSha256: body ? hashBytes(body) : null, bodyState: body ? 'readable' : 'missing-body' }
    })
  }
  const originalFiles = await originals(original.headerId)
  for (const row of rows) {
    const version = (await tx.select<{ version: number }>('SELECT version FROM finance_versions WHERE kind=\'reimbursement\' AND id=?', [row.reimbursement_id]))[0]
    const files = await originals(String(row.reimbursement_id))
    const declared = await declaredMissingClearanceOriginals(tx, String(row.reimbursement_id))
    clearanceDeclaredOriginals[String(row.reimbursement_id)] = declared.map(file => ({ id: file.id, row: file.row, reason: file.reason, sourceBytesSha256: file.sourceBytesSha256 }))
    clearanceHeads[String(row.reimbursement_id)] = (await tx.select<Row>('SELECT * FROM expense_reimbursements WHERE id=?', [row.reimbursement_id]))[0]!
    clearanceVersions[String(row.reimbursement_id)] = version?.version ?? null
    clearanceFiles[String(row.reimbursement_id)] = files
    const readable = declared.length === 0 && files.every(file => file.bodyState === 'readable')
    clearances.push({ id: String(row.id), headerId: String(row.reimbursement_id), originalExpenseLineId: original.id, amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null, status: String(row.head_status), deletedAt: row.deleted_at as string | null, headerDeletedAt: row.head_deleted_at as string | null, sourceVersion: version ? String(version.version) : null, missingOriginalDocument: (files.length === 0 && declared.length === 0) || !readable, originalDocumentState: files.length === 0 && declared.length === 0 ? 'not-digitized' as const : readable ? 'readable' as const : 'missing-body' as const, declaredMissingOriginals: declared.map(file => ({ id: file.id, fileName: file.fileName, filePath: file.filePath, fileSize: file.fileSize, reason: file.reason })) })
  }
  // Record versions are optimistic tokens; a verification itself increments the head token without editing its original facts.
  const graph = { originalRow, head, originalFiles, clearances: rows, clearanceHeads, clearanceVersions, clearanceFiles, clearanceDeclaredOriginals }
  return { snapshot: graph, hash: financeCommandFingerprint(graph), clearances, damagedElectronicOriginal }
}
export async function readClearanceProofs(tx: Db, id: string): Promise<ExpenseClearanceProof[]> {
  if (!await hasClearanceTables(tx))
    return []
  const rows = await tx.select<{ proof_json: string }>('SELECT proof_json FROM finance_expense_clearance_verifications WHERE original_expense_line_id=? ORDER BY reimbursement_version,id', [id])
  return rows.map((row) => {
    const value: unknown = JSON.parse(row.proof_json)
    if (!isExpenseClearanceProof(value))
      return fail('旧清偿核定证据损坏。')
    return value
  })
}
export async function readClearanceLinks(tx: Db, originalId?: string): Promise<ExpenseClearanceLink[]> {
  if (!await hasClearanceTables(tx))
    return []
  const rows = await tx.select<Row>(`SELECT l.*,a.settlement_id,a.original_expense_line_id FROM expenditure_settlement_clearance_links l JOIN expenditure_settlement_expense_allocations a ON a.id=l.expense_allocation_id ${originalId ? 'WHERE a.original_expense_line_id=?' : ''} ORDER BY l.id`, originalId ? [originalId] : [])
  return rows.map(row => ({ id: String(row.id), expenseAllocationId: String(row.expense_allocation_id), settlementId: String(row.settlement_id), originalExpenseLineId: String(row.original_expense_line_id), verificationId: String(row.verification_id), itemId: String(row.recognition_item_id), amount: Number(row.amount), actorId: String(row.actor_id), createdAt: String(row.created_at) }))
}
export async function readExpenseClearanceSource(tx: Db, actor: BusinessSession, original: FinanceExpenseReference, excludedLinkIds?: ReadonlySet<string>): Promise<ExpenseClearanceSourceDTO> {
  const graph = await sourceGraph(tx, original)
  const proofs = await readClearanceProofs(tx, original.id)
  const proof = proofs.at(-1) ?? null
  const links = (await readClearanceLinks(tx, original.id)).filter(link => !excludedLinkIds?.has(link.id))
  const allocations = await tx.select<Row>(`SELECT a.*,h.status,h.project_id,h.payee_supplier_id,h.payee_worker_id,h.payee_name_snapshot FROM expenditure_settlement_expense_allocations a JOIN expenditure_settlements h ON h.id=a.settlement_id WHERE a.original_expense_line_id=? AND h.status IN (${CONFIRMED_SETTLEMENT_SQL_VALUES})`, [original.id])
  const recorded = verifiedFinanceSum(graph.clearances.filter(row => row.status === 'confirmed').map(row => row.amount))
  const hasCashRead = actor.capabilities.includes('finance-payment-record:read') && actor.capabilities.includes('finance-payment-application:read')
  let q: ExpenseClearanceQualification = { state: 'not-required', message: '', verificationId: null, recordedHandledAmount: recorded, verifiedHandledAmount: 0, confirmedOtherAdoptedAmount: null, verifiedOverlapAmount: 0, newAdoptableAmount: null, legacyObligationAmount: 0, legacyPaidAmount: null, legacyUnpaidAmount: null }
  const adopted = allocations.some(row => typeof row.allocated_amount !== 'number' || !Number.isFinite(row.allocated_amount) || row.allocated_amount < 0) ? null : verifiedFinanceSum(allocations.map(row => row.allocated_amount))
  q.confirmedOtherAdoptedAmount = adopted
  if (adopted === null) {
    q = { ...q, state: 'unavailable', message: '已有已确认结算的真实采用额未知，不能将未知占用按零释放。', verifiedHandledAmount: proof ? verifiedFinanceSum(proof.items.map(item => item.amount)) : null, verifiedOverlapAmount: null }
  }
  else if (graph.damagedElectronicOriginal) {
    q = { ...q, state: 'unavailable', message: '原来已保存的电子原件正文或摘要受损；保留原缺件事实并核对恢复，替代纸单核定不能抹去这一损坏。', verifiedHandledAmount: null, verifiedOverlapAmount: null }
  }
  else if (!proof && recorded > 0) {
    q = { ...q, state: 'missing', message: '原费用已有旧清偿份额，请以原单或可交叉核实的替代依据完成明确采用核定。', verifiedHandledAmount: null, verifiedOverlapAmount: null, legacyObligationAmount: recorded }
  }
  else if (proof && proof.sourceHash !== graph.hash) {
    q = { ...q, state: 'stale', message: '原费用或相关旧清偿事实已变化，须保留原核定并重新核实。', verificationId: proof.id, verifiedHandledAmount: null, verifiedOverlapAmount: null, legacyObligationAmount: verifiedFinanceSum(proof.items.map(item => item.amount)) }
  }
  else {
    const handled = proof ? verifiedFinanceSum(proof.items.map(item => item.amount)) : 0
    const activeLinks = links.filter(link => allocations.some(row => row.id === link.expenseAllocationId))
    const overlap = verifiedFinanceSum(activeLinks.map(link => link.amount))
    const remaining = original.amount - handled - adopted + overlap
    q = { ...q, state: proof ? 'verified' : 'not-required', verificationId: proof?.id ?? null, verifiedHandledAmount: handled, verifiedOverlapAmount: overlap, legacyObligationAmount: handled, newAdoptableAmount: remaining < -0.0001 ? null : Math.max(0, remaining), message: proof ? '旧份额已核定；新采用按明确重叠去重，旧未付义务及银行事实继续保留。' : '' }
    if (remaining < -0.0001)
      q = { ...q, state: 'unavailable', message: '旧份额与已确认采用的去重合计超过原费用；原历史与实际现金保留，当前新采用不可用。' }
    // An unbound historic portion remains an obligation. No bank amount is inferred from its clearance record or uploaded document.
    if (handled === 0) {
      q.legacyPaidAmount = 0
      q.legacyUnpaidAmount = 0
    }
    else if (hasCashRead && !(await tx.select('SELECT id FROM payment_records WHERE project_id IS ? AND supplier_id IS ? AND worker_id IS ? AND confirmation_status=\'confirmed\' AND deleted_at IS NULL', [original.projectId, original.applicantSupplierId, original.applicantWorkerId])).length) {
      q.legacyPaidAmount = 0
      q.legacyUnpaidAmount = handled
    }
    else if (hasCashRead && cents(overlap) === cents(handled) && activeLinks.length > 0) {
      let paid = 0
      let proven = true
      const settlements = [...new Set(activeLinks.map(link => link.settlementId))]
      for (const settlementId of settlements) {
        const all = await tx.select<Row>('SELECT * FROM expenditure_settlement_expense_allocations WHERE settlement_id=?', [settlementId])
        if (all.some(row => row.original_expense_line_id !== original.id)) {
          proven = false
          break
        }
        const allAmount = verifiedFinanceSum(all.map(row => row.allocated_amount))
        const legacyAmount = verifiedFinanceSum(activeLinks.filter(link => link.settlementId === settlementId).map(link => link.amount))
        let settlementPaid = 0
        const applications = await tx.select<Row>('SELECT * FROM payment_application_settlement_allocations WHERE settlement_id=?', [settlementId])
        for (const application of applications) {
          const targets = await tx.select<Row>('SELECT * FROM payment_application_settlement_allocations WHERE payment_application_id=?', [application.payment_application_id])
          if (targets.some(row => row.settlement_id !== settlementId)) {
            proven = false
            break
          }
          const cash = await tx.select<{ amount: unknown }>('SELECT a.allocated_amount AS amount FROM payment_record_application_allocations a JOIN payment_records p ON p.id=a.payment_record_id WHERE a.payment_application_id=? AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND p.confirmation_status=\'confirmed\'', [application.payment_application_id])
          settlementPaid += verifiedFinanceSum(cash.map(row => row.amount))
        }
        if (cents(settlementPaid) === cents(allAmount)) {
          paid += legacyAmount
        }
        else if (settlementPaid === 0) {
          paid += 0
        }
        else if (cents(allAmount) === cents(legacyAmount)) {
          paid += settlementPaid
        }
        else {
          proven = false
          break
        }
      }
      if (proven && cents(paid) <= cents(handled)) {
        q.legacyPaidAmount = paid
        q.legacyUnpaidAmount = (cents(handled) - cents(paid)) / 100
      }
    }
  }
  const hasOtherRead = actor.capabilities.includes('other-settlement:read')
  if (!hasOtherRead)
    q = { ...q, state: 'unavailable', message: '当前身份无权核对真实结算占用与旧份额采用关系。', verificationId: null, verifiedHandledAmount: null, confirmedOtherAdoptedAmount: null, verifiedOverlapAmount: null, newAdoptableAmount: null, legacyObligationAmount: null, legacyPaidAmount: null, legacyUnpaidAmount: null }
  const itemAvailability = proof ? proof.items.map(item => ({ verificationId: proof.id, itemId: item.id, amountRemaining: ['verified', 'not-required'].includes(q.state) ? Math.max(0, (cents(item.amount) - cents(verifiedFinanceSum(links.filter(link => link.itemId === item.id).map(link => link.amount)))) / 100) : null })) : []
  return { ...original, clearances: graph.clearances, clearanceSourceHash: graph.hash, clearanceProofs: hasOtherRead ? proofs : [], clearanceLinks: hasOtherRead ? links : [], clearanceItemAvailability: hasOtherRead ? itemAvailability : [], qualification: q }
}
async function proofOriginals(tx: Db, headerId: string, fileIds: string[]) {
  const result = []
  for (const id of fileIds) {
    const row = (await tx.select<Row>('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [id]))[0]
    if (!row || row.owner_type !== 'expense_reimbursement' || row.owner_id !== headerId || row.deleted_at !== null || !(row.content instanceof Uint8Array) || row.content.length !== row.file_size || hashBytes(row.content) !== row.sha256)
      return fail('旧清偿核验须采用本原费用头已保存、字节和摘要可证的原件；其他申请原件或丢失正文不能替代。')
    result.push({ id, ownerType: String(row.owner_type), ownerId: String(row.owner_id), fileName: String(row.file_name), fileSize: Number(row.file_size), sha256: String(row.sha256) })
  }
  return result
}
export async function createExpenseClearanceVerification(tx: TransactionDb, actor: BusinessSession, input: { headerId: string, version: string, commandId: string, occurredAt: string, edit: ExpenseClearanceVerificationEdit }): Promise<ExpenseClearanceProof> {
  if (!actor.capabilities.includes('other-settlement:read'))
    financeFailure('forbidden', '旧份额核定必须能读取真实结算占用，不能仅凭费用读权放行。')
  if (!await hasClearanceTables(tx))
    return fail('此工作区尚未登记旧清偿核定参与者。')
  const original = await baseExpense(tx, input.edit.originalExpenseLineId)
  const source = await readExpenseClearanceSource(tx, actor, original)
  const graph = await sourceGraph(tx, original)
  if (graph.damagedElectronicOriginal)
    return fail('原电子原件已损坏；替代纸单不能抹去原有正文缺失，须先核对真实恢复路径。')
  if (original.headerId !== input.headerId || original.version !== input.edit.sourceVersion || source.clearanceSourceHash !== input.edit.sourceHash)
    financeFailure('conflict', '原费用或旧清偿来源已变化，请保留输入并重新核对。')
  const priorItems = source.clearanceProofs.flatMap(proof => proof.items)
  const latestItems = source.clearanceProofs.at(-1)?.items ?? []
  const sourceIds = new Set<string>()
  const ids = new Set<string>()
  const items = input.edit.items.map((item) => {
    const row = item.sourceClearanceLineId ? source.clearances.find(row => row.id === item.sourceClearanceLineId) : null
    if (item.sourceClearanceLineId && (!row || row.status !== 'confirmed' || row.amount === null || cents(item.amount) !== cents(row.amount)))
      return fail('认定必须明确采用同一原费用的真实已确认旧清偿行，不能按姓名或金额猜关联。')
    const raw = row ? graph.snapshot.clearances.find(line => line.id === row.id) : null
    if (raw && (raw.project_id !== original.projectId || raw.applicant_worker_id !== original.applicantWorkerId || raw.applicant_supplier_id !== original.applicantSupplierId || raw.counterparty_supplier_id !== original.serviceSupplierId))
      return fail('原清偿实际归属、服务方或垫付身份不匹配，不能仅核金额。')
    if (row && sourceIds.has(row.id))
      financeFailure('validation-failed', '同一旧清偿行不能重复核定。')
    if (row)
      sourceIds.add(row.id)
    const previous = item.id ? priorItems.find(old => old.id === item.id) : row ? priorItems.find(old => old.sourceClearanceLineId === row.id) : null
    if (item.id && (!previous || previous.sourceClearanceLineId !== item.sourceClearanceLineId))
      financeFailure('validation-failed', '核定份额稳定身份不属于此原费用，不能更换旧身份。')
    const id = previous?.id ?? randomUUID()
    if (previous && previous.amount !== item.amount)
      financeFailure('conflict', '已核定旧份额的稳定金额与未付义务不能改写；保留原认定及明确更正依据。')
    if (ids.has(id))
      financeFailure('validation-failed', '同一核定份额不能重复。')
    ids.add(id)
    return { id, sourceClearanceLineId: item.sourceClearanceLineId, amount: item.amount, matchBasis: item.matchBasis.trim(), missingOriginalDocument: row ? row.missingOriginalDocument : true }
  })
  if (latestItems.some(item => !ids.has(item.id)))
    financeFailure('conflict', '重核须显式保留已核旧份额的稳定身份，不能删除原未付义务或释放旧采用。')
  if (source.clearances.some(row => row.status === 'confirmed' && !sourceIds.has(row.id)))
    return fail('还有真实已确认旧清偿份额未明确采用，不能漏项释放余额。')
  if (cents(verifiedFinanceSum(items.map(item => item.amount))) > cents(original.amount))
    financeFailure('validation-failed', '核定旧份额不能超过原费用。')
  const proof: ExpenseClearanceProof = { schemaVersion: 'expense-clearance-verification-v1', id: randomUUID(), originalExpenseLineId: original.id, headerId: input.headerId, expenseVersion: input.version, sourceHash: graph.hash, workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: input.commandId, verifiedAt: input.occurredAt, basis: input.edit.basis.trim(), sourceSnapshot: graph.snapshot, items, originals: await proofOriginals(tx, input.headerId, input.edit.fileIds) }
  await tx.execute('INSERT INTO finance_expense_clearance_verifications VALUES(?,?,?,?,?,?,?,?,?)', [proof.id, original.id, input.headerId, Number(input.version), input.commandId, actor.workspaceId, actor.actorId, input.occurredAt, JSON.stringify(proof)])
  for (const binding of input.edit.existingBindings) await appendClearanceLink(tx, actor, { verificationId: proof.id, itemId: items[binding.itemIndex]!.id, amount: binding.amount }, binding.expenseAllocationId, 'finance', input.commandId, input.occurredAt)
  return proof
}
export async function appendClearanceLink(tx: TransactionDb, actor: BusinessSession, input: ExpenseClearanceAllocationInput, allocationId: string, origin: 'finance' | 'other-settlement', commandId: string, createdAt: string): Promise<string> {
  if (!actor.capabilities.includes('other-settlement:read') || !actor.capabilities.includes('other-settlement:write'))
    financeFailure('forbidden', '明确采用旧份额需要真实结算读写权限。')
  const stored = (await tx.select<{ proof_json: string }>('SELECT proof_json FROM finance_expense_clearance_verifications WHERE id=?', [input.verificationId]))[0]
  if (!stored)
    return fail('核定旧份额稳定身份不存在。')
  const proof: unknown = JSON.parse(stored.proof_json)
  if (!isExpenseClearanceProof(proof) || proof.workspaceId !== actor.workspaceId || proof.actorId !== actor.actorId)
    return fail('核定证据不属于当前真实工作区身份。')
  const source = await readExpenseClearanceSource(tx, actor, await baseExpense(tx, proof.originalExpenseLineId))
  if (source.clearanceProofs.at(-1)?.id !== proof.id || source.clearanceSourceHash !== proof.sourceHash)
    return fail('旧清偿核定已失效，不能采用陈旧份额。')
  const item = proof.items.find(item => item.id === input.itemId)
  const allocation = (await tx.select<Row>('SELECT a.*,h.project_id,h.payee_worker_id,h.payee_supplier_id,h.payee_name_snapshot,h.status,h.version AS settlement_version FROM expenditure_settlement_expense_allocations a JOIN expenditure_settlements h ON h.id=a.settlement_id WHERE a.id=?', [allocationId]))[0]
  if (!item || !allocation || allocation.original_expense_line_id !== source.id || allocation.project_id !== source.projectId || allocation.payee_worker_id !== source.applicantWorkerId || allocation.payee_supplier_id !== source.applicantSupplierId)
    return fail('旧份额必须明确绑定同一原费用、归属与收款人的真实结算采用行。')
  const prior = (await tx.select<Row>('SELECT * FROM expenditure_settlement_clearance_links WHERE expense_allocation_id=? AND recognition_item_id=?', [allocationId, input.itemId]))[0]
  if (prior) {
    if (prior.amount !== input.amount)
      financeFailure('conflict', '已冻结旧份额采用关系不能改写金额。')
    return String(prior.id)
  }
  const links = await readClearanceLinks(tx, source.id)
  const itemUsed = verifiedFinanceSum(links.filter(link => link.itemId === input.itemId).map(link => link.amount))
  const allocationUsed = verifiedFinanceSum(links.filter(link => link.expenseAllocationId === allocationId).map(link => link.amount))
  if (cents(itemUsed + input.amount) > cents(item.amount) || typeof allocation.allocated_amount !== 'number' || cents(allocationUsed + input.amount) > cents(allocation.allocated_amount))
    financeFailure('conflict', '旧份额或结算采用行的累计绑定超过两端实际金额。')
  const id = randomUUID()
  const evidence = { id, expenseAllocationId: allocationId, settlementId: String(allocation.settlement_id), originalExpenseLineId: source.id, verificationId: proof.id, itemId: item.id, amount: input.amount, createdAt, actorId: actor.actorId, allocationSnapshot: allocation, proofSha256: financeCommandFingerprint(proof) }
  await tx.execute('INSERT INTO expenditure_settlement_clearance_links VALUES(?,?,?,?,?,?,?,?,?,?,?)', [id, allocationId, proof.id, item.id, input.amount, origin, commandId, actor.workspaceId, actor.actorId, createdAt, JSON.stringify(evidence)])
  await tx.execute('UPDATE other_settlement_revision SET revision=revision+1 WHERE singleton=1')
  return id
}
export async function expenseClearanceVerificationState(tx: Db, actor: BusinessSession, headerId: string): Promise<ExpenseClearanceVerificationState> {
  const rows = await tx.select<{ id: string }>('SELECT id FROM expense_reimbursement_lines WHERE reimbursement_id=? AND original_expense_line_id IS NULL AND deleted_at IS NULL ORDER BY id', [headerId])
  const sources: ExpenseClearanceSourceDTO[] = []
  for (const row of rows) {
    const original = await readVerifiedOriginalExpense(tx, row.id)
    if (original)
      sources.push(await readExpenseClearanceSource(tx, actor, await baseExpense(tx, row.id)))
  }
  const required = sources.filter(source => source.qualification.state !== 'not-required')
  const status = required.some(source => source.qualification.state === 'unavailable') ? 'unavailable' : required.some(source => source.qualification.state === 'stale') ? 'stale' : required.some(source => source.qualification.state === 'missing') ? 'missing' : required.length ? 'verified' : 'not-required'
  return { status, message: required.find(source => source.qualification.state !== 'verified')?.qualification.message ?? '', sources, proofs: sources.flatMap(source => source.clearanceProofs) }
}
export async function validateExpenseClearanceJournal(tx: Db, identity: { workspaceId: string, actorId: string }): Promise<void> {
  if (!await hasClearanceTables(tx)) {
    const commands = await tx.select<Row>('SELECT request_json,result_json FROM finance_commands')
    if (commands.some(row => JSON.parse(String(row.request_json)).draft?.clearanceVerificationEdit || (row.result_json !== null && Object.hasOwn(JSON.parse(String(row.result_json)), 'clearanceVerificationSha256'))))
      return fail('旧结构出现核定回执却没有实际核定事实表。')
    return
  }
  for (const row of await tx.select<Row>('SELECT * FROM finance_expense_clearance_verifications')) {
    const value: unknown = JSON.parse(String(row.proof_json))
    if (!isExpenseClearanceProof(value) || value.id !== row.id || value.originalExpenseLineId !== row.original_expense_line_id || value.headerId !== row.reimbursement_id || value.expenseVersion !== String(row.reimbursement_version) || value.commandId !== row.command_id || value.workspaceId !== identity.workspaceId || value.actorId !== identity.actorId || value.workspaceId !== row.workspace_id || value.actorId !== row.actor_id || value.verifiedAt !== row.verified_at || financeCommandFingerprint(value.sourceSnapshot) !== value.sourceHash)
      return fail('旧清偿核定身份、冻结原源或索引损坏。')
    const command = (await tx.select<Row>('SELECT * FROM finance_commands WHERE command_id=?', [value.commandId]))[0]
    if (!command || command.workspace_id !== identity.workspaceId || command.actor_id !== identity.actorId)
      return fail('旧清偿核定缺少真实原命令。')
    const request = parseFinanceCommand(JSON.parse(String(command.request_json)))
    const result = JSON.parse(String(command.result_json))
    if (request.kind !== 'reimbursement' || request.commandId !== value.commandId || request.workspaceId !== identity.workspaceId || request.actorId !== identity.actorId || command.fingerprint !== financeCommandFingerprint(request) || request.id !== value.headerId || !('clearanceVerificationEdit' in request.draft) || !request.draft.clearanceVerificationEdit || result.clearanceVerificationSha256 !== financeCommandFingerprint(value))
      return fail('旧清偿核定与原请求回执不一致。')
    const edit = request.draft.clearanceVerificationEdit as ExpenseClearanceVerificationEdit
    if (edit.originalExpenseLineId !== value.originalExpenseLineId || edit.sourceVersion !== request.baseVersion || edit.sourceHash !== value.sourceHash || edit.basis.trim() !== value.basis || Number(request.baseVersion) + 1 !== Number(value.expenseVersion) || edit.items.length !== value.items.length || financeCanonical([...edit.fileIds].sort()) !== financeCanonical(value.originals.map(file => file.id).sort()) || result.clearanceVerificationId !== value.id)
      return fail('旧清偿核定金额、原源版本、依据或所选原件与原请求不一致。')
    const snapshot = value.sourceSnapshot as { originalRow: Row, head: Row, originalFiles: Row[], clearances: Row[], clearanceHeads: Record<string, Row>, clearanceVersions: Record<string, number>, clearanceFiles: Record<string, Row[]>, clearanceDeclaredOriginals: Record<string, Row[]> }
    const history = (await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'reimbursement\' AND id=? AND version=?', [value.headerId, Number(value.expenseVersion)]))[0]
    const frozenExpense = history ? JSON.parse(history.snapshot_json) : null
    if (!snapshot || !frozenExpense || snapshot.originalRow?.id !== value.originalExpenseLineId || snapshot.originalRow?.reimbursement_id !== value.headerId || snapshot.originalRow?.original_expense_line_id !== null || snapshot.head?.id !== value.headerId || snapshot.head?.status !== 'confirmed' || financeCanonical(snapshot.head) !== financeCanonical(frozenExpense.head) || !frozenExpense.relations.expense_reimbursement_lines.some((line: Row) => financeCanonical(line) === financeCanonical(snapshot.originalRow)))
      return fail('旧清偿核定的原费用快照与实际owner冻结历史不一致。')
    const normalizeFiles = (files: Row[]) => files.map(({ byteSha256: _bytes, bodyState: _body, ...file }) => file)
    if (!Array.isArray(snapshot.originalFiles) || financeCanonical(normalizeFiles(snapshot.originalFiles)) !== financeCanonical(frozenExpense.files))
      return fail('核定原费用原件状态与真实冻结owner历史不一致。')
    const selected = new Set<string>()
    for (const [index, item] of value.items.entries()) {
      const input = edit.items[index]!
      if (item.sourceClearanceLineId !== input.sourceClearanceLineId || item.amount !== input.amount || item.matchBasis !== input.matchBasis.trim() || (input.id !== undefined && input.id !== item.id))
        return fail('认定份额与人工明确选择的原提交不一致。')
      if (item.sourceClearanceLineId) {
        const source = snapshot.clearances.find(line => line.id === item.sourceClearanceLineId)
        if (!source || source.original_expense_line_id !== value.originalExpenseLineId || source.head_status !== 'confirmed' || source.amount !== item.amount || selected.has(item.sourceClearanceLineId))
          return fail('认定旧清偿源遗漏、重复或金额不符。')
        selected.add(item.sourceClearanceLineId)
        const key = String(source.reimbursement_id)
        const actualHistory = (await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'reimbursement\' AND id=? AND version=?', [key, snapshot.clearanceVersions[key]]))[0]
        const actual = actualHistory ? JSON.parse(actualHistory.snapshot_json) : null
        const actualLine: Row | undefined = actual?.relations?.expense_reimbursement_lines?.find((line: Row) => line.id === source.id)
        const expected = actualLine && actual ? { ...actualLine, head_status: actual.head.status, head_deleted_at: actual.head.deleted_at, applicant_worker_id: actual.head.applicant_worker_id, applicant_supplier_id: actual.head.applicant_supplier_id, applicant_name_snapshot: actual.head.applicant_name_snapshot, project_id: actual.head.project_id, head_updated_at: actual.head.updated_at } : null
        if (!actual || financeCanonical(source) !== financeCanonical(expected) || financeCanonical(snapshot.clearanceHeads[key]) !== financeCanonical(actual.head) || financeCanonical(normalizeFiles(snapshot.clearanceFiles[key] ?? [])) !== financeCanonical(actual.files))
          return fail('旧清偿行、版本或原件状态不能由真实冻结owner历史证明。')
        const declared = await declaredMissingClearanceOriginals(tx, key)
        if (financeCanonical(snapshot.clearanceDeclaredOriginals[key] ?? []) !== financeCanonical(declared.map(file => ({ id: file.id, row: file.row, reason: file.reason, sourceBytesSha256: file.sourceBytesSha256 }))))
          return fail('核定原清偿缺件状态不能由精确受控迁入证据证明。')
        const missing = actual.files.length === 0 || declared.length > 0 || snapshot.clearanceFiles[key]?.some(file => file.bodyState !== 'readable')
        if (item.missingOriginalDocument !== missing)
          return fail('核定不能改写原清偿原件缺失状态。')
      }
      else if (!item.missingOriginalDocument) {
        return fail('缺少原清偿记录时不能伪装原纸单已找回。')
      }
    }
    if (snapshot.clearances.some(line => line.head_status === 'confirmed' && !selected.has(String(line.id))) || cents(verifiedFinanceSum(value.items.map(item => item.amount))) > cents(Number(snapshot.originalRow.amount)))
      return fail('核定遗漏已确认旧份额或超过原费用上限。')
    for (const file of value.originals) {
      const current = (await tx.select<Row>('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [file.id]))[0]
      if (!current || current.owner_type !== file.ownerType || current.owner_id !== file.ownerId || current.file_name !== file.fileName || current.file_size !== file.fileSize || current.sha256 !== file.sha256 || !(current.content instanceof Uint8Array) || current.content.length !== file.fileSize || hashBytes(current.content) !== file.sha256)
        return fail('旧清偿核定原件身份、字节或摘要损坏。')
    }
  }
  for (const command of await tx.select<Row>('SELECT * FROM finance_commands WHERE result_json IS NOT NULL')) {
    const result = JSON.parse(String(command.result_json))
    if (Object.hasOwn(result, 'clearanceVerificationSha256')) {
      const rows = await tx.select<Row>('SELECT * FROM finance_expense_clearance_verifications WHERE command_id=?', [command.command_id])
      if (rows.length !== 1 || rows[0]?.id !== result.clearanceVerificationId)
        return fail('核定成功回执缺少实际不可变核定事实。')
    }
  }
  const links = await tx.select<Row>('SELECT * FROM expenditure_settlement_clearance_links')
  for (const row of links) {
    const frozen = JSON.parse(String(row.link_json))
    const stored = (await tx.select<Row>('SELECT * FROM finance_expense_clearance_verifications WHERE id=?', [row.verification_id]))[0]
    const proof: unknown = stored ? JSON.parse(String(stored.proof_json)) : null
    const allocation = (await tx.select<Row>('SELECT * FROM expenditure_settlement_expense_allocations WHERE id=?', [row.expense_allocation_id]))[0]
    if (!isExpenseClearanceProof(proof) || !allocation || row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId || frozen.id !== row.id || frozen.expenseAllocationId !== row.expense_allocation_id || frozen.verificationId !== row.verification_id || frozen.itemId !== row.recognition_item_id || frozen.amount !== row.amount || frozen.actorId !== row.actor_id || frozen.createdAt !== row.created_at || frozen.originalExpenseLineId !== allocation.original_expense_line_id || allocation.original_expense_line_id !== proof.originalExpenseLineId || frozen.proofSha256 !== financeCommandFingerprint(proof))
      return fail('旧份额采用关系、身份或两端冻结证据损坏。')
    const item = proof.items.find(item => item.id === row.recognition_item_id)
    if (!item || cents(verifiedFinanceSum(links.filter(link => link.recognition_item_id === row.recognition_item_id).map(link => link.amount))) > cents(item.amount) || cents(verifiedFinanceSum(links.filter(link => link.expense_allocation_id === row.expense_allocation_id).map(link => link.amount))) > cents(Number(allocation.allocated_amount)))
      return fail('旧份额采用关系累计超过真实两端额度。')
    const table = row.origin_family === 'finance' ? 'finance_commands' : 'other_settlement_commands'
    const commands = await tx.select<Row>(`SELECT * FROM ${table} WHERE command_id=? AND workspace_id=? AND actor_id=?`, [row.command_id, identity.workspaceId, identity.actorId])
    if (commands.length !== 1)
      return fail('旧份额采用关系缺少原命令与真实身份。')
    const request = JSON.parse(String(commands[0]!.request_json))
    const response = JSON.parse(String(commands[0]!.result_json))
    if (row.origin_family === 'finance') {
      const actual = parseFinanceCommand(request)
      if (commands[0]!.fingerprint !== financeCommandFingerprint(actual) || actual.workspaceId !== identity.workspaceId || actual.actorId !== identity.actorId)
        return fail('旧份额Finance采用的原命令身份或指纹损坏。')
      const edit = request.draft.clearanceVerificationEdit as ExpenseClearanceVerificationEdit | undefined
      if (!edit || proof.commandId !== row.command_id || !edit.existingBindings.some(binding => binding.expenseAllocationId === row.expense_allocation_id && proof.items[binding.itemIndex]?.id === row.recognition_item_id && binding.amount === row.amount))
        return fail('原费用核定的关系不是原提交人工明确选择。')
    }
    else {
      const actual = decodeOtherSettlementCommand(request)
      if (commands[0]!.fingerprint !== otherSettlementFingerprint(actual) || commands[0]!.scoped_id !== otherSettlementKey(actual.commandId, actual))
        return fail('旧份额Other采用的原命令身份或指纹损坏。')
      const bindings = request.draft.clearanceLinkEdit?.bindings ?? request.draft.originalExpenses?.find((line: Row) => line.originalExpenseLineId === proof.originalExpenseLineId)?.clearanceAllocations
      if (!Array.isArray(bindings) || !bindings.some((binding: Row) => binding.itemId === row.recognition_item_id && binding.amount === row.amount && (request.draft.clearanceLinkEdit ? binding.expenseAllocationId === row.expense_allocation_id && request.draft.clearanceLinkEdit.verificationId === row.verification_id : binding.verificationId === row.verification_id)) || !response.clearanceLinkIds?.includes(row.id))
        return fail('旧份额采用与结算原命令及成功回执不一致。')
    }
    const endpoint = frozen.allocationSnapshot
    if (!endpoint || endpoint.id !== allocation.id || endpoint.settlement_id !== allocation.settlement_id || endpoint.original_expense_line_id !== allocation.original_expense_line_id || frozen.settlementId !== allocation.settlement_id)
      return fail('旧份额采用两端稳定身份不一致。')
    const head = (await tx.select<Row>('SELECT * FROM expenditure_settlements WHERE id=?', [allocation.settlement_id]))[0]
    if (!head || head.project_id !== endpoint.project_id || head.payee_supplier_id !== endpoint.payee_supplier_id || head.payee_worker_id !== endpoint.payee_worker_id || head.payee_name_snapshot !== endpoint.payee_name_snapshot)
      return fail('旧份额采用冻结收款身份或归属被改换。')
    if (Number(endpoint.settlement_version) > 0) {
      const history = (await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM other_settlement_history WHERE settlement_id=? AND version=?', [head.id, endpoint.settlement_version]))[0]
      const historical = history ? JSON.parse(history.snapshot_json) : null
      const originalInput = historical?.draft.originalExpenses?.find((line: Row) => line.originalExpenseLineId === allocation.original_expense_line_id)
      if (!originalInput || originalInput.amount !== endpoint.allocated_amount || originalInput.sourceVersion !== endpoint.source_version || originalInput.sourceRevision !== endpoint.source_revision)
        return fail('旧份额采用的原端金额与实际结算冻结历史不一致。')
    }
  }
  for (const command of await tx.select<Row>('SELECT * FROM other_settlement_commands')) {
    const request = JSON.parse(String(command.request_json))
    const response = JSON.parse(String(command.result_json))
    const ids = response.clearanceLinkIds ?? []
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id: unknown) => typeof id !== 'string' || !links.some(row => row.id === id)))
      return fail('结算成功回执缺少实际旧份额采用关系。')
    const bindings = request.draft.clearanceLinkEdit?.bindings ?? request.draft.originalExpenses?.flatMap((line: Row) => Array.isArray(line.clearanceAllocations) ? line.clearanceAllocations.map(binding => ({ ...binding, originalExpenseLineId: line.originalExpenseLineId })) : []) ?? []
    if (ids.length !== bindings.length || bindings.some((binding: Row) => !ids.some((id: string) => {
      const row = links.find(row => row.id === id)!
      if (row.recognition_item_id !== binding.itemId || row.amount !== binding.amount)
        return false
      const allocation = JSON.parse(String(row.link_json))
      return allocation.settlementId === response.id && (request.draft.clearanceLinkEdit ? binding.expenseAllocationId === row.expense_allocation_id : binding.originalExpenseLineId === allocation.originalExpenseLineId)
    }))) {
      return fail('结算旧份额采用原提交、目标与回执不一致。')
    }
  }
}
