import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'

export const payrollDependencyHash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
export interface PayrollDependencyBasis { schemaVersion: 1, scope: string, common: string, view?: string, people: Record<string, string>, records: Record<string, string>, locks: Record<string, string> }
const prefix = 'payroll-dependencies-v1:'
export function payrollDependencyVersion(kind: 'attendance' | 'c1-config', basis: PayrollDependencyBasis): string {
  return `${prefix}${kind}:${Buffer.from(payrollCanonical(basis)).toString('base64url')}`
}
export function assertPayrollDependencies(original: string, current: string, workerIds: readonly string[], recordKeys: readonly string[] = []) {
  if (!current.startsWith(prefix)) {
    if (original !== current)
      throw payrollProblem('stale-source', '原工资保存依据已变化，请保留输入重新核对')
    return
  }
  const parse = (value: string) => {
    const match = /^payroll-dependencies-v1:(attendance|c1-config):([\w-]+)$/.exec(value)
    if (!match)
      throw payrollProblem('stale-source', '原工资依赖协议不匹配，请保留原编号和输入')
    let basis: PayrollDependencyBasis
    try {
      basis = JSON.parse(Buffer.from(match[2]!, 'base64url').toString('utf8'))
    }
    catch { throw payrollProblem('stale-source', '原工资依赖向量无法核实') }
    if (basis.schemaVersion !== 1 || Object.keys(basis).sort().join(',') !== (Object.hasOwn(basis, 'view') ? 'common,locks,people,records,schemaVersion,scope,view' : 'common,locks,people,records,schemaVersion,scope') || ![basis.scope, basis.common, ...(Object.hasOwn(basis, 'view') ? [basis.view] : [])].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) || [basis.people, basis.records, basis.locks].some(rows => !rows || typeof rows !== 'object' || Array.isArray(rows) || Object.values(rows).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) || payrollDependencyVersion(match[1] as 'attendance' | 'c1-config', basis) !== value)
      throw payrollProblem('stale-source', '原工资依赖向量格式或指纹无法核实')
    return { kind: match[1], basis }
  }
  const before = parse(original)
  const after = parse(current)
  const empty = payrollDependencyHash([])
  if (before.kind !== after.kind || before.basis.scope !== after.basis.scope || before.basis.common !== after.basis.common || workerIds.some(id => before.basis.people[id] !== after.basis.people[id] || before.basis.locks[id] !== after.basis.locks[id]) || recordKeys.some(key => (before.basis.records[key] ?? empty) !== (after.basis.records[key] ?? empty)))
    throw payrollProblem('stale-source', '本次采用的工人资格、原记录、工资标准或月锁已变化，请保留输入重新核对')
}
