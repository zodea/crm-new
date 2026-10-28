import type { Database } from 'sql.js'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import type { PayrollAFrozenDocument } from '../../app/lib/payroll/central-a-contract'
import type { PayrollANegativeLineRevision } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollActualFact, PayrollActualPaymentSnapshot, PayrollActualReversalSnapshot } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollAdjustmentBasisDraft, PayrollAdjustmentRecord, PayrollOriginalWageRef } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollC1FrozenDocument } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollC2OutputDocument } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { PayrollNumberingDocument } from '../../app/lib/payroll/central-numbering-contract'
import type { PayrollHollowSourceProof } from './payroll-hollow-migrated-source'
import type { PayrollNumberingProof } from './payroll-numbering-facts'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { runMigrations } from '../../app/lib/db/migrations'
import { PAYROLL_CENTRAL_MIGRATION_TABLES, payrollCentralPrimaryKey } from '../../app/lib/migration/payroll-central-source'
import { payrollProofAncestorGraph, payrollProofReceiptLogIds, verifyPayrollProofPackage } from '../../app/lib/migration/payroll-proof-package'
import { parsePayrollProjectGraph, PAYROLL_MIGRATION_COLUMNS, PAYROLL_MIGRATION_PARTS, PAYROLL_MIGRATION_TABLES } from '../../app/lib/migration/payroll-source'
import { PAYROLL_A_FEES_MIGRATION_TABLES, payrollAFeesPrimaryKey } from '../../app/lib/payroll/central-a-fees-schema'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../../app/lib/payroll/central-hollow-deduction-schema'
import { PAYROLL_NUMBERING_TABLES } from '../../app/lib/payroll/central-numbering-schema'
import { initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { QUANTITY_HOLLOW_COLUMNS, QUANTITY_HOLLOW_TABLES } from '../../app/lib/quantity/central-hollow-schema'
import { quantityHollowHash } from '../../app/lib/quantity/hollow-migration-graph'
import { buildQuantityHollowMigrationGraphs, QUANTITY_HOLLOW_EVIDENCE_COLUMNS, QUANTITY_HOLLOW_EVIDENCE_TABLE } from '../../app/lib/quantity/hollow-migration-source'
import { readQuantityHollowTables } from '../../app/lib/quantity/hollow-migration-tables'
import { loadPayrollANegativeLines } from './payroll-a-fees-data'
import { loadPayrollAReleasedWithMigration } from './payroll-a-released-with-migration'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { payrollAdjustmentHash as hash, loadPayrollAdjustmentOriginal } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentRows, readPayrollAdjustmentRecord } from './payroll-adjustment-records'
import { loadPayrollC1ReleasedWithMigration, loadPayrollC2ReleasedWithMigration } from './payroll-c-released-with-migration'
import { insertPayrollCentralMigrationGraph, mapPayrollCentralMigrationGraph } from './payroll-central-migration'
import { insertPayrollFeesMigrationGraph, mapPayrollFeesMigrationGraph } from './payroll-fees-migration'
import { emptyPayrollHollowSourceProof, provePayrollHollowMigrationSource } from './payroll-hollow-migrated-source'
import { insertPayrollHollowMigrationRows, mapPayrollHollowMigrationGraph } from './payroll-hollow-migration'
import { createPayrollMigratedMapper } from './payroll-migrated-mapping'
import { emptyPayrollNumberingProof, provePayrollNumberingState } from './payroll-numbering-facts'
import { insertPayrollNumberingMigrationRows, mapPayrollNumberingMigrationGraph } from './payroll-numbering-migration'
import { loadPayrollReleasedApplicationIds } from './payroll-release-application-provenance'
import { initializeQuantityHollowMigrationEvidence } from './quantity-hollow-migration'

interface Evidence { entity_id: string, project_id: string, source_graph_json: string, mapping_json: string }
interface Original { original: PayrollOriginalWageRef, basis: PayrollAdjustmentBasisDraft }
export interface PayrollMigratedProof {
  numbering: PayrollNumberingProof
  hollow: PayrollHollowSourceProof
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
const empty = (): PayrollMigratedProof => ({ numbering: emptyPayrollNumberingProof(), hollow: emptyPayrollHollowSourceProof(), negativeLineRevisions: new Map(), aDocuments: new Map(), c1Documents: new Map(), c2Documents: new Map(), originals: new Map(), records: new Map(), draftBases: new Map(), facts: new Map(), snapshots: new Map(), releasedApplications: new Map() })
let runtime: ReturnType<typeof initSqlJs> | undefined
// 空结构只取决于迁移与工资结构代码；同进程复用其字节，避免每次核验重放全部 ALTER。
let schemaBytes: Promise<Uint8Array> | undefined
const sourceProofs = new Map<string, Promise<PayrollMigratedProof>>()
const key = (table: string, id: unknown) => JSON.stringify([table, id])

function driverFor(db: Database): TransactionDb {
  return {
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
}

/** 原 JSON 在原身份空间内验证；临时库只存在内存，不能写回正式事实。 */
export async function withPayrollMigratedSource<T>(graph: PayrollProjectGraph, work: (tx: TransactionDb) => Promise<T>): Promise<T> {
  runtime ??= initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') })
  const SQL = await runtime
  if (!schemaBytes) {
    schemaBytes = (async () => {
      const template = new SQL.Database()
      try {
        const tx = driverFor(template)
        await runMigrations(tx)
        await initializePayrollSchema(tx)
        return template.export()
      }
      finally { template.close() }
    })()
    void schemaBytes.catch(() => {
      schemaBytes = undefined
    })
  }
  const db = new SQL.Database(await schemaBytes)
  const tx = driverFor(db)
  try {
    await tx.execute('PRAGMA foreign_keys=OFF')
    if (graph.deductions) {
      // 仅装载所携带的真实原件闭包；这份内存容器不产生任何业务成功凭据。
      await initializeQuantityHollowMigrationEvidence(tx)
      const quantity = graph.deductions.quantity
      for (const table of QUANTITY_HOLLOW_TABLES) {
        const columns = QUANTITY_HOLLOW_COLUMNS[table]
        for (const row of quantity.tables[table])
          await tx.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
      }
      const raw = JSON.stringify(quantity)
      await tx.execute(`INSERT INTO ${QUANTITY_HOLLOW_EVIDENCE_TABLE}(${QUANTITY_HOLLOW_EVIDENCE_COLUMNS.join(',')}) VALUES(?,?,?,?,?,?)`, ['source-proof', graph.projectId, 'source-proof', raw, await quantityHollowHash(raw), raw])
    }
    await insertPayrollFeesMigrationGraph(tx, graph.fees)
    for (const part of PAYROLL_MIGRATION_PARTS) {
      const table = PAYROLL_MIGRATION_TABLES[part]
      const columns = PAYROLL_MIGRATION_COLUMNS[part]
      for (const row of graph[part]) await tx.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(c => row[c]))
    }
    await insertPayrollCentralMigrationGraph(tx, graph.central)
    await insertPayrollHollowMigrationRows(tx, graph.deductions)
    await insertPayrollNumberingMigrationRows(tx, graph.numbering)
    if (graph.deductions?.proof) {
      const proof = await verifyPayrollProofPackage(graph.deductions.proof)
      for (const binding of proof.bindings) {
        const ancestor = parsePayrollProjectGraph(payrollProofAncestorGraph(proof, binding.originId))
        const projectId = binding.mappings.find(row => row.tableName === 'projects' && row.legacyId === ancestor.projectId)?.centralId
        if (!projectId || projectId !== graph.projectId)
          throw payrollProblem('unavailable', '工资祖先原图的映射项目不一致')
        await tx.execute('INSERT INTO payroll_migration_evidence(entity_id,project_id,batch_id,source_graph_json,diagnostics_json,mapping_json) VALUES(?,?,?,?,?,?)', [binding.entityId, projectId, 'source-proof-ancestor', JSON.stringify(ancestor), '[]', JSON.stringify(binding.mappings)])
      }
    }
    return await work(tx)
  }
  finally { db.close() }
}

async function proveSource(graph: PayrollProjectGraph): Promise<PayrollMigratedProof> {
  return withPayrollMigratedSource(graph, async (tx) => {
    // 此内存库只有已验证 DAG 的直接祖先，没有当前节点自身，后缀不能给自己背书。
    const result = await loadPayrollMigratedProof(tx, graph.projectId)
    result.hollow = await provePayrollHollowMigrationSource(tx, graph)
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
    for (const record of (await loadPayrollAdjustmentRows(tx)).map(readPayrollAdjustmentRecord)) {
      if (!result.records.has(record.id))
        result.records.set(record.id, record)
    }
    for (const [id, document] of await loadPayrollAReleasedWithMigration(tx)) {
      if (result.originals.has(id))
        result.aDocuments.set(id, document)
    }
    for (const [id, document] of await loadPayrollC1ReleasedWithMigration(tx)) {
      if (result.originals.has(id))
        result.c1Documents.set(id, document)
    }
    for (const [id, document] of await loadPayrollC2ReleasedWithMigration(tx)) {
      if (result.originals.has(id))
        result.c2Documents.set(id, document)
    }
    result.numbering = await provePayrollNumberingState(tx, graph.projectId, new Map<string, PayrollNumberingDocument>([...result.aDocuments, ...result.c1Documents, ...result.c2Documents]), result.numbering)
    // 版本别名只收集已通过格式/物理/P4前缀证明的冻结文档，不接受未经证明的 source_json。
    for (const document of [...result.aDocuments.values(), ...result.c1Documents.values(), ...result.c2Documents.values()]) {
      for (const row of document.hollow?.previousProcessed ?? []) {
        const entries = result.hollow.processedVersions.get(row.sourceVersion) ?? []
        const value = { adoptionId: row.adoption.id, adjustmentIds: row.adjustmentIds, effectiveAmount: row.effectiveAmount }
        if (!entries.some(entry => hash(entry) === hash(value)))
          entries.push(value)
        result.hollow.processedVersions.set(row.sourceVersion, entries)
      }
    }
    const actual = await loadPayrollActualFacts(tx, { projectId: graph.projectId })
    for (const fact of actual.rows.filter(f => f.qualification === 'proven')) result.facts.set(fact.identity, fact)
    for (const row of graph.central!.tables.payroll_actual_events) {
      if (!actual.rows.some(f => f.ref.kind === 'actual-event' && f.ref.eventId === row.id))
        throw payrollProblem('unavailable', '迁入工资存在无法证明的实际收付')
      if (!result.snapshots.has(String(row.id)))
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
  const quantityId = graph.deductions?.quantity.tables.quantity_hollow_records[0]?.id
  const mappedQuantityId = quantityId ? mapping.get(key('quantity_hollow_records', quantityId))?.centralId : null
  const quantityNamespace = mappedQuantityId?.split(':quantity_hollow_records:')[0]
  const deductions = mapPayrollHollowMigrationGraph(graph.deductions, evidence.entity_id, mapping, quantityNamespace && graph.deductions ? { namespace: quantityNamespace, original: graph.deductions.quantity } : undefined)
  const numbering = mapPayrollNumberingMigrationGraph(graph.numbering, evidence.entity_id, mapping)
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
  if (numbering) {
    for (const table of PAYROLL_NUMBERING_TABLES) {
      for (const row of numbering.tables[table]) await check(table, 'id', row, table === 'payroll_numbering_settings' ? ['next_number'] : [])
    }
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
  if (deductions) {
    for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
      for (const row of deductions.tables[table])
        await check(table, 'id', row)
      for (const commandId of new Set(deductions.tables[table].map(row => row.command_id)))
        await checkChildren(table, 'command_id', String(commandId), deductions.tables[table].filter(row => row.command_id === commandId).map(row => row.id))
    }
    for (const statementId of new Set(deductions.tables.payroll_hollow_adoptions.map(row => row.statement_id)))
      await checkChildren('payroll_hollow_adoptions', 'statement_id', String(statementId), deductions.tables.payroll_hollow_adoptions.filter(row => row.statement_id === statementId).map(row => row.id))
    const commands = new Set(PAYROLL_HOLLOW_DEDUCTION_TABLES.flatMap(table => graph.deductions!.tables[table].map(row => row.command_id)))
    const receiptLogs = new Set(graph.central!.tables.payroll_command_receipts.filter(row => commands.has(row.command_id)).flatMap(row => payrollProofReceiptLogIds(graph, String(row.command_id), String(row.result_json))))
    for (const logId of receiptLogs) {
      const log = graph.logs.find(row => row.id === logId)
      if (!log)
        throw payrollProblem('unavailable', '空鼓原回执缺少同事务日志原件')
      const mappedId = mapping.get(key('operation_logs', log.id))?.centralId
      const recordId = mapping.get(key(String(log.table_name), log.record_id))?.centralId
      if (!mappedId || !recordId)
        throw payrollProblem('unavailable', '空鼓原日志缺少明确身份映射')
      await check('operation_logs', 'id', { ...log, id: mappedId, record_id: recordId })
    }
    const physical = await readQuantityHollowTables(tx)
    if (!physical)
      throw payrollProblem('unavailable', '迁入工资的原空鼓物理证据缺失')
    for (const table of QUANTITY_HOLLOW_TABLES) {
      for (const row of deductions.quantity.tables[table])
        await check(table, 'id', row)
    }
    const projects = await tx.select<{ id: string }>('SELECT id FROM projects')
    // 原件内存库只装载领域闭包，项目原身份由 evidence 与责任原件交叉证明。
    await buildQuantityHollowMigrationGraphs(tx, physical, [...new Set([...projects.map(row => row.id), evidence.project_id])])
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
    if (deductions)
      await checkChildren('payroll_hollow_adoptions', 'statement_id', statementId, deductions.tables.payroll_hollow_adoptions.filter(row => row.statement_id === statementId).map(row => row.id))
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
    const mapper = createPayrollMigratedMapper(mappings, graph.deductions?.quantity)
    const mappedId = (table: string, id: string) => {
      const mapped = mappings.find(row => row.tableName === table && row.legacyId === id)?.centralId
      if (!mapped)
        throw payrollProblem('unavailable', '已处理空鼓前缀缺少明确身份映射')
      return mapped
    }
    for (const [version, rows] of proven.hollow.processedVersions)
      result.hollow.processedVersions.set(version, rows.map(row => ({ ...row, adoptionId: mappedId('payroll_hollow_adoptions', row.adoptionId), adjustmentIds: row.adjustmentIds.map(id => mappedId('payroll_adjustments', id)) })))
    for (const policy of proven.hollow.policyRevisions.values()) {
      const mapped = mapper.hollowPolicyRevision(policy)
      result.hollow.policyRevisions.set(mapped.id, mapped)
      result.hollow.policyVersions.set(mapped.id, [...new Set([...(proven.hollow.policyVersions.get(policy.id) ?? []), hash(policy), hash(mapped)])])
    }
    for (const start of proven.hollow.starts.values()) {
      const mapped = mapper.hollowStart(start)
      result.hollow.starts.set(mapped.id, mapped)
    }
    for (const adoption of proven.hollow.adoptions.values()) {
      const mapped = mapper.hollowAdoption(adoption)
      result.hollow.adoptions.set(mapped.id, mapped)
    }
    for (const receipt of proven.hollow.receipts.values()) {
      const command = mapper.hollowCommand(receipt.command)
      result.hollow.receipts.set(command.commandId, { command, result: mapper.hollowResult(receipt.result) })
    }
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
    for (const setting of proven.numbering.settings.values()) {
      const mapped = { ...setting, id: mappedId('payroll_numbering_settings', setting.id), projectId: mappedId('projects', setting.projectId) }
      result.numbering.settings.set(mapped.projectId, mapped)
    }
    for (const entry of proven.numbering.issues.values()) {
      const issue = { ...entry.issue, id: mappedId('payroll_official_issues', entry.issue.id), projectId: mappedId('projects', entry.issue.projectId), statementId: mappedId('wage_statements', entry.issue.statementId), commandId: mappedId('payroll_command_receipts', entry.issue.commandId) }
      const document = result.aDocuments.get(issue.statementId) ?? result.c1Documents.get(issue.statementId) ?? result.c2Documents.get(issue.statementId)
      if (!document)
        throw payrollProblem('unavailable', '迁入正式编号缺少已证冻结原工资')
      result.numbering.issues.set(issue.statementId, { issue, documentHash: hash(document) })
    }
    for (const id of proven.numbering.receipts) result.numbering.receipts.add(mappedId('payroll_command_receipts', id))
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
