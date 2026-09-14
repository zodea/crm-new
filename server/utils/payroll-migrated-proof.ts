import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import type { PayrollAFrozenDocument } from '../../app/lib/payroll/central-a-contract'
import type { PayrollANegativeLineRevision } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollActualFact, PayrollActualPaymentSnapshot, PayrollActualReversalSnapshot } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollAdjustmentBasisDraft, PayrollAdjustmentRecord, PayrollOriginalWageRef } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollC1FrozenDocument } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollC2OutputDocument } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { runMigrations } from '../../app/lib/db/migrations'
import { PAYROLL_CENTRAL_MIGRATION_TABLES, payrollCentralPrimaryKey } from '../../app/lib/migration/payroll-central-source'
import { parsePayrollProjectGraph, PAYROLL_MIGRATION_COLUMNS, PAYROLL_MIGRATION_PARTS, PAYROLL_MIGRATION_TABLES } from '../../app/lib/migration/payroll-source'
import { PAYROLL_A_FEES_MIGRATION_TABLES, payrollAFeesPrimaryKey } from '../../app/lib/payroll/central-a-fees-schema'
import { loadPayrollAReleasedDocuments } from '../../app/lib/payroll/central-a-provenance'
import { loadPayrollC1ReleasedDocuments } from '../../app/lib/payroll/central-c1-provenance'
import { loadPayrollC2ReleasedDocuments } from '../../app/lib/payroll/central-c2-provenance'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { loadPayrollANegativeLines } from './payroll-a-fees-data'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { payrollAdjustmentHash as hash, loadPayrollAdjustmentOriginal } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentRows, readPayrollAdjustmentRecord } from './payroll-adjustment-records'
import { insertPayrollCentralMigrationGraph, mapPayrollCentralMigrationGraph } from './payroll-central-migration'
import { insertPayrollFeesMigrationGraph, mapPayrollFeesMigrationGraph } from './payroll-fees-migration'
import { createPayrollMigratedMapper } from './payroll-migrated-mapping'
import { loadPayrollReleasedApplicationIds } from './payroll-release-application-provenance'

interface Evidence { entity_id: string, project_id: string, source_graph_json: string, mapping_json: string }
interface Original { original: PayrollOriginalWageRef, basis: PayrollAdjustmentBasisDraft }
export interface PayrollMigratedProof {
  negativeLineRevisions: Map<string, PayrollANegativeLineRevision>
  aDocuments: Map<string, PayrollAFrozenDocument>
  c1Documents: Map<string, PayrollC1FrozenDocument>
  c2Documents: Map<string, PayrollC2OutputDocument>
  originals: Map<string, Original>
  records: Map<string, PayrollAdjustmentRecord>
  draftBases: Map<string, { raw: string, basis: PayrollAdjustmentBasisDraft | null }>
  facts: Map<string, PayrollActualFact>
  snapshots: Map<string, PayrollActualPaymentSnapshot | PayrollActualReversalSnapshot>
  releasedApplications: Map<string, string[]>
}
const empty = (): PayrollMigratedProof => ({ negativeLineRevisions: new Map(), aDocuments: new Map(), c1Documents: new Map(), c2Documents: new Map(), originals: new Map(), records: new Map(), draftBases: new Map(), facts: new Map(), snapshots: new Map(), releasedApplications: new Map() })
let runtime: ReturnType<typeof initSqlJs> | undefined
const sourceProofs = new Map<string, Promise<PayrollMigratedProof>>()
const key = (table: string, id: unknown) => JSON.stringify([table, id])

/** 原 JSON 在原身份空间内验证；临时库只存在内存，不能写回正式事实。 */
export async function withPayrollMigratedSource<T>(graph: PayrollProjectGraph, work: (tx: TransactionDb) => Promise<T>): Promise<T> {
  runtime ??= initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') })
  const db = new (await runtime).Database()
  const tx: TransactionDb = {
    async execute(sql, params = []) { db.run(sql, params as never[]) },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const statement = db.prepare(sql)
      try {
        statement.bind(params as never[])
        const rows: T[] = []
        while (statement.step()) rows.push(statement.getAsObject() as T)
        return rows
      }
      finally { statement.free() }
    },
  }
  try {
    await runMigrations(tx)
    await initializePayrollSchema(tx)
    await tx.execute('PRAGMA foreign_keys=OFF')
    await insertPayrollFeesMigrationGraph(tx, graph.fees)
    for (const part of PAYROLL_MIGRATION_PARTS) {
      const table = PAYROLL_MIGRATION_TABLES[part]
      const columns = PAYROLL_MIGRATION_COLUMNS[part]
      for (const row of graph[part]) await tx.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(c => row[c]))
    }
    await insertPayrollCentralMigrationGraph(tx, graph.central)
    return await work(tx)
  }
  finally { db.close() }
}

async function proveSource(graph: PayrollProjectGraph): Promise<PayrollMigratedProof> {
  return withPayrollMigratedSource(graph, async (tx) => {
    const result = empty()
    if (graph.fees) {
      for (const id of new Set(graph.fees.tables.payroll_a_negative_lines.map(row => String(row.statement_id)))) {
        for (const revision of await loadPayrollANegativeLines(tx, id)) result.negativeLineRevisions.set(revision.id, revision)
      }
    }
    for (const head of graph.statements.filter(r => r.status === 'released' && ['A', 'C1', 'C2'].includes(String(r.format_family)))) {
      try {
        result.originals.set(String(head.id), await loadPayrollAdjustmentOriginal(tx, String(head.id)))
        result.releasedApplications.set(String(head.id), await loadPayrollReleasedApplicationIds(tx, String(head.id)))
      }
      catch { /* 无现代完整证明的历史头仍由 P0 逐项诊断；不能因此升格为可更正。 */ }
    }
    for (const record of (await loadPayrollAdjustmentRows(tx)).map(readPayrollAdjustmentRecord)) result.records.set(record.id, record)
    for (const [id, document] of await loadPayrollAReleasedDocuments(tx)) {
      if (result.originals.has(id))
        result.aDocuments.set(id, document)
    }
    for (const [id, document] of await loadPayrollC1ReleasedDocuments(tx)) {
      if (result.originals.has(id))
        result.c1Documents.set(id, document)
    }
    for (const [id, document] of await loadPayrollC2ReleasedDocuments(tx)) {
      if (result.originals.has(id))
        result.c2Documents.set(id, document)
    }
    const actual = await loadPayrollActualFacts(tx, { projectId: graph.projectId })
    for (const fact of actual.rows.filter(f => f.qualification === 'proven')) result.facts.set(fact.identity, fact)
    for (const row of graph.central!.tables.payroll_actual_events) {
      if (!actual.rows.some(f => f.ref.kind === 'actual-event' && f.ref.eventId === row.id))
        throw payrollProblem('unavailable', '迁入工资存在无法证明的实际收付')
      result.snapshots.set(String(row.id), JSON.parse(String(row.confirmed_snapshot_json)))
    }
    return result
  })
}

/** 每次读都核对迁入后的不可变行；缓存只保留原图证明，后续新收退款不进入缓存。 */
async function verifyPhysical(tx: TransactionDb, evidence: Evidence, graph: PayrollProjectGraph, mappings: PayrollIdentityMapping[]) {
  const mapping = new Map(mappings.map(m => [key(m.tableName, m.legacyId), m]))
  const central = mapPayrollCentralMigrationGraph(graph.central, evidence.entity_id, mapping)!
  const fees = mapPayrollFeesMigrationGraph(graph.fees, evidence.entity_id, mapping)
  if (hash([...mapping.values()]) !== hash(mappings))
    throw payrollProblem('unavailable', '迁入工资身份映射与原证据不一致')
  const check = async (table: string, primary: string, expected: Record<string, unknown>, ignored: string[] = []) => {
    const [row] = await tx.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${primary}=?`, [expected[primary]])
    if (!row || Object.entries(expected).some(([field, value]) => !ignored.includes(field) && row[field] !== value))
      throw payrollProblem('unavailable', `迁入工资 ${table}/${String(expected[primary])} 的原行或证据已缺损，不能继续计算剩余`)
  }
  const checkChildren = async (table: string, foreignKey: string, ownerId: string, expectedIds: unknown[]) => {
    const rows = await tx.select<{ id: string }>(`SELECT id FROM ${table} WHERE ${foreignKey}=?`, [ownerId])
    if (hash(rows.map(r => r.id).sort()) !== hash([...expectedIds].sort()))
      throw payrollProblem('unavailable', `迁入工资 ${table} 的原成员、分配或处理集合已变化，不能沿用原证明`)
  }
  for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) {
    if (['payroll_a_subject_configs'].includes(table))
      continue
    for (const row of central.tables[table]) {
      if (table === 'payroll_adjustments' && row.status !== 'confirmed')
        continue
      await check(table, payrollCentralPrimaryKey(table), row)
    }
  }
  if (fees) {
    for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
      for (const row of fees.tables[table])
        await check(table, payrollAFeesPrimaryKey(table), row, table === 'payroll_a_management_books' ? ['deleted_at'] : [])
    }
    for (const [table, parent] of [['payroll_a_management_book_revisions', 'management_book_id'], ['payroll_a_fee_revisions', 'fee_id']] as const) {
      for (const owner of new Set(fees.tables[table].map(row => row[parent]))) {
        const original = fees.tables[table].filter(row => row[parent] === owner)
        const maxRevision = Math.max(...original.map(row => Number(row.revision)))
        const current = await tx.select<{ id: string }>(`SELECT id FROM ${table} WHERE ${parent}=? AND revision<=?`, [owner, maxRevision])
        if (hash(current.map(row => row.id).sort()) !== hash(original.map(row => row.id).sort()))
          throw payrollProblem('unavailable', `迁入 ${table} 原修订集合已变化`)
      }
    }
  }
  const refs: Record<string, string> = { project_id: 'projects', crew_id: 'crews', leader_worker_id: 'workers', subject_config_id: 'payroll_subject_configs', statement_id: 'wage_statements', worker_id: 'workers', item_id: 'items', daywork_record_id: 'signed_daywork_records' }
  const released = new Set(graph.statements.filter(r => r.status === 'released' && mapping.get(key('wage_statements', r.id))?.centralId).map(r => r.id))
  for (const part of ['statements', 'lines', 'members', 'allocations', 'statementDaywork'] as const) {
    const table = PAYROLL_MIGRATION_TABLES[part]
    for (const row of graph[part].filter(r => part === 'statements' ? released.has(r.id) : released.has(r.statement_id))) {
      if (!mapping.get(key(table, row.id))?.centralId)
        continue
      const expected: Record<string, unknown> = { ...row, id: mapping.get(key(table, row.id))?.centralId }
      for (const [field, target] of Object.entries(refs)) {
        if (Object.hasOwn(row, field))
          expected[field] = row[field] === null ? null : mapping.get(key(target, row[field]))?.centralId ?? null
      }
      await check(table, 'id', expected, ['updated_at', 'deleted_at'])
    }
  }
  for (const originalId of released) {
    const statementId = mapping.get(key('wage_statements', originalId))!.centralId!
    if (fees) {
      for (const table of ['payroll_a_negative_lines', 'payroll_a_management_ownership'] as const) {
        const field = table === 'payroll_a_negative_lines' ? 'statement_id' : 'first_statement_id'
        await checkChildren(table, field, statementId, fees.tables[table].filter(row => row[field] === statementId).map(row => row.id))
      }
    }
    for (const part of ['lines', 'members', 'allocations', 'statementDaywork'] as const) {
      const table = PAYROLL_MIGRATION_TABLES[part]
      await checkChildren(table, 'statement_id', statementId, graph[part].filter(r => r.statement_id === originalId).map(r => mapping.get(key(table, r.id))?.centralId).filter(id => id != null))
    }
    for (const table of ['payroll_adjustment_applications', 'payroll_a_adjustment_coverage'] as const) {
      const field = table === 'payroll_adjustment_applications' ? 'released_statement_id' : 'statement_id'
      await checkChildren(table, field, statementId, central.tables[table].filter(r => r[field] === statementId).map(r => r.id))
    }
    const receipts = await tx.select<{ command_id: string }>('SELECT command_id FROM payroll_command_receipts WHERE statement_id=? AND action IN (\'release-a\',\'release-c1\',\'release-c2\')', [statementId])
    const expected = central.tables.payroll_command_receipts.filter(r => r.statement_id === statementId && ['release-a', 'release-c1', 'release-c2'].includes(String(r.action))).map(r => r.command_id)
    if (hash(receipts.map(r => r.command_id).sort()) !== hash(expected.sort()))
      throw payrollProblem('unavailable', '迁入原工资的发放回执集合已变化')
  }
  for (const event of central.tables.payroll_actual_events) {
    for (const table of ['payroll_actual_allocations', 'payroll_adjustment_applications'] as const) {
      const field = table === 'payroll_actual_allocations' ? 'event_id' : 'actual_event_id'
      await checkChildren(table, field, String(event.id), central.tables[table].filter(r => r[field] === event.id).map(r => r.id))
    }
  }
}

export async function loadPayrollMigratedProof(tx: TransactionDb, projectId?: string): Promise<PayrollMigratedProof> {
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_migration_evidence\'')).length)
    return empty()
  const evidences = await tx.select<Evidence>(`SELECT entity_id,project_id,source_graph_json,mapping_json FROM payroll_migration_evidence${projectId ? ' WHERE project_id=?' : ''}`, projectId ? [projectId] : [])
  const result = empty()
  for (const evidence of evidences) {
    const graph = parsePayrollProjectGraph(JSON.parse(evidence.source_graph_json))
    if (!graph.central)
      continue
    const mappings: PayrollIdentityMapping[] = JSON.parse(evidence.mapping_json)
    await verifyPhysical(tx, evidence, graph, mappings)
    const cacheKey = hash(evidence.source_graph_json)
    let source = sourceProofs.get(cacheKey)
    if (!source) {
      source = proveSource(graph)
      if (sourceProofs.size >= 8)
        sourceProofs.delete(sourceProofs.keys().next().value!)
      sourceProofs.set(cacheKey, source)
      void source.catch(() => sourceProofs.delete(cacheKey))
    }
    const proven = await source
    const mapper = createPayrollMigratedMapper(mappings)
    for (const revision of proven.negativeLineRevisions.values()) {
      const mapped = mapper.aNegativeLine(revision)
      result.negativeLineRevisions.set(mapped.id, mapped)
    }
    for (const document of proven.aDocuments.values()) {
      const mapped = mapper.aDocument(document)
      result.aDocuments.set(mapped.id, mapped)
    }
    for (const document of proven.c1Documents.values()) {
      const mapped = mapper.c1Document(document)
      result.c1Documents.set(mapped.id, mapped)
    }
    for (const document of proven.c2Documents.values()) {
      const mapped = mapper.c2Document(document)
      result.c2Documents.set(mapped.id, mapped)
    }
    for (const original of proven.originals.values()) {
      const mapped = { original: mapper.original(original.original), basis: mapper.basis(original.basis) }
      if (mapped.original.projectId !== evidence.project_id)
        throw payrollProblem('unavailable', '原工资映射目标项目不一致')
      result.originals.set(mapped.original.statementId, mapped)
    }
    for (const record of proven.records.values()) {
      if (record.status !== 'confirmed') {
        const sourceRow = graph.central.tables.payroll_adjustments.find(row => row.id === record.id)!
        const mapped = mapper.record(record)
        result.draftBases.set(mapped.id, { raw: String(sourceRow.basis_json), basis: mapped.draft.basis })
        continue
      }
      const mapped = mapper.record(record)
      result.records.set(mapped.id, mapped)
    }
    for (const fact of proven.facts.values()) {
      const mapped = mapper.fact(fact)
      result.facts.set(mapped.identity, mapped)
    }
    for (const snapshot of proven.snapshots.values()) {
      const mapped = mapper.snapshot(snapshot)
      result.snapshots.set(mapped.id, mapped)
    }
    for (const [id, applications] of proven.releasedApplications) {
      const statementId = mappings.find(m => m.tableName === 'wage_statements' && m.legacyId === id)?.centralId
      const ids = applications.map(id => mappings.find(m => m.tableName === 'payroll_adjustment_applications' && m.legacyId === id)?.centralId)
      if (!statementId || ids.some(id => !id))
        throw payrollProblem('unavailable', '原发放的更正处理身份缺损')
      result.releasedApplications.set(statementId, ids as string[])
    }
  }
  return result
}
