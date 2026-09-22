import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAContext, PayrollAFormRead, PayrollAQuantityFacts } from '../../app/lib/payroll/central-a-contract'
import type { PayrollABookRef, PayrollAFeeConfigRead, PayrollAFeeConfigScope, PayrollAFeesFormRead, PayrollAFeesSourceSnapshot, PayrollAManagementOwnership, PayrollAStatementSourceSnapshotV2 } from '../../app/lib/payroll/central-a-fees-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import type { PayrollIdentitySource, PayrollServiceOptions } from './payroll-service'
import { createHash } from 'node:crypto'
import { payrollAAmount, payrollACanonical, payrollAMoney } from '../../app/lib/payroll/central-a-calculation'
import { payrollAFeeAdjustmentBasis } from '../../app/lib/payroll/central-a-fee-adjustment'
import { payrollAFeeLines, payrollAFeeTotal } from '../../app/lib/payroll/central-a-fees-calculation'
import { hasPayrollAFeesDocument } from '../../app/lib/payroll/central-a-fees-contract'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { loadPayrollAAdjustmentReconciliation } from './payroll-a-adjustment-reconciliation'
import { loadPayrollABookPayments, samePayrollABook } from './payroll-a-book'
import { currentPayrollANegativeLines, effectivePayrollARevision, loadPayrollAFeeRevisions, loadPayrollAManagementBooks, loadPayrollAManagementRevisions, loadPayrollANegativeLines } from './payroll-a-fees-data'
import { latestPayrollABookRelease, payrollAFeesHistory, payrollAManagementScopeCurrent } from './payroll-a-fees-policy'
import { loadPayrollAOptions, payrollANavigation } from './payroll-a-options'
import { loadPayrollAReleasedWithMigration } from './payroll-a-released-with-migration'
import { loadPayrollMigratedFees } from './payroll-migrated-fees'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

export const payrollAFeesHash = (v: unknown) => createHash('sha256').update(payrollACanonical(v)).digest('hex')
export async function readPayrollAFeeConfig(db: TransactionDb, context: PayrollAContext, source: PayrollIdentitySource, scope: PayrollAFeeConfigScope, all: PayrollAQuantityFacts, options: PayrollServiceOptions): Promise<PayrollAFeeConfigRead> {
  if (!source.projects.some(p => p.id === scope.projectId))
    throw payrollProblem('not-found', '费用配置项目不存在或不可用')
  const fees = (await loadPayrollAFeeRevisions(db, scope.projectId)).filter(f => f.leaderWorkerId === scope.leaderWorkerId && samePayrollABook(f, scope.book))
  const books = await loadPayrollAManagementBooks(db, scope.projectId)
  const revisions = await loadPayrollAManagementRevisions(db, scope.projectId)
  const ownedScope = await options.managementScopeFacts?.(db, { projectId: scope.projectId }, { ...context, readonly: true })
  const managementBooks = books.map((book) => {
    const revision = effectivePayrollARevision(revisions.filter(r => r.managementBookId === book.id), scope.month)
    const manager = source.workers.find(w => w.id === book.managerWorkerId)
    const reasons = [book.deletedAt !== null ? '管理簿已归档' : '', revision?.managementMode !== 'crew-managed' ? '所选范围由公司代管或尚未配置' : '', !manager ? '管理人不可用' : '', !revision || !ownedScope || ownedScope.reasons.length || !payrollAManagementScopeCurrent(revision.scope, ownedScope.responsibilityOptions) ? '原管理责任范围当前无法核实' : ''].filter(Boolean)
    return { book, revision, managerName: manager?.name ?? null, eligible: reasons.length === 0, reasons }
  })
  const cells = [...new Map(all.rows.map(f => [payrollACanonical([f.unitId, f.roomId, f.itemId]), { unitId: f.unitId, roomId: f.roomId, itemId: f.itemId, locationLabel: [f.buildingName, f.floorName, f.unitName, f.roomName, f.itemName].filter(Boolean).join(' · ') }])).values()]
  const memberOptions = await loadPayrollAOptions(db, source, context, scope.projectId, all.rows)
  const readonlyReasons = !context.capabilities.includes('payroll:write') ? ['当前身份只能阅读费用配置'] : []
  const lastReleased = await latestPayrollABookRelease(db, scope.projectId, scope.leaderWorkerId, scope.book)
  const feeReasons = [...readonlyReasons, ...(lastReleased && scope.month <= lastReleased ? ['该簿已有已发工资，费用改动请选择后续未发月份'] : [])]
  const managementReasons = [...readonlyReasons, ...(!ownedScope || ownedScope.reasons.length ? ['原管理责任范围当前无法核实'] : [])]
  const eligibility = { canSaveFees: !feeReasons.length, canSaveManagementBook: !managementReasons.length, canStartManagementDraft: !managementReasons.length, feeReasons, managementReasons }
  const crewDefaults = source.crews.find(c => c.id === scope.crewId)?.feeDefaults ?? null
  const baseVersion = `${context.sourceVersion}+fees:${payrollAFeesHash({ scope, fees, books, revisions, all, ownedScope, crewDefaults })}`
  const itemRows = await db.select<{ id: string, name: string | null, unit: string | null }>('SELECT id,name,unit FROM items WHERE project_id=? AND deleted_at IS NULL', [scope.projectId])
  const allowedItemIds = new Set([...all.rows.map(f => f.itemId), ...(ownedScope?.cellOptions ?? []).map(c => c.itemId)])
  return { context: { ...context, readonly: readonlyReasons.length > 0, sourceVersion: baseVersion }, scope, baseVersion, options: memberOptions, crewDefaults, fees, managementBooks, cellOptions: ownedScope?.cellOptions ?? cells, items: itemRows.filter(i => allowedItemIds.has(i.id)).map(i => ({ itemId: i.id, itemName: i.name, unit: i.unit, housingClassification: { state: 'missing' as const }, sourceVersion: ownedScope?.sourceVersion ?? all.sourceVersion, scopes: [{ kind: 'project' as const }] })), responsibilityOptions: ownedScope?.responsibilityOptions ?? [], blockers: [], readonlyReasons, eligibility, history: await payrollAFeesHistory(db, new Set([...fees.map(f => f.id), ...books.map(b => b.id), ...revisions.map(r => r.id)])) }
}

export async function payrollAFeesSelection(db: TransactionDb, projectId: string, month: string, book: PayrollABookRef) {
  const management = book.bookPurpose === 'management' ? (await loadPayrollAManagementBooks(db, projectId)).find(b => b.id === book.managementBookId) : null
  const revision = management ? effectivePayrollARevision((await loadPayrollAManagementRevisions(db, projectId)).filter(r => r.managementBookId === management.id), month) : null
  return management && revision ? { book: management, revision } : null
}

export async function extendPayrollAFeesForm(db: TransactionDb, read: PayrollAFormRead, source: PayrollIdentitySource, all: PayrollAQuantityFacts, options: PayrollServiceOptions): Promise<PayrollAFeesFormRead> {
  const incomplete = [
    ...(!source.projects.some(p => p.id === read.draft.projectId) ? ['请选择有效的工资项目'] : []),
    ...(!read.draft.leaderWorkerId ? ['请先选择工资负责人'] : []),
    ...(!read.draft.month ? ['请先选择工资月份'] : []),
  ]
  if (incomplete.length) {
    // 尚未选全主体或月份时保留原稿及未知费用依据，不把未选择身份送入 SQL 或原件核验。
    const reasons = [...new Set([...incomplete, ...read.blockers.map(b => b.message)])]
    const unknown = () => payrollAAmount([null], reasons)
    return {
      ...read,
      book: null,
      bookProof: { state: 'unproven', book: null, reasons },
      bookEligibility: { canSave: false, canCheck: false, canRelease: false, reasons },
      managementBooks: [],
      negativeLineDrafts: [],
      negativeLineRevisions: [],
      previousBookPayments: [],
      fees: null,
      totals: { workAmount: unknown(), subsidyAmount: unknown(), managementAmount: unknown(), negativeAmount: unknown(), listAmount: unknown(), cumulativeAmount: unknown(), previouslyPaid: unknown(), grossAmount: unknown() },
      blockers: read.blockers.map(b => ({ ...b, feeId: null, managementBookId: null, negativeLineId: null })),
      eligibility: { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: false, reasons },
    }
  }
  const book = read.draft.book!
  const config = await readPayrollAFeeConfig(db, read.context, source, { projectId: read.draft.projectId!, month: read.draft.month!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId ?? null, book }, all, options)
  const management = await payrollAFeesSelection(db, read.draft.projectId!, read.draft.month!, book)
  const negativeHistory = book.bookPurpose === 'management' ? await db.select<{ statement_id: string }>('SELECT b.statement_id FROM payroll_a_statement_books b JOIN wage_statements w ON w.id=b.statement_id WHERE b.management_book_id=? AND w.status=\'released\' AND w.id<>? AND w.month<=? ORDER BY w.month,w.id', [book.managementBookId, read.statementId ?? '', read.draft.month]) : []
  const negativeLineRevisions = read.statementId ? await loadPayrollANegativeLines(db, read.statementId) : []
  const historicalNegativeLines: PayrollAFeesSourceSnapshot['negativeLines'] = []
  const unavailableNegativeHistory: string[] = []
  for (const head of negativeHistory) {
    const document = (await loadPayrollAReleasedWithMigration(db, head.statement_id)).get(head.statement_id) ?? (await loadPayrollMigratedProof(db, read.draft.projectId!)).aDocuments.get(head.statement_id)
    if (!document || !hasPayrollAFeesDocument(document) || !samePayrollABook(document.book, book))
      unavailableNegativeHistory.push(head.statement_id)
    else historicalNegativeLines.push(...document.fees.negativeLines.filter(n => n.statementId === head.statement_id))
  }
  const negativeLines = currentPayrollANegativeLines([...historicalNegativeLines, ...negativeLineRevisions])
  const lines = payrollAFeeLines(read.facts, config.fees, read.draft.month!)
  for (const line of lines) {
    const sources = line.components.map(({ fact }) => payrollANavigation(read.context, read.draft.projectId!, 'quantity-unit', fact.unitId, [fact.buildingName, fact.floorName, fact.unitName, fact.roomName, fact.itemName].filter(Boolean).join(' · ') || '原施工户', { stageId: fact.stageId, itemId: fact.itemId, completionId: fact.completionId })).filter((s): s is NavigationIntentDTO => s !== null)
    line.sources = [...new Map(sources.map(s => [payrollACanonical(s), s])).values()]
  }
  const blocks: PayrollAFeesFormRead['blockers'] = read.blockers.map(b => ({ ...b, feeId: null, managementBookId: null, negativeLineId: null }))
  const add = (code: string, message: string) => blocks.push({ code, message, locationLabel: null, sourceUnavailableReason: null, field: null, completionId: null, assignmentId: null, unitId: null, roomId: null, itemId: null, workerId: null, statementId: read.statementId, source: null, feeId: null, managementBookId: book.managementBookId, negativeLineId: null })
  if (unavailableNegativeHistory.length)
    add('negative-history-unproven', '原管理单的负价完整集合或发放证明缺损，不能按零或当前追加行继续累计')
  if (config.fees.some(f => f.crewId !== (read.draft.crewId ?? null) || f.leaderWorkerId !== read.draft.leaderWorkerId))
    add('fee-subject-mismatch', '费用修订与当前请款主体班组不一致，不能继续核对发放')
  if (book.bookPurpose === 'management' && (!management || !config.managementBooks.find(b => b.book.id === book.managementBookId)?.eligible))
    add('management-unavailable', '管理范围、方式或管理人已变化，不能继续核对发放')
  for (const line of lines) {
    for (const reason of line.amount.reasons) add('fee-basis-incomplete', reason)
  }
  const subsidyAmount = payrollAFeeTotal(lines.filter(l => l.kind !== 'management').map(l => l.amount))
  const managementAmount = payrollAFeeTotal(lines.filter(l => l.kind === 'management').map(l => l.amount))
  const negativeAmount = payrollAAmount([...negativeLines.map(l => l.signedAmountFen === null ? null : l.signedAmountFen / 100), ...unavailableNegativeHistory.map(() => null)], unavailableNegativeHistory.length ? ['原管理单负价集合未获证明'] : [])
  const workAmount = book.bookPurpose === 'management' ? payrollAAmount([]) : read.totals.workAmount
  const listAmount = payrollAFeeTotal([workAmount, subsidyAmount, managementAmount, negativeAmount])
  const cumulativeAmount = payrollAAmount([listAmount.value === null || read.draft.payRatio == null ? null : payrollAMoney(listAmount.value * read.draft.payRatio)])
  const previouslyPaid = read.totals.previouslyPaid
  const grossAmount = payrollAAmount([cumulativeAmount.value === null || previouslyPaid.value === null ? null : Math.max(0, payrollAMoney(cumulativeAmount.value - previouslyPaid.value))])
  const totals = { workAmount, subsidyAmount, managementAmount, negativeAmount, listAmount, cumulativeAmount, previouslyPaid, grossAmount }
  const ownershipRows = await db.select<Record<string, unknown>>('SELECT * FROM payroll_a_management_ownership WHERE project_id=?', [read.draft.projectId])
  const allOwnership: PayrollAManagementOwnership[] = ownershipRows.map(r => ({ id: String(r.id), projectId: String(r.project_id), ownershipKey: String(r.ownership_key), managementBookId: String(r.management_book_id), firstStatementId: String(r.first_statement_id), proof: JSON.parse(String(r.proof_json)) }))
  const mappedFees = await loadPayrollMigratedFees(db, read.draft.projectId!)
  for (let i = 0; i < allOwnership.length; i++) {
    const id = allOwnership[i]!.id
    if (mappedFees.unavailableIds.has(id))
      throw payrollProblem('unavailable', '原管理领取归属的迁入身份无法核实')
    allOwnership[i] = mappedFees.managementOwnership.get(id) ?? allOwnership[i]!
  }
  const managementOwnership = allOwnership.filter(o => lines.some(l => l.kind === 'management' && l.components.some(c => c.ownershipKey === o.ownershipKey)))
  if (managementOwnership.some(o => o.managementBookId !== book.managementBookId))
    add('management-already-owned', '原施工责任已有其他管理簿领取，换管理人或重建单据不能再次领取')
  const fees: PayrollAFeesSourceSnapshot = { schemaVersion: 1, configSourceVersion: payrollAFeesHash({ revisions: config.fees, management, crewDefaults: config.crewDefaults }), crewDefaults: config.crewDefaults, feeRevisions: config.fees, management, managementOwnership, negativeLines, lines, totals }
  const payments = await loadPayrollABookPayments(db, { projectId: read.draft.projectId!, leaderWorkerId: read.draft.leaderWorkerId!, book }, read.statementId)
  const rawSource: PayrollAStatementSourceSnapshotV2 = { schemaVersion: 2, subject: { projectId: read.draft.projectId!, crewId: read.draft.crewId ?? null, leaderWorkerId: read.draft.leaderWorkerId!, memberWorkerIds: read.draft.memberWorkerIds! }, facts: read.facts, priceRevisions: read.prices.filter(p => read.lines.some(l => l.priceRevisionIds.includes(p.id))), book, fees: structuredClone(fees) }
  const reconciliation = await loadPayrollAAdjustmentReconciliation(db, { formatFamily: 'A', periodKind: read.draft.periodKind ?? 'monthly', payRatio: read.draft.payRatio ?? null, source: rawSource, components: read.lines.flatMap(line => line.facts.map(fact => ({ ownershipKey: fact.ownershipKey, priceRevisionId: line.priceRevisionIds[0] ?? '', quantity: fact.fieldQty, unitPrice: line.unitPrice }))), fees: payrollAFeeAdjustmentBasis(rawSource) }, payments.map(p => String(p.id)), read.statementId)
  if (reconciliation) {
    totals.grossAmount = reconciliation.availableAmount
    for (const reason of reconciliation.reasons) add('adjustment-source-unproven', reason)
  }
  const context = { ...read.context, sourceVersion: `${read.context.sourceVersion}+fees-form:${payrollAFeesHash({ fees, reconciliation })}` }
  const writable = !context.readonly && blocks.length === 0
  return { ...read, ...(reconciliation ? { adjustmentReconciliation: reconciliation, paymentSourceVersion: payrollAFeesHash({ payments, reconciliation }) } : {}), context, book, bookProof: { state: 'proven', book, sourceVersion: context.sourceVersion }, bookEligibility: { canSave: writable, canCheck: writable, canRelease: writable, reasons: blocks.map(b => b.message) }, managementBooks: config.managementBooks, negativeLineRevisions, negativeLineDrafts: read.status === 'released' ? [] : negativeLines.filter(n => n.statementId === read.statementId).map(({ lineId, id, label, quantity, unit, unitPrice, scope, reason, evidenceNote, actualRef }) => ({ lineId, baseRevisionId: id, label, quantity, unit, unitPrice, scope, reason, evidenceNote, actualRef })), previousBookPayments: payments.map(p => ({ statementId: String(p.id), month: String(p.month), book, amount: payrollAAmount([typeof p.actual_amount === 'number' ? p.actual_amount : null]), actualRefs: [{ kind: 'released-statement', statementId: String(p.id) }], sourceVersion: read.paymentSourceVersion })), fees, totals, blockers: blocks, eligibility: { ...read.eligibility, canSaveDraft: writable && ['new', 'draft'].includes(read.status), canCheck: writable && ['draft', 'checked'].includes(read.status), canRelease: writable && read.status === 'checked' && !read.needsRecheck && totals.grossAmount.value !== null && totals.grossAmount.value > 0, reasons: blocks.map(b => b.message) } }
}
