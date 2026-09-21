import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAFormRead } from '../../app/lib/payroll/central-a-contract'
import type { PayrollIdentitySource, PayrollServiceOptions } from './payroll-service'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { payrollHollowAllowsZeroRelease } from '../../app/lib/payroll/central-hollow-deduction-release'
import { readPayrollHollowInTransaction } from './payroll-hollow-read'

export async function extendPayrollAHollowForm<T extends PayrollAFormRead>(db: TransactionDb, read: T, source: PayrollIdentitySource, options: PayrollServiceOptions): Promise<T> {
  if (!options.hollowFacts)
    return read
  const draft = read.draft
  const hollow = await readPayrollHollowInTransaction(db, read.context, source, {
    target: read.statementId ? { statementId: read.statementId, draftKey: null } : { statementId: null, draftKey: read.draftKey! },
    scope: draft.projectId && draft.leaderWorkerId && draft.book ? { formatFamily: 'A', projectId: draft.projectId, crewId: draft.crewId ?? null, leaderWorkerId: draft.leaderWorkerId, book: draft.book } : null,
    month: draft.month || null,
    memberWorkerIds: draft.memberWorkerIds ?? [],
    ...(draft.book?.bookPurpose === 'management' ? { managementOwnershipKeys: read.facts.map(fact => fact.ownershipKey) } : {}),
    claimSubtotal: read.totals.grossAmount,
    status: read.status,
  }, options)
  const blockers = [...read.blockers, ...hollow.reasons.map(message => ({ code: 'hollow-unproven', message, locationLabel: null, sourceUnavailableReason: null, field: null, completionId: null, assignmentId: null, unitId: null, roomId: null, itemId: null, workerId: null, statementId: read.statementId, source: null, ...(hasPayrollAFeesForm(read) ? { feeId: null, managementBookId: null, negativeLineId: null } : {}) }))]
  const valid = hollow.state === 'available' && !blockers.length
  return { ...read, hollow, context: hollow.context, totals: { ...read.totals, grossAmount: hollow.totals.grossAmount }, blockers, eligibility: { ...read.eligibility, canSaveDraft: read.eligibility.canSaveDraft && valid, canCheck: read.eligibility.canCheck && valid, canRelease: read.eligibility.canRelease && valid && hollow.totals.grossAmount.value !== null && (hollow.totals.grossAmount.value > 0 || payrollHollowAllowsZeroRelease(hollow.snapshot)), reasons: blockers.map(blocker => blocker.message) } }
}
