export interface PayrollDb {
  execute: (sql: string, params?: unknown[]) => Promise<void>
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

export type WageStatementStatus = 'draft' | 'checked' | 'released'

export interface WageStatementMember {
  workerId: string
  workerName: string
  isLeader: boolean
}

export interface WageAllocationInput {
  workerId: string
  amount: number
}

export interface WageStatementAllocation extends WageAllocationInput {
  workerName: string
  isLeader: boolean
  allocatedAmountFen: number
}

export interface WageStatementFilter {
  projectId?: string
  month?: string
  status?: WageStatementStatus | '' | WageStatementStatus[]
  crewId?: string
}

export function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function amountInCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100)
}

export function normalizeAllocations(
  statement: { members: readonly WageStatementMember[] },
  actualAmount: number,
  allocations: readonly WageAllocationInput[],
): WageStatementAllocation[] {
  const requested = allocations.length
    ? allocations
    : statement.members.map(member => ({
        workerId: member.workerId,
        amount: member.isLeader ? actualAmount : 0,
      }))
  const members = new Map(statement.members.map(member => [member.workerId, member]))
  const seen = new Set<string>()
  const amounts = new Map<string, number>()
  for (const allocation of requested) {
    const member = members.get(allocation.workerId)
    if (!member)
      throw new Error('实际发放金额只能分配给当前请款簿成员')
    if (seen.has(allocation.workerId))
      throw new Error('同一成员不能重复分配实际发放金额')
    seen.add(allocation.workerId)
    if (!Number.isFinite(allocation.amount) || allocation.amount < 0)
      throw new Error('成员分配金额必须是大于或等于 0 的有效数字')
    const cents = allocation.amount * 100
    if (Math.abs(cents - Math.round(cents)) > 1e-8)
      throw new Error('成员分配金额必须精确到分')
    amounts.set(allocation.workerId, Math.round(cents))
  }
  if (seen.size !== members.size)
    throw new Error('组内分配必须包含负责人和全部成员，未分配成员请填 0')
  const normalized = statement.members.map(member => ({
    workerId: member.workerId,
    workerName: member.workerName,
    isLeader: member.isLeader,
    allocatedAmountFen: amounts.get(member.workerId) ?? 0,
    amount: (amounts.get(member.workerId) ?? 0) / 100,
  }))
  const allocatedCents = normalized.reduce(
    (sum, allocation) => sum + amountInCents(allocation.amount),
    0,
  )
  if (allocatedCents !== amountInCents(actualAmount))
    throw new Error('成员分配合计必须等于实际发放金额')
  return normalized
}
