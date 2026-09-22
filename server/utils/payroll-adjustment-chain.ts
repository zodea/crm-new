import type { PayrollAdjustmentRecord } from '../../app/lib/payroll/central-adjustment-contract'
import { payrollProblem } from '../../app/lib/payroll/central-contract'

/** 确认链只按明确前序连接；草稿创建顺序、迁入行序和时间均不决定生效顺序。 */
export function payrollAdjustmentChainHeads(records: readonly PayrollAdjustmentRecord[]): PayrollAdjustmentRecord[] {
  const groups = new Map<string, PayrollAdjustmentRecord[]>()
  for (const record of records) {
    if (record.status !== 'confirmed')
      continue
    const group = groups.get(record.originalStatementId) ?? []
    group.push(record)
    groups.set(record.originalStatementId, group)
  }
  const heads: PayrollAdjustmentRecord[] = []
  for (const [originalStatementId, chain] of groups) {
    const invalid = (): never => {
      throw payrollProblem('unavailable', `原工资 ${originalStatementId} 的更正确认链存在缺失、分叉或循环，须保留原记录核查`)
    }
    const roots = chain.filter(record => record.draft.correctsAdjustmentId === null)
    if (roots.length !== 1 || new Set(chain.map(record => record.id)).size !== chain.length)
      invalid()
    const root = roots[0]!
    if (root.rootAdjustmentId !== root.id || chain.some(record => record.rootAdjustmentId !== root.id))
      invalid()
    const successors = new Map<string, PayrollAdjustmentRecord>()
    const ids = new Set(chain.map(record => record.id))
    for (const record of chain) {
      const previous = record.draft.correctsAdjustmentId
      if (previous === null)
        continue
      if (!ids.has(previous) || successors.has(previous))
        invalid()
      successors.set(previous, record)
    }
    let current = root
    const visited = new Set<string>()
    while (!visited.has(current.id)) {
      visited.add(current.id)
      const next = successors.get(current.id)
      if (!next)
        break
      current = next
    }
    if (visited.size !== chain.length || successors.has(current.id))
      invalid()
    heads.push(current)
  }
  return heads
}
