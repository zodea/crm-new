import type { PayrollC2FrozenDocument, PayrollC2OutputDocument, PayrollC2OutputIdentity } from './central-c2-contract'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { createPayrollMigratedHollowMapper, PAYROLL_HOLLOW_OUTPUT_IDENTITY_TABLES } from './central-hollow-deduction-mapping'
import { wireId, wireObject } from './central-payroll-wire'

function outputIdentity(table: string, value: unknown): value is string {
  const quantityTables = ['quantity_hollow_records', 'quantity_hollow_revisions', 'quantity_hollow_rectifications', 'quantity_hollow_logs', 'units', 'unit_assignments', 'rooms', 'items', 'buildings', 'floors', 'house_type_templates', 'house_type_template_items'] as const
  if (quantityTables.includes(table as typeof quantityTables[number]))
    return isQuantitySourceIdentity(value, table as typeof quantityTables[number])
  if (typeof value === 'string' && value.startsWith('core-payroll_projects-')) {
    const matched = /^core-payroll_projects-[a-f0-9]{24}:([a-z_]+):(.+)$/.exec(value)
    if (!matched || matched[1] !== table)
      return false
    try {
      return decodeURIComponent(matched[2]!).length > 0 && encodeURIComponent(decodeURIComponent(matched[2]!)) === matched[2]
    }
    catch { return false }
  }
  if (table !== 'quantity_hollow_log_commands')
    return wireId(value)
  if (typeof value !== 'string')
    return false
  try {
    const pair = JSON.parse(decodeURIComponent(value))
    return Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string' && value.length > 0 && [...value].every(char => char.charCodeAt(0) >= 32)) && encodeURIComponent(JSON.stringify(pair)) === value
  }
  catch { return false }
}

/** 只对输出 DTO 的明确身份字段逆映射；原事实正文不变，随后仍执行完整原冻结校验。 */
export function payrollC2OriginalOutput(value: unknown): PayrollC2FrozenDocument | null {
  if (!wireObject(value) || !Array.isArray(value.identityMapping))
    return null
  const tables = ['wage_statements', 'projects', 'crews', 'workers', 'signed_daywork_records', 'payroll_subject_configs', ...PAYROLL_HOLLOW_OUTPUT_IDENTITY_TABLES]
  const reverse = new Map<string, string>()
  const originals = new Set<string>()
  const used = new Set<string>()
  const key = (table: string, identity: string) => JSON.stringify([table, identity])
  for (const row of value.identityMapping) {
    if (!wireObject(row) || Object.keys(row).some(field => !['tableName', 'legacyId', 'centralId'].includes(field)) || typeof row.tableName !== 'string' || !tables.includes(row.tableName) || !outputIdentity(row.tableName, row.legacyId) || !outputIdentity(row.tableName, row.centralId))
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
    const hollow = document.hollow
      ? createPayrollMigratedHollowMapper({
          id: (table, id) => original(table as PayrollC2OutputIdentity['tableName'], id),
          nullableId: (table, id) => nullable(table as PayrollC2OutputIdentity['tableName'], id),
          quantityCommand(logId, commandId) {
            const pair = JSON.parse(decodeURIComponent(original('quantity_hollow_log_commands', encodeURIComponent(JSON.stringify([logId, commandId])))))
            if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== original('quantity_hollow_logs', logId) || typeof pair[1] !== 'string')
              throw new Error('输出原检查命令与日志不一致')
            return pair[1]
          },
        }).snapshot(document.hollow)
      : undefined
    const restored: PayrollC2FrozenDocument = {
      ...document,
      ...(hollow ? { hollow } : {}),
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
