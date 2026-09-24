import type { PayrollHollowSnapshot } from './central-hollow-deduction-contract'
import { payrollCanonical } from './central-command-shared'
import { isPayrollHollowSnapshot } from './central-hollow-deduction-snapshot'
import { amountInCents } from './statements'

interface Subject { projectId: string, crewId: string | null, leaderWorkerId: string, memberWorkerIds: string[] }
interface Document { id: string, projectId: string, crewId: string | null, formatFamily: 'C1' | 'C2', month: string, grossAmount: number, operatorName: string, members: Array<{ workerId: string, isLeader: boolean }>, hollow?: PayrollHollowSnapshot }

/** C格式保留本月原明细合计，空鼓只在该合计之后一次扣除。 */
export function isPayrollCHollowSource(hollow: unknown, family: 'C1' | 'C2', subject: Subject, month: string): hollow is PayrollHollowSnapshot {
  return isPayrollHollowSnapshot(hollow) && hollow.scope.formatFamily === family && hollow.scope.book === null
    && hollow.scope.projectId === subject.projectId && hollow.scope.crewId === subject.crewId && hollow.scope.leaderWorkerId === subject.leaderWorkerId && hollow.month === month
    && hollow.facts.every(fact => fact.originalParty.kind === 'worker' ? subject.memberWorkerIds.includes(fact.originalParty.workerId) : fact.originalParty.crewId === subject.crewId)
}

export function isPayrollCHollowDocument(document: Document, subtotalFen: number): boolean {
  const hollow = document.hollow
  if (hollow === undefined)
    return subtotalFen === amountInCents(document.grossAmount)
  const subject = { projectId: document.projectId, crewId: document.crewId, leaderWorkerId: document.members.find(member => member.isLeader)?.workerId ?? '', memberWorkerIds: document.members.map(member => member.workerId) }
  if (!isPayrollCHollowSource(hollow, document.formatFamily, subject, document.month) || hollow.state !== 'available'
    || hollow.totals.claimSubtotal.value === null || amountInCents(hollow.totals.claimSubtotal.value) !== subtotalFen || hollow.totals.grossAmount.value !== document.grossAmount) {
    return false
  }
  if (!hollow.start)
    return hollow.adoptions.length === 0
  return hollow.start.statementId === document.id && hollow.adoptions.length === hollow.start.lines.length
    && hollow.adoptions.every(adoption => adoption.statementId === document.id && adoption.createdBy === document.operatorName)
}

/** 核对源正文不含随后生成的采用行，冻结文档只允许这一事务内差异。 */
export function payrollCHollowSourceMatchesDocument(source: { schemaVersion: 1 | 2, hollow?: PayrollHollowSnapshot }, document: { hollow?: PayrollHollowSnapshot }): boolean {
  if (source.schemaVersion === 1)
    return document.hollow === undefined
  return !!source.hollow && !!document.hollow && source.hollow.adoptions.length === 0
    && payrollCanonical(source.hollow) === payrollCanonical({ ...document.hollow, adoptions: [] })
}
