import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityHollowDiagnostic, QuantityHollowFacts, QuantityHollowFactsQuery } from '../../app/lib/quantity/central-hollow-contract'
import type { QuantityHollowProofOptions, QuantityHollowProvenHistory } from '../../app/lib/quantity/central-hollow-proof-contract'
import type { QuantityHollowRow, QuantityHollowTables } from '../../app/lib/quantity/central-hollow-schema'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { hollowCanonical, hollowHash, hollowId, hollowIds } from '../../app/lib/quantity/central-hollow-primitives'
import { extendQuantityHollowProvenHistory, proveQuantityHollowRecord, quantityHollowFrozenFact } from '../../app/lib/quantity/central-hollow-proof'
import { isQuantityHollowProofRef } from '../../app/lib/quantity/central-hollow-result'
import { initializeQuantityHollowSchema, QUANTITY_HOLLOW_COLUMNS, QUANTITY_HOLLOW_TABLES } from '../../app/lib/quantity/central-hollow-schema'

export async function readQuantityHollowTables(tx: TransactionDb): Promise<QuantityHollowTables> {
  const tables = {} as QuantityHollowTables
  for (const table of QUANTITY_HOLLOW_TABLES) tables[table] = await tx.select<QuantityHollowRow>(`SELECT ${QUANTITY_HOLLOW_COLUMNS[table].join(',')} FROM ${table} ORDER BY id`)
  return tables
}
export async function quantityHollowTablesFingerprint(tables: QuantityHollowTables, projectId: string): Promise<string> {
  const ids = new Set(tables.quantity_hollow_records.filter(row => row.project_id === projectId).map(row => row.id))
  const relevant = Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, tables[table].filter(row => table === 'quantity_hollow_records' ? ids.has(row.id) : ids.has(row.record_id) || row.project_id === projectId).map((row) => {
    if (table !== 'quantity_hollow_command_receipts')
      return row
    const { result_json: _result, result_fingerprint: _fingerprint, ...original } = row
    return original
  })]))
  return hollowHash(hollowCanonical({ projectId, relevant }))
}
/** 当前物理集合每次重验；迁入缓存只能替代原图证明。 */
export async function loadQuantityHollowHistories(tx: TransactionDb, projectId: string, options: QuantityHollowProofOptions = {}) {
  await initializeQuantityHollowSchema(tx)
  const imported = await options.migratedProof?.(tx, projectId) ?? { histories: new Map<string, QuantityHollowProvenHistory>(), unavailable: [] }
  const tables = await readQuantityHollowTables(tx)
  const histories = new Map<string, QuantityHollowProvenHistory>()
  const unavailable: QuantityHollowDiagnostic[] = [...imported.unavailable]
  const blocked = new Set(imported.unavailable.map(row => row.recordId))
  for (const root of tables.quantity_hollow_records.filter(row => row.project_id === projectId)) {
    const id = String(root.id)
    if (blocked.has(id))
      continue
    const prefix = imported.histories.get(id)
    let result
    if (prefix) {
      const owned = new Set([prefix.recordId, ...prefix.steps.flatMap(step => [step.logId, step.receiptId]), ...prefix.fact.revisions.map(row => row.revisionId), ...prefix.fact.rectifications.map(row => row.id)])
      const suffix = Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, table === 'quantity_hollow_records' ? [] : tables[table].filter(row => row.record_id === id && !owned.has(String(row.id)))])) as QuantityHollowTables
      result = await extendQuantityHollowProvenHistory(prefix, suffix)
    }
    else {
      result = await proveQuantityHollowRecord({ projectId, recordId: id, tables })
    }
    if (result.status === 'proven')
      histories.set(id, result.history)
    else unavailable.push(...result.diagnostics.map(row => ({ ...row, target: { unitId: String(root.unit_id), assignmentId: String(root.assignment_id), roomId: String(root.room_id), itemId: String(root.item_id) } })))
  }
  for (const row of [...tables.quantity_hollow_logs, ...tables.quantity_hollow_command_receipts].filter(row => row.project_id === projectId && !tables.quantity_hollow_records.some(root => root.id === row.record_id && root.project_id === projectId))) unavailable.push({ code: 'record-unproven', message: '原命令或日志指向缺失的检查根，不能视为零处', recordId: hollowId(row.record_id) ? row.record_id : null, target: null })
  return { histories, unavailable, tables, fingerprint: await quantityHollowTablesFingerprint(tables, projectId) }
}
export async function loadQuantityHollowFacts(tx: TransactionDb, query: QuantityHollowFactsQuery, options: QuantityHollowProofOptions = {}): Promise<QuantityHollowFacts> {
  if (!hollowId(query.projectId) || !query.selection || (query.selection.kind === 'current' ? query.selection.recordIds !== undefined && !hollowIds(query.selection.recordIds) : query.selection.kind !== 'frozen' || !Array.isArray(query.selection.refs) || !query.selection.refs.every(isQuantityHollowProofRef)))
    throw quantityProblem('invalid-query', '空鼓来源查询身份或原件引用无效')
  const loaded = await loadQuantityHollowHistories(tx, query.projectId, options)
  const records = [] as QuantityHollowFacts['records']
  const unavailable = [...loaded.unavailable]
  if (query.selection.kind === 'current') {
    for (const id of query.selection.recordIds ?? loaded.histories.keys()) {
      const history = loaded.histories.get(id)
      if (history)
        records.push(structuredClone(history.fact))
      else if (!unavailable.some(row => row.recordId === id))
        unavailable.push({ code: 'record-unproven', message: '所选检查不属于当前可证明项目来源', recordId: id, target: null })
    }
  }
  else {
    for (const ref of query.selection.refs) {
      const history = loaded.histories.get(ref.recordId)
      const fact = history ? quantityHollowFrozenFact(history, ref) : null
      if (fact)
        records.push(fact)
      else unavailable.push({ code: 'record-unproven', message: '原冻结检查前缀无法证明，不能使用最新余量替代', recordId: ref.recordId, target: null })
    }
  }
  return { projectId: query.projectId, sourceVersion: `quantity-hollow:v1:${loaded.fingerprint}`, asOf: new Date().toISOString(), records, unavailable }
}
