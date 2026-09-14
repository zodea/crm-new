import type { PayrollC2FrozenDocument, PayrollC2OutputDocument, PayrollC2OutputIdentity } from './central-c2-contract'
import { wireId, wireObject } from './central-payroll-wire'

/** 只对输出 DTO 的明确身份字段逆映射；原事实正文不变，随后仍执行完整原冻结校验。 */
export function payrollC2OriginalOutput(value: unknown): PayrollC2FrozenDocument | null {
  if (!wireObject(value) || !Array.isArray(value.identityMapping))
    return null
  const tables = ['wage_statements', 'projects', 'crews', 'workers', 'signed_daywork_records', 'payroll_subject_configs']
  const reverse = new Map<string, string>()
  const originals = new Set<string>()
  const used = new Set<string>()
  const key = (table: string, identity: string) => JSON.stringify([table, identity])
  for (const row of value.identityMapping) {
    if (!wireObject(row) || Object.keys(row).some(field => !['tableName', 'legacyId', 'centralId'].includes(field)) || typeof row.tableName !== 'string' || !tables.includes(row.tableName) || !wireId(row.legacyId) || !wireId(row.centralId))
      return null
    const from = key(row.tableName, row.legacyId)
    const to = key(row.tableName, row.centralId)
    if (reverse.has(to) || originals.has(from))
      return null
    reverse.set(to, row.legacyId)
    originals.add(from)
  }
  function original(table: PayrollC2OutputIdentity['tableName'], centralId: string): string {
    const entry = key(table, centralId)
    const legacyId = reverse.get(entry)
    if (!legacyId)
      throw new Error('未声明的输出身份')
    used.add(entry)
    return legacyId
  }
  const nullable = (table: PayrollC2OutputIdentity['tableName'], centralId: string | null) => centralId === null ? null : original(table, centralId)
  try {
    const document = value as unknown as PayrollC2OutputDocument
    const restored: PayrollC2FrozenDocument = {
      ...document,
      id: original('wage_statements', document.id),
      projectId: original('projects', document.projectId),
      crewId: nullable('crews', document.crewId),
      lines: document.lines.map((line) => {
        if (line.id !== `${line.workerId}:daywork`)
          throw new Error('输出行身份不一致')
        const workerId = original('workers', line.workerId)
        return { ...line, id: `${workerId}:daywork`, workerId, dayworkIds: line.dayworkIds.map(id => original('signed_daywork_records', id)) }
      }),
      daywork: document.daywork.map(fact => ({ ...fact, id: original('signed_daywork_records', fact.id), projectId: original('projects', fact.projectId), crewId: nullable('crews', fact.crewId), workerId: original('workers', fact.workerId) })),
      config: { ...document.config, id: original('payroll_subject_configs', document.config.id), projectId: original('projects', document.config.projectId), crewId: nullable('crews', document.config.crewId), leaderWorkerId: original('workers', document.config.leaderWorkerId) },
      members: document.members.map(member => ({ ...member, workerId: original('workers', member.workerId) })),
      allocations: document.allocations.map(allocation => ({ ...allocation, workerId: original('workers', allocation.workerId) })),
    }
    return used.size === reverse.size ? restored : null
  }
  catch { return null }
}
