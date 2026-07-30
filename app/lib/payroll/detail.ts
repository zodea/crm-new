import type { PayrollDb, WageStatement } from './statements'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { loadWageStatement } from '~/lib/payroll/statements'

export interface PayrollStatementDetailSummary {
  memberCount: number
  lineCount: number
  calculationAmount: number
  formalPaidAmount: number
  allocationTotal: number | null
  allocationBalanced: boolean | null
}

export interface PayrollStatementDetailSnapshot {
  statement: WageStatement
  summary: PayrollStatementDetailSummary
}

function amountInCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100)
}

/**
 * 工资单详情只聚合真实外键记录。正式已发金额仅来自 released 快照；
 * 草稿和已核对单据不能被统计为已发工资。
 */
export async function loadPayrollStatementDetail(
  db: PayrollDb,
  statementId: string,
): Promise<PayrollStatementDetailSnapshot | null> {
  const visibleRows = await db.select<{ id: string }>(
    selectVisibleSql('wage_statements', 'AND id = ? LIMIT 1'),
    [statementId],
  )
  if (!visibleRows[0])
    return null

  const statement = await loadWageStatement(db, statementId)
  if (!statement)
    return null

  const calculationAmount = statement.lines.reduce((sum, line) => sum + line.amount, 0)
  const formalPaidAmount = statement.status === 'released'
    ? (statement.actualAmount ?? 0)
    : 0
  const allocationTotal = statement.status === 'released' && statement.allocationRecorded
    ? statement.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
    : null

  return {
    statement,
    summary: {
      memberCount: statement.members.length,
      lineCount: statement.lines.length,
      calculationAmount,
      formalPaidAmount,
      allocationTotal,
      allocationBalanced: allocationTotal == null
        ? null
        : amountInCents(allocationTotal) === amountInCents(formalPaidAmount),
    },
  }
}
