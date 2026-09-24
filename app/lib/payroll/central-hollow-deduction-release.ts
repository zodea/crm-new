import type { TransactionDb } from '../db/coordinator'
import type { PayrollHollowAdoption, PayrollHollowRead, PayrollHollowSnapshot } from './central-hollow-deduction-contract'
import { generateId } from '../util/id'
import { payrollCanonical, payrollWriteRow } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { isPayrollHollowSnapshot } from './central-hollow-deduction-snapshot'

/** 完整扣款恰好覆盖可领额时，明确实发0也能冻结已处理原件；不造正数现金。 */
export function payrollHollowAllowsZeroRelease(snapshot: PayrollHollowSnapshot | null | undefined): boolean {
  return !!snapshot && snapshot.state === 'available' && !!snapshot.start && snapshot.start.amount > 0
    && snapshot.totals.currentDeduction.value === snapshot.start.amount && snapshot.totals.availableBeforeDeduction.value === snapshot.start.amount && snapshot.totals.grossAmount.value === 0
}

/** 各格式在同一发放事务、冻结正文之前调用；不猜部分现金对应多少处。 */
export async function adoptPayrollHollowOnRelease(db: TransactionDb, read: PayrollHollowRead | undefined, actualAmount: number | null, actorId: string, commandId: string): Promise<PayrollHollowSnapshot | undefined> {
  if (!read)
    return undefined
  if (!read.snapshot || read.state !== 'available' || !isPayrollHollowSnapshot(read.snapshot))
    throw payrollProblem('validation-failed', '空鼓来源尚未完整核实，不能冻结工资')
  const snapshot = structuredClone(read.snapshot)
  const start = snapshot.start
  if (!start)
    return snapshot
  if (actualAmount !== snapshot.totals.grossAmount.value)
    throw payrollProblem('validation-failed', '本单已启动空鼓扣款，部分实际处理规则尚待明确；请保留原单并核实完整发放')
  for (const line of start.lines) {
    if ((await db.select('SELECT id FROM payroll_hollow_adoptions WHERE record_id=?', [line.recordId])).length)
      throw payrollProblem('conflict', '该空鼓原记录已被另一工资处理，请保留输入重新核对')
    const adoption: PayrollHollowAdoption = { id: generateId('hollow-adoption'), projectId: start.projectId, statementId: start.statementId, startId: start.id, scope: start.scope, month: start.month, line, commandId, createdBy: actorId, createdAt: new Date().toISOString() }
    await payrollWriteRow(db, 'payroll_hollow_adoptions', adoption.id, { id: adoption.id, project_id: adoption.projectId, statement_id: adoption.statementId, start_id: adoption.startId, record_id: line.recordId, command_id: commandId, adoption_json: payrollCanonical(adoption), created_by: actorId, created_at: adoption.createdAt }, actorId)
    snapshot.adoptions.push(adoption)
  }
  return snapshot
}
