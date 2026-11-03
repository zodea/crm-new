import type { PayrollAFeesPhysicalProjection } from './central-a-fees-provenance'
import type { PayrollAdjustmentBasisDraft, PayrollOriginalWageRef } from './central-adjustment-contract'
import type { PayrollHollowAdoption } from './central-hollow-deduction-contract'
import type { PayrollDb } from './statements'
import { payrollAAmount, payrollALines } from './central-a-calculation'
import { isPayrollAFrozenDocument } from './central-a-codec'
import { payrollAFeeAdjustmentBasis } from './central-a-fee-adjustment'
import { payrollAFeesPhysicalProof } from './central-a-fees-provenance'
import { isPayrollAStatementSourceVersioned } from './central-a-fees-validation'
import { isPayrollC1FrozenDocument, isPayrollC1StatementSourceVersioned } from './central-c1-codec'
import { isPayrollC2FrozenDocument, isPayrollC2StatementSourceVersioned } from './central-c2-codec'
import { payrollCanonical } from './central-command-shared'
import { payrollHollowAdjustmentBasis } from './central-hollow-deduction-adjustment'
import { payrollObject } from './central-snapshot'

export interface PayrollHollowOriginal { original: PayrollOriginalWageRef, basis: PayrollAdjustmentBasisDraft }
export const payrollHollowProofSame = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
export async function payrollHollowProofHash(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payrollCanonical(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const parsed = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : null
interface CommonDocument { id: string, projectId: string, projectName: string, month: string, actualAmount: number, grossAmount: number, members: Array<{ workerId: string, workerName: string }> }

/** 上层已证明采用及原发放回执；这里核完整原格式组成，不递归调用工资读取服务。 */
export async function payrollHollowProcessedOriginal(db: PayrollDb, adoption: PayrollHollowAdoption, fees?: PayrollAFeesPhysicalProjection): Promise<PayrollHollowOriginal | null> {
  const [head] = await db.select<Record<string, unknown>>('SELECT * FROM wage_statements WHERE id=?', [adoption.statementId])
  const raw = head ? parsed(head.snapshot_json) : null
  if (!head || !payrollObject(raw) || head.status !== 'released' || head.project_id !== adoption.projectId || head.format_family !== adoption.scope.formatFamily || head.crew_id !== adoption.scope.crewId || head.leader_worker_id !== adoption.scope.leaderWorkerId || head.month !== adoption.month)
    return null
  const same = payrollHollowProofSame
  const snapshot: Record<string, unknown> = raw
  async function original(document: CommonDocument, basis: PayrollAdjustmentBasisDraft, fingerprint: unknown): Promise<PayrollHollowOriginal | null> {
    if (document.id !== head!.id || document.projectId !== head!.project_id || document.month !== head!.month || document.grossAmount !== head!.gross_amount || document.actualAmount !== head!.actual_amount
      || !Object.entries(document).every(([key, value]) => same(snapshot[key], value)) || !basis.hollow?.source.adoptions.some(row => same(row, adoption))) {
      return null
    }
    return { original: { statementId: adoption.statementId, formatFamily: adoption.scope.formatFamily, projectId: document.projectId, projectName: document.projectName, crewId: adoption.scope.crewId, leaderWorkerId: adoption.scope.leaderWorkerId, month: document.month, memberWorkerIds: document.members.map(m => m.workerId), members: document.members.map(m => ({ ...m, crewId: adoption.scope.crewId })).map(({ workerId, workerName, crewId }) => ({ workerId, workerName, crewId })), originalSignatureAmount: payrollAAmount([document.actualAmount]), originalGrossAmount: payrollAAmount([document.grossAmount]), provenanceVersion: await payrollHollowProofHash(fingerprint), ...(basis.formatFamily === 'A' && basis.source.schemaVersion !== 1 ? { book: basis.source.book } : {}) }, basis }
  }
  const [stored] = await db.select<{ source_json: string }>(`SELECT source_json FROM payroll_${adoption.scope.formatFamily.toLowerCase()}_statement_sources WHERE statement_id=?`, [adoption.statementId])
  const source = stored ? parsed(stored.source_json) : null
  if (adoption.scope.formatFamily === 'A') {
    const document = raw.aDocument
    if (!isPayrollAFrozenDocument(document) || !isPayrollAStatementSourceVersioned(source) || !same(raw.aSource, source) || source.subject.leaderWorkerId !== adoption.scope.leaderWorkerId || source.subject.crewId !== adoption.scope.crewId || !document.hollow || (source.schemaVersion !== 3 && source.schemaVersion !== 4)
      || !same(source.hollow, { ...document.hollow, adoptions: [] }) || !same(source.adjustmentReconciliation, document.adjustmentReconciliation) || !('fees' in document) || !same(source.fees, document.fees)
      || (source.schemaVersion === 4 && !same(source.ratioPlan, document.ratioPlan))
      || !await payrollAFeesPhysicalProof(db, adoption.statementId, source, fees)) {
      return null
    }
    const calculated = source.book.bookPurpose === 'management' ? [] : payrollALines(source.facts, source.priceRevisions, source.subject, document.month)
    const moneyLines = (lines: typeof document.lines) => lines.map(line => ({ workerId: line.workerId, itemId: line.itemId, unit: line.unit, quantity: line.quantity, knownQuantity: line.knownQuantity, unitPrice: line.unitPrice, amount: line.amount, priceRevisionIds: line.priceRevisionIds, facts: line.facts }))
    if (!same(moneyLines(calculated), moneyLines(document.lines)) || !same(source.subject.memberWorkerIds.slice().sort(), document.members.map(m => m.workerId).sort()))
      return null
    const basis: PayrollAdjustmentBasisDraft = { formatFamily: 'A', periodKind: document.periodKind, source, payRatio: document.payRatio, ...(document.ratioPlan ? { ratioPlan: structuredClone(document.ratioPlan) } : {}), components: document.lines.flatMap(line => line.facts.map(fact => ({ ownershipKey: fact.ownershipKey, priceRevisionId: line.priceRevisionIds[0]!, quantity: fact.fieldQty, unitPrice: line.unitPrice }))), fees: payrollAFeeAdjustmentBasis(source), hollow: payrollHollowAdjustmentBasis(document.hollow) }
    return original(document, basis, { document, source })
  }
  if (adoption.scope.formatFamily === 'C1') {
    const document = raw.c1Document
    if (!isPayrollC1FrozenDocument(document) || !isPayrollC1StatementSourceVersioned(source) || source.schemaVersion !== 2 || !same(raw.c1Source, source) || !document.hollow
      || !same(source.hollow, { ...document.hollow, adoptions: [] }) || !same(source.facts, document.attendance) || !same(source.rates, document.rates)
      || source.subject.leaderWorkerId !== adoption.scope.leaderWorkerId || source.subject.crewId !== adoption.scope.crewId || !same(source.subject.memberWorkerIds.slice().sort(), document.members.map(m => m.workerId).sort())) {
      return null
    }
    return original(document, { formatFamily: 'C1', hollow: payrollHollowAdjustmentBasis(document.hollow), rates: document.rates.map(r => ({ workerId: r.workerId, configId: r.configId, dailyWage: r.dailyWage, overtimeRate: r.overtimeRateSource === 'daily-divided-eight' ? null : r.overtimeRate, overtimeRule: r.overtimeRateSource === 'daily-divided-eight' ? 'daily-divided-eight' : 'explicit' })), records: document.attendance.map(r => ({ recordId: r.id, workerId: r.workerId, workDate: r.workDate, hours: r.hours, overtimeHours: r.overtimeHours, workContent: r.workContent ?? '' })) }, document)
  }
  const document = raw.c2Document
  if (!isPayrollC2FrozenDocument(document) || !isPayrollC2StatementSourceVersioned(source) || source.schemaVersion !== 2 || !same(raw.c2Source, source) || !document.hollow
    || !same(source.hollow, { ...document.hollow, adoptions: [] }) || !same(source.facts, document.daywork) || !same(source.config, document.config)
    || source.subject.leaderWorkerId !== adoption.scope.leaderWorkerId || source.subject.crewId !== adoption.scope.crewId || !same(source.subject.memberWorkerIds.slice().sort(), document.members.map(m => m.workerId).sort())) {
    return null
  }
  return original(document, { formatFamily: 'C2', hollow: payrollHollowAdjustmentBasis(document.hollow), configId: document.config.id, unitRate: document.config.unitRate, records: document.daywork.map(r => ({ recordId: r.id, workerId: r.workerId, workDate: r.workDate!, laborUnits: r.laborUnits, startTime: r.startTime!, endTime: r.endTime!, workContent: r.workContent!, witness: r.witness!, confirmedOn: r.confirmedOn! })) }, document)
}
