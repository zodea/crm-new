import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollHollowMigrationGraph } from '../../app/lib/migration/payroll-hollow-source'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { PayrollHollowDeductionTable } from '../../app/lib/payroll/central-hollow-deduction-schema'
import type { QuantityHollowMigrationGraph } from '../../app/lib/quantity/hollow-migration-contract'
import { readPayrollHollowDeductionTables } from '../../app/lib/migration/payroll-hollow-source'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { initializePayrollHollowDeductionSchema, PAYROLL_HOLLOW_DEDUCTION_COLUMNS, PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../../app/lib/payroll/central-hollow-deduction-schema'
import { hollowEqual } from '../../app/lib/quantity/central-hollow-primitives'
import { hollowCommandIdentity } from '../../app/lib/quantity/hollow-migration-graph'
import { mapQuantityHollowMigrationGraph } from '../../app/lib/quantity/hollow-migration-mapping'

const key = (table: string, id: unknown) => JSON.stringify([table, id])
export const PAYROLL_HOLLOW_SQL_REFERENCES = { project_id: 'projects', crew_id: 'crews', leader_worker_id: 'workers', management_book_id: 'payroll_a_management_books', item_id: 'items', previous_revision_id: 'payroll_hollow_policy_revisions', statement_id: 'wage_statements', previous_start_id: 'payroll_hollow_starts', start_id: 'payroll_hollow_starts', record_id: 'quantity_hollow_records', command_id: 'payroll_command_receipts', policy_id: 'payroll_hollow_policies' } as const

export function mapPayrollHollowMigrationGraph(source: PayrollHollowMigrationGraph | undefined, entityId: string, mapping: Map<string, PayrollIdentityMapping>, quantity?: { namespace: string, original: QuantityHollowMigrationGraph }): PayrollHollowMigrationGraph | undefined {
  if (!source)
    return undefined
  if (source.quantity.origins.length && !quantity)
    throw payrollProblem('conflict', '工资扣款迁入缺少同项目数量原件身份空间')
  if (quantity) {
    for (const [table, rows] of Object.entries(source.quantity.tables)) {
      for (const row of rows) {
        if (!quantity.original.tables[table as keyof QuantityHollowMigrationGraph['tables']].some(original => hollowEqual(original, row)))
          throw payrollProblem('conflict', '工资扣款原件不属于同时迁入的真实数量来源')
      }
    }
  }
  for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
    for (const row of source.tables[table]) {
      const legacyId = String(row.id)
      mapping.set(key(table, legacyId), { tableName: table, legacyId, centralId: `${entityId}:${table}:${encodeURIComponent(legacyId)}` })
      if (table === 'payroll_hollow_policy_revisions') {
        const policyId = String(row.policy_id)
        mapping.set(key('payroll_hollow_policies', policyId), { tableName: 'payroll_hollow_policies', legacyId: policyId, centralId: `${entityId}:payroll-hollow-policy:${encodeURIComponent(policyId)}` })
      }
    }
  }
  const mappedQuantity = mapQuantityHollowMigrationGraph(source.quantity, quantity?.namespace ?? entityId, (table, legacyId) => {
    const previous = mapping.get(key(table, legacyId))
    if (previous) {
      if (!previous.centralId)
        throw payrollProblem('conflict', '空鼓扣款原责任身份被隔离，不能为其补造中央身份')
      return previous.centralId
    }
    const centralId = `${quantity?.namespace ?? entityId}:${table}:${encodeURIComponent(legacyId)}`
    mapping.set(key(table, legacyId), { tableName: table, legacyId, centralId })
    return centralId
  })
  for (const binding of source.quantity.bindings) {
    const next = mappedQuantity.bindings.find(row => row.originId === binding.originId)!
    for (const entry of binding.identities) {
      if (entry.kind !== 'command')
        continue
      const projected = next.identities.find(row => row.kind === 'command' && hollowEqual(row.source, entry.source))
      if (!projected || projected.kind !== 'command')
        throw payrollProblem('conflict', '空鼓原命令三元组映射不完整')
      const legacyId = hollowCommandIdentity(entry.exported)
      mapping.set(key('quantity_hollow_commands', legacyId), { tableName: 'quantity_hollow_commands', legacyId, centralId: projected.exported.commandId })
    }
  }
  return { schemaVersion: 1, quantity: mappedQuantity as PayrollHollowMigrationGraph['quantity'], ...(source.proof ? { proof: source.proof } : {}), tables: Object.fromEntries(PAYROLL_HOLLOW_DEDUCTION_TABLES.map(table => [table, source.tables[table].map(row => mapPayrollHollowMigrationRow(table, row, mapping))])) as PayrollHollowMigrationGraph['tables'] }
}

export function mapPayrollHollowMigrationRow(table: PayrollHollowDeductionTable, row: PayrollMigrationRow, mapping: ReadonlyMap<string, PayrollIdentityMapping>): PayrollMigrationRow {
  function id(table: string, value: unknown): string | null {
    if (value === null)
      return null
    const centralId = mapping.get(key(table, value))?.centralId
    if (!centralId)
      throw payrollProblem('conflict', `空鼓扣款 ${table}/${String(value)} 缺少明确身份映射`)
    return centralId
  }
  const mapped: PayrollMigrationRow = { ...row, id: id(table, row.id) }
  for (const [field, target] of Object.entries(PAYROLL_HOLLOW_SQL_REFERENCES)) {
    if (Object.hasOwn(row, field))
      mapped[field] = id(target, row[field])
  }
  return mapped
}
export function payrollHollowGraphKeys(graph: PayrollHollowMigrationGraph | undefined) {
  return graph ? PAYROLL_HOLLOW_DEDUCTION_TABLES.flatMap(table => graph.tables[table].map(row => key(table, row.id))) : []
}
export function payrollHollowGraphFingerprint(graph: PayrollHollowMigrationGraph | undefined) {
  return graph ? PAYROLL_HOLLOW_DEDUCTION_TABLES.map(table => [table, graph.tables[table].toSorted((a, b) => String(a.id).localeCompare(String(b.id))).map(row => PAYROLL_HOLLOW_DEDUCTION_COLUMNS[table].map(column => row[column]))]) : null
}
export async function readPayrollHollowMigrationRows(tx: TransactionDb) {
  await initializePayrollHollowDeductionSchema(tx)
  return (await readPayrollHollowDeductionTables(tx))!
}
export async function insertPayrollHollowMigrationRows(tx: TransactionDb, graph: PayrollHollowMigrationGraph | undefined) {
  if (!graph)
    return
  await initializePayrollHollowDeductionSchema(tx)
  for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
    const columns = PAYROLL_HOLLOW_DEDUCTION_COLUMNS[table]
    for (const row of graph.tables[table]) await tx.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
  }
}
export async function removePayrollHollowMigrationRows(tx: TransactionDb, graph: PayrollHollowMigrationGraph | undefined) {
  if (!graph)
    return
  for (const table of [...PAYROLL_HOLLOW_DEDUCTION_TABLES].reverse()) {
    for (const row of graph.tables[table]) await tx.execute(`DELETE FROM ${table} WHERE id=?`, [row.id])
  }
}
