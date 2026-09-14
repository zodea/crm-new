import type { PayrollAFormRead } from '../../app/lib/payroll/central-a-contract'
import type { PayrollOriginalWageRef } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollC1FormRead } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollC2FormRead } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import type { PayrollMigratedProof } from './payroll-migrated-proof'

const known = (value: number) => ({ value, knownValue: value, state: 'known' as const, reasons: [] })
const eligibility = () => ({ canSaveDraft: false, canCheck: false, canRelease: false, canOutput: true, reasons: ['已发工资只能阅读当时冻结事实'] })
function frame(base: PayrollWritableContext, original: PayrollOriginalWageRef, crewName: string | null, note: string) {
  const members = original.members.map(member => ({ id: member.workerId, name: member.workerName, crewId: member.crewId, eligible: false, historical: true, reasons: ['已发工资保留原成员事实'], source: null }))
  return {
    context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+migrated-output:${original.provenanceVersion}` },
    statementId: original.statementId,
    draftKey: null,
    status: 'released' as const,
    needsRecheck: false,
    draft: { projectId: original.projectId, crewId: original.crewId, leaderWorkerId: original.leaderWorkerId, memberWorkerIds: original.memberWorkerIds, month: original.month, note },
    options: { projects: [{ id: original.projectId, name: original.projectName ?? '', code: '' }], crews: original.crewId === null ? [] : [{ id: original.crewId, name: crewName, eligible: false, reasons: ['原发放主体'] }], workers: members },
    members,
    blockers: [],
    eligibility: eligibility(),
  }
}

/** 已迁入已发单直接读取已证冻结；当前名册、价格与来源不能重算原表。 */
export function payrollMigratedAForm(proof: PayrollMigratedProof, base: PayrollWritableContext, statementId: string): PayrollAFormRead | null {
  const document = proof.aDocuments.get(statementId)
  const original = proof.originals.get(statementId)
  if (!document || original?.basis.formatFamily !== 'A')
    return null
  return { ...frame(base, original.original, document.crewName, document.note), draft: { ...original.basis.source.subject, month: document.month, periodKind: document.periodKind, payRatio: document.payRatio, note: document.note }, facts: original.basis.source.facts, lines: document.lines, prices: original.basis.source.priceRevisions, ratioDefault: { value: null, source: 'missing', statementId: null, configId: null, sourceVersion: null }, totals: { workAmount: known(document.workAmount), cumulativeAmount: known(document.cumulativeAmount), previouslyPaid: known(document.previouslyPaid), grossAmount: known(document.grossAmount) }, paymentSourceVersion: original.original.provenanceVersion, ...(document.adjustmentReconciliation ? { adjustmentReconciliation: document.adjustmentReconciliation } : {}) }
}
export function payrollMigratedC1Form(proof: PayrollMigratedProof, base: PayrollWritableContext, statementId: string): PayrollC1FormRead | null {
  const document = proof.c1Documents.get(statementId)
  const original = proof.originals.get(statementId)
  if (!document || !original)
    return null
  const sources: NavigationIntentDTO[] = document.attendance.map(fact => ({ kind: 'source-record', subject: { state: 'resolved', entity: 'attendance', id: fact.id, label: `${fact.workDate} 考勤`, no: null }, variant: 'matrix', view: null, filters: { projectId: fact.projectId, dataOrigin: base.origin, month: document.month, crewId: fact.crewId, workerId: fact.workerId, workDate: fact.workDate, recordId: fact.id } }))
  return { ...frame(base, original.original, document.crewName, document.note), facts: document.attendance, sources, rates: document.rates, lines: document.lines, totals: { grossAmount: known(document.grossAmount) } }
}
export function payrollMigratedC2Form(proof: PayrollMigratedProof, base: PayrollWritableContext, statementId: string): PayrollC2FormRead | null {
  const document = proof.c2Documents.get(statementId)
  const original = proof.originals.get(statementId)
  if (!document || !original)
    return null
  const sources: NavigationIntentDTO[] = document.daywork.map(fact => ({ kind: 'source-record', subject: { state: 'resolved', entity: 'daywork', id: fact.id, label: `${fact.workDate} 签工`, no: null }, variant: 'ledger', view: null, filters: { dataOrigin: base.origin, projectId: fact.projectId, month: document.month, crewId: fact.crewId, workerId: fact.workerId, workDate: fact.workDate } }))
  return { ...frame(base, original.original, document.crewName, document.note), facts: document.daywork.map((fact, index) => ({ ...fact, workerName: document.members.find(member => member.workerId === fact.workerId)?.workerName ?? null, crewName: document.crewName, source: sources[index]!, occupations: [], locks: [], diagnostics: [], eligibility: { canEdit: false, canConfirm: false, reasons: ['已发签工不可修改；后续更正需引用原发放'] }, availability: 'occupied' })), adoptedRecordIds: document.daywork.map(fact => fact.id), qualificationVersion: original.original.provenanceVersion, config: document.config, storedSource: null, sources, lines: document.lines, totals: { grossAmount: known(document.grossAmount) }, diagnostics: [], evidence: [] }
}
