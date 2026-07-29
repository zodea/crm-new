import type { SignedDayworkRecord } from './daywork'
import type { WageStatement, WageStatementAllocation } from './statements'

export interface PayrollOutputRow {
  id: string
  workerName: string
  itemName: string
  unit: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface PayrollDocumentView {
  id: string
  projectName: string
  month: string
  crewName: string
  leaderName: string
  formatFamily: 'A' | 'C1' | 'C2'
  sourceLabel: string
  cumulativeAmount: number
  previouslyPaid: number
  grossAmount: number
  actualAmount: number
  checkedAt: string
  releasedAt: string
  operatorName: string
  note: string
  wageRows: PayrollOutputRow[]
  allocationRecorded: boolean
  allocations: WageStatementAllocation[]
  dayworkRecords: SignedDayworkRecord[]
}

export function createPayrollDocumentView(statement: WageStatement): PayrollDocumentView {
  if (statement.status !== 'released')
    throw new Error('工资单完成实际发放后才能生成正式输出')
  if (statement.formatFamily === 'B')
    throw new Error('B 类合同清单工资尚未实现，不能生成无事实来源的输出')

  const workerNames = new Map(
    statement.members.map(member => [member.workerId, member.workerName]),
  )
  const sourceLabel = statement.formatFamily === 'C2'
    ? '已确认签工'
    : statement.formatFamily === 'C1'
      ? '考勤工资汇总'
      : '现场复核量'

  return {
    id: statement.id,
    projectName: statement.projectName,
    month: statement.month,
    crewName: statement.crewName,
    leaderName: statement.leaderName,
    formatFamily: statement.formatFamily,
    sourceLabel,
    cumulativeAmount: statement.cumulativeAmount,
    previouslyPaid: statement.previouslyPaid,
    grossAmount: statement.grossAmount,
    actualAmount: statement.actualAmount ?? 0,
    checkedAt: statement.checkedAt ?? '',
    releasedAt: statement.releasedAt ?? '',
    operatorName: statement.operatorName,
    note: statement.note,
    wageRows: statement.lines.map(line => ({
      id: line.id,
      workerName: workerNames.get(line.workerId) ?? line.workerId,
      itemName: line.itemName,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    })),
    allocationRecorded: statement.allocationRecorded,
    allocations: statement.allocations,
    dayworkRecords: statement.formatFamily === 'C2'
      ? statement.dayworkRecords
      : [],
  }
}
