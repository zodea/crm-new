import type { PayrollAContext } from '../../app/lib/payroll/central-a-contract'
import type { PayrollAFeesFormRead, PayrollAFeesFrozenDocument, PayrollAStatementSourceSnapshotV2 } from '../../app/lib/payroll/central-a-fees-contract'

/** 输入只来自完整原件证明；当前施工、费用修订与名册不能重算已发清单。 */
export function payrollAFeesFrozenForm(base: PayrollAContext, document: PayrollAFeesFrozenDocument, source: PayrollAStatementSourceSnapshotV2): PayrollAFeesFormRead {
  const reasons = ['已发工资只能阅读当时冻结事实']
  const members = document.members.map(m => ({ id: m.workerId, name: m.workerName, crewId: source.subject.crewId, eligible: false, historical: true, reasons, source: null }))
  return {
    context: { ...base, readonly: !base.capabilities.includes('payroll:write') },
    statementId: document.id,
    draftKey: null,
    status: 'released',
    needsRecheck: false,
    draft: { ...source.subject, book: source.book, month: document.month, periodKind: document.periodKind, payRatio: document.payRatio, note: document.note },
    options: { projects: [{ id: document.projectId, name: document.projectName, code: '' }], crews: source.subject.crewId ? [{ id: source.subject.crewId, name: document.crewName, eligible: false, reasons }] : [], workers: members },
    members,
    facts: source.facts,
    lines: document.lines,
    prices: source.priceRevisions,
    ratioDefault: { value: null, source: 'missing', statementId: null, configId: null, sourceVersion: null },
    paymentSourceVersion: base.sourceVersion,
    ...(document.adjustmentReconciliation ? { adjustmentReconciliation: document.adjustmentReconciliation } : {}),
    book: document.book,
    bookProof: { state: 'proven', book: document.book, sourceVersion: base.sourceVersion },
    bookEligibility: { canSave: false, canCheck: false, canRelease: false, reasons },
    managementBooks: [],
    negativeLineDrafts: [],
    negativeLineRevisions: source.fees.negativeLines.filter(n => n.statementId === document.id),
    previousBookPayments: document.previousBookPayments.map(p => ({ ...p, amount: { state: 'known', value: p.amount, knownValue: p.amount, reasons: [] }, actualRefs: [{ kind: 'released-statement', statementId: p.statementId }], sourceVersion: base.sourceVersion })),
    fees: document.fees,
    totals: document.fees.totals,
    blockers: [],
    eligibility: { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: true, reasons },
  }
}
