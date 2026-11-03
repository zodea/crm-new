import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAdjustmentBasisDraft, PayrollOriginalWageRef } from '../../app/lib/payroll/central-adjustment-contract'
import { createHash } from 'node:crypto'
import { payrollAFeeAdjustmentBasis } from '../../app/lib/payroll/central-a-fee-adjustment'
import { isPayrollAStatementSourceVersioned } from '../../app/lib/payroll/central-a-fees-validation'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollHollowAdjustmentBasis } from '../../app/lib/payroll/central-hollow-deduction-adjustment'
import { loadPayrollAReleasedWithMigration } from './payroll-a-released-with-migration'
import { loadPayrollC1ReleasedWithMigration, loadPayrollC2ReleasedWithMigration } from './payroll-c-released-with-migration'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

export const payrollAdjustmentHash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
export const payrollKnownAmount = (value: number) => ({ value, knownValue: value, state: 'known' as const, reasons: [] })

/** 接受调用方已有事务；原成员及单价只取可互证的发放资料。 */
export async function loadPayrollAdjustmentOriginal(tx: TransactionDb, statementId: string): Promise<{ original: PayrollOriginalWageRef, basis: PayrollAdjustmentBasisDraft }> {
  const migrated = (await loadPayrollMigratedProof(tx)).originals.get(statementId)
  if (migrated)
    return migrated
  const [head] = await tx.select<{ id: string, project_id: string, crew_id: string | null, leader_worker_id: string, status: string, format_family: string, actual_amount: number | null, gross_amount: number | null, month: string }>('SELECT id,project_id,crew_id,leader_worker_id,status,format_family,actual_amount,gross_amount,month FROM wage_statements WHERE id=?', [statementId])
  if (!head)
    throw payrollProblem('not-found', '原工资单不存在')
  if (head.status !== 'released' || head.format_family === 'B')
    throw payrollProblem('conflict', '只有可证明的原已发 A/C1/C2 工资可独立更正')
  function checkHead(document: { projectId: string, month: string, actualAmount: number, grossAmount: number }, crewId: string | null) {
    if (document.projectId !== head!.project_id || document.month !== head!.month || document.actualAmount !== head!.actual_amount || document.grossAmount !== head!.gross_amount || crewId !== head!.crew_id)
      throw payrollProblem('unavailable', '原工资头的主体、月份或金额与冻结不一致，须核对后再更正')
  }
  if (head.format_family === 'A') {
    const document = (await loadPayrollAReleasedWithMigration(tx, statementId)).get(statementId)
    const [row] = await tx.select<{ source_json: string }>('SELECT source_json FROM payroll_a_statement_sources WHERE statement_id=?', [statementId])
    let source: unknown
    try {
      source = row ? JSON.parse(row.source_json) : null
    }
    catch { source = null }
    if (!document || !isPayrollAStatementSourceVersioned(source))
      throw payrollProblem('unavailable', '原 A 完成责任、量价来源与发放冻结证明不完整')
    checkHead(document, source.subject.crewId)
    return {
      original: { statementId, formatFamily: 'A', projectId: document.projectId, projectName: document.projectName, crewId: source.subject.crewId, leaderWorkerId: head.leader_worker_id, month: document.month, memberWorkerIds: document.members.map(m => m.workerId), members: document.members.map(m => ({ workerId: m.workerId, workerName: m.workerName, crewId: head.crew_id })), originalSignatureAmount: payrollKnownAmount(document.actualAmount), originalGrossAmount: payrollKnownAmount(document.grossAmount), provenanceVersion: payrollAdjustmentHash({ document, source }), ...(source.schemaVersion !== 1 ? { book: source.book } : {}) },
      basis: { formatFamily: 'A', ...(document.hollow ? { hollow: payrollHollowAdjustmentBasis(document.hollow) } : {}), periodKind: document.periodKind, source, payRatio: document.payRatio, ...(document.ratioPlan ? { ratioPlan: structuredClone(document.ratioPlan) } : {}), components: document.lines.flatMap(line => line.facts.map(fact => ({ ownershipKey: fact.ownershipKey, priceRevisionId: line.priceRevisionIds[0]!, quantity: fact.fieldQty, unitPrice: line.unitPrice }))), ...(source.schemaVersion !== 1 ? { fees: payrollAFeeAdjustmentBasis(source) } : {}) },
    }
  }
  if (head.format_family === 'C1') {
    const document = (await loadPayrollC1ReleasedWithMigration(tx, statementId)).get(statementId)
    if (!document)
      throw payrollProblem('unavailable', '原 C1 逐日考勤、个人标准与发放冻结证明不完整')
    checkHead(document, document.crewId)
    return {
      original: { statementId, formatFamily: 'C1', projectId: document.projectId, projectName: document.projectName, crewId: document.crewId, leaderWorkerId: head.leader_worker_id, month: document.month, memberWorkerIds: document.members.map(m => m.workerId), members: document.members.map(m => ({ workerId: m.workerId, workerName: m.workerName, crewId: document.crewId })), originalSignatureAmount: payrollKnownAmount(document.actualAmount), originalGrossAmount: payrollKnownAmount(document.grossAmount), provenanceVersion: payrollAdjustmentHash(document) },
      basis: { formatFamily: 'C1', ...(document.hollow ? { hollow: payrollHollowAdjustmentBasis(document.hollow) } : {}), rates: document.rates.map(r => ({ workerId: r.workerId, configId: r.configId, dailyWage: r.dailyWage, overtimeRate: r.overtimeRateSource === 'daily-divided-eight' ? null : r.overtimeRate, overtimeRule: r.overtimeRateSource === 'daily-divided-eight' ? 'daily-divided-eight' : 'explicit' })), records: document.attendance.map(r => ({ recordId: r.id, workerId: r.workerId, workDate: r.workDate, hours: r.hours, overtimeHours: r.overtimeHours, workContent: r.workContent ?? '' })) },
    }
  }
  const document = (await loadPayrollC2ReleasedWithMigration(tx, statementId)).get(statementId)
  if (!document)
    throw payrollProblem('unavailable', '原工资完整格式依据、冻结及回执尚不能用于本次更正')
  checkHead(document, document.crewId)
  return {
    original: { statementId, formatFamily: 'C2', projectId: document.projectId, projectName: document.projectName, crewId: document.crewId, leaderWorkerId: head.leader_worker_id, month: document.month, memberWorkerIds: document.members.map(m => m.workerId), members: document.members.map(m => ({ workerId: m.workerId, workerName: m.workerName, crewId: document.crewId })), originalSignatureAmount: payrollKnownAmount(document.actualAmount), originalGrossAmount: payrollKnownAmount(document.grossAmount), provenanceVersion: payrollAdjustmentHash(document) },
    basis: { formatFamily: 'C2', ...(document.hollow ? { hollow: payrollHollowAdjustmentBasis(document.hollow) } : {}), configId: document.config.id, unitRate: document.config.unitRate, records: document.daywork.map(f => ({ recordId: f.id, workerId: f.workerId, workDate: f.workDate!, laborUnits: f.laborUnits, startTime: f.startTime!, endTime: f.endTime!, workContent: f.workContent!, witness: f.witness!, confirmedOn: f.confirmedOn! })) },
  }
}
