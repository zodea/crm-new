import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { MigrationRawRow } from './migration-domain-evidence'
import { createHash } from 'node:crypto'
import { parsePayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { loadPayrollGraph, readPayrollStatement } from '../../app/lib/payroll/central-read'
import { hasProductionPayrollSchema } from '../../app/lib/payroll/central-schema'
import { decodeRosterArchive } from '../../app/lib/worker-roster/codec'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { readMigratedWorkerRosterArchive } from './payroll-publication-migration'
import { completeWorkbookReferences } from './payroll-workbook-references'
import { readPayrollWorkbookArchive } from './payroll-workbook-service'
import { productionPayrollInTransaction } from './production-payroll-service'
import { productionWorkerOriginals } from './production-worker-originals'

const hash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
function invalid(message: string): never {
  throw payrollProblem('unavailable', `正式工资完整性：${message}`)
}
const methods = new Set(['execute', 'executeFees', 'executeARounding', 'executeAttendance', 'executeC1', 'executeC2', 'executeDaywork', 'executeAdjustment', 'executeHollow', 'executeBatch', 'executeNumbering'])

/** Read-only backup and cold-open verification, including unknown/interrupted original commands. */
export async function validateProductionPayrollState(db: TransactionDb): Promise<{ metadataOnlyFileIds: string[] }> {
  await hasProductionPayrollSchema(db)
  const [identity] = await db.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  if (!identity)
    invalid('缺少可信工作区及操作者')
  const actor = { workspaceId: identity.workspace_id, actorId: identity.owner_id, capabilities: ['payroll:read', 'payroll:write', 'project:list:read', 'worker:list:read', 'crew:list:read', 'worker:sensitive:read', 'quantity:read'] }
  const service = productionPayrollInTransaction(db, () => actor)
  const intents = await db.select<Record<string, unknown>>('SELECT * FROM payroll_command_intents ORDER BY command_id')
  for (const row of intents) {
    let command: Record<string, unknown>
    try {
      command = JSON.parse(String(row.command_json))
    }
    catch { invalid('原命令正文损坏') }
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || !methods.has(String(row.method)) || hash(command) !== row.fingerprint || command.commandId !== row.command_id || command.workspaceId !== row.workspace_id || command.actorId !== row.actor_id || command.origin !== 'real' || command.requiredCapability !== 'payroll:write' || (command.action as { kind?: string })?.kind !== row.action)
      invalid('原命令身份、动作或完整指纹不能互证')
  }
  for (const row of await db.select<Record<string, unknown>>('SELECT * FROM payroll_command_journal ORDER BY command_id')) {
    if (row.family === 'payroll-import') {
      if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || row.action !== 'adopt')
        invalid('迁入原命令身份或动作不能互证')
      if (row.fingerprint === 'sealed') {
        if (row.command_json !== null || row.result_json !== null || row.outcome !== 'not-applied')
          invalid('迁入封存被改写为成功')
        continue
      }
      const proof = JSON.parse(String(row.command_json)) as { sourceSha256: string, commandId: string, workspaceId: string, actorId: string }
      const result = JSON.parse(String(row.result_json)) as { sourceSha256: string, commandId: string }
      if (row.outcome !== 'applied' || hash(proof) !== row.fingerprint || proof.commandId !== row.command_id || proof.workspaceId !== row.workspace_id || proof.actorId !== row.actor_id || result.commandId !== row.command_id || result.sourceSha256 !== proof.sourceSha256 || !(await db.select('SELECT source_sha256 FROM payroll_source_imports WHERE source_sha256=?', [proof.sourceSha256])).length)
        invalid('迁入成功回执与原图、摘要及明确映射不能互证')
      continue
    }
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || row.family !== 'payroll' || !['applied', 'not-applied'].includes(String(row.outcome)))
      invalid('原结果及封存身份不一致')
    const original = intents.find(intent => intent.command_id === row.command_id)
    if (row.fingerprint === 'sealed') {
      if (original || row.command_json !== null || row.result_json !== null || row.outcome !== 'not-applied')
        invalid('明确未应用封存被改写为工资成功')
      continue
    }
    if (!original || row.fingerprint !== original.fingerprint || row.command_json !== original.command_json || row.action !== original.action || row.target_id !== original.target_id)
      invalid('回执不能证明同一原命令')
    if (row.outcome === 'not-applied' && row.result_json !== null)
      invalid('未应用记录混入成功结果')
    if (row.outcome === 'applied') {
      let result: Record<string, unknown>
      try {
        result = JSON.parse(String(row.result_json))
      }
      catch { invalid('可靠原结果正文损坏') }
      if (result.commandId !== row.command_id && (result.schemaVersion !== 1 || !result.planId))
        invalid('成功结果丢失原命令或批次身份')
      const table = original.method === 'executeBatch' ? 'payroll_batch_command_receipts' : 'payroll_command_receipts'
      const [receipt] = await db.select<{ result_json: string }>(`SELECT result_json FROM ${table} WHERE command_id=?`, [row.command_id])
      if (!receipt || hash(JSON.parse(receipt.result_json)) !== hash(result))
        invalid('统一原结果与领域可靠回执不一致')
    }
  }
  const graph = await loadPayrollGraph(db)
  for (const evidence of graph.evidence)
    parsePayrollProjectGraph(evidence.graph)
  const imported = new Set(graph.evidence.flatMap(entry => entry.mappings.filter(mapping => mapping.tableName === 'wage_statements' && mapping.centralId).map(mapping => mapping.centralId!)))
  for (const head of graph.statements.filter(row => row.status === 'released' && !row._isolated)) {
    const row = await readPayrollStatement(db, String(head.id), graph)
    if (!imported.has(row.id) && ['A', 'C1', 'C2'].includes(row.formatFamily) && row.snapshot.state !== 'complete')
      invalid('当前已发原单的采用来源、全成员或冻结配对已损坏')
  }
  for (const projectId of new Set(graph.statements.map(row => String(row.project_id)))) {
    const facts = await loadPayrollActualFacts(db, { projectId })
    const events = await db.select<{ id: string }>('SELECT id FROM payroll_actual_events WHERE project_id=?', [projectId])
    for (const event of events) {
      if (!facts.rows.some(fact => fact.ref.kind === 'actual-event' && fact.ref.eventId === event.id && fact.signedAmount.value !== null))
        invalid('实际补退或错记冲销的原快照、分配及引用不能互证')
    }
  }
  for (const row of await db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_plans ORDER BY id'))
    await service.batch({ origin: 'real', projectId: String(row.project_id) }, String(row.id))
  for (const attempt of await db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_attempts ORDER BY id')) {
    if (hash(JSON.parse(String(attempt.command_json))) !== attempt.command_hash || hash(JSON.parse(String(attempt.execute_json))) !== attempt.execute_hash)
      invalid('P7原准备命令或原执行指纹损坏')
    const original = JSON.parse(String(attempt.command_json)) as { commandId: string, statementId: string }
    const proof = JSON.parse(String(attempt.execute_json)) as { commandId: string, planId: string, itemId: string }
    if (original.commandId !== attempt.payroll_command_id || proof.commandId !== attempt.execute_command_id || proof.planId !== attempt.plan_id || proof.itemId !== attempt.item_id)
      invalid('P7原执行身份链不一致')
    if (['checked', 'released'].includes(String(attempt.state)) && !(await db.select('SELECT command_id FROM payroll_command_receipts WHERE command_id=?', [attempt.payroll_command_id])).length)
      invalid('P7成功执行缺少原工资可靠回执')
  }
  for (const issue of await db.select<{ project_id: string, statement_id: string }>('SELECT project_id,statement_id FROM payroll_official_issues ORDER BY id')) {
    if (!(await service.numbering({ origin: 'real' }, { projectId: issue.project_id, statementId: issue.statement_id })).eligibility.canDownload)
      invalid('原正式编号与冻结原件无法核实')
  }
  for (const row of await db.select<{ id: string, project_id: string }>('SELECT id,project_id FROM payroll_workbook_archives ORDER BY id')) {
    const archive = await readPayrollWorkbookArchive(db, actor, row.project_id, row.id)
    const physical = archive.rosterRef ? (await db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM worker_roster_archives WHERE id=?', [archive.rosterRef.id]))[0] : null
    const roster = archive.rosterRef && physical ? await readMigratedWorkerRosterArchive(db, row.project_id, archive.rosterRef.id) ?? decodeRosterArchive(JSON.parse(physical.snapshot_json), row.project_id, archive.rosterRef.id) : undefined
    if (archive.rosterRef && !roster)
      invalid('目录固定名册引用已丢失')
    const expected = await completeWorkbookReferences(db, archive, roster)
    const actual = await db.select<{ table_name: string, record_id: string }>('SELECT table_name,record_id FROM payroll_workbook_references WHERE archive_id=?', [row.id])
    if (hash(expected.map(reference => [reference.tableName, reference.recordId]).sort()) !== hash(actual.map(reference => [reference.table_name, reference.record_id]).sort()))
      invalid('目录完整引用集合被裁剪或替换')
    for (const member of roster?.members ?? []) {
      for (const photo of member.photos) {
        if (photo.state === 'available')
          await productionWorkerOriginals.payload(db, member.workerId, photo.id)
      }
    }
  }
  for (const source of await db.select<{ source_sha256: string, schema_version: number, source_graph_json: string, evidence_json: string }>('SELECT source_sha256,schema_version,source_graph_json,evidence_json FROM payroll_source_imports')) {
    const graphs = JSON.parse(source.source_graph_json) as unknown[]
    if (!Array.isArray(graphs))
      invalid('来源完整项目图不是可证明数组')
    graphs.forEach(graph => parsePayrollProjectGraph(graph))
    const evidence = JSON.parse(source.evidence_json) as { sourceSha256: string, sourceGraphHash: string, domainEvidenceDigest: string, domainEvidence: { rows: Record<string, MigrationRawRow[]>, schemas: Record<string, { sql: string, columns: { name: string }[] }> }, schemaVersion: number, workspaceId: string, actorId: string, result: { sourceSha256: string } }
    if (evidence.sourceSha256 !== source.source_sha256 || evidence.schemaVersion !== source.schema_version || evidence.sourceGraphHash !== hash(graphs) || evidence.workspaceId !== actor.workspaceId || evidence.actorId !== actor.actorId || evidence.result.sourceSha256 !== source.source_sha256)
      invalid('本领域原图、输入SQLite摘要、版本及采用身份不能互证')
    const raw = evidence.domainEvidence
    if (!raw || !raw.rows || !raw.schemas || evidence.domainEvidenceDigest !== hash(raw) || hash(Object.keys(raw.rows).sort()) !== hash(Object.keys(raw.schemas).sort()))
      invalid('本领域完整SQL原列、精确值及扩展证据不能互证')
    for (const [table, rows] of Object.entries(raw.rows)) {
      if (!(table.startsWith('payroll_') || ['wage_statements', 'wage_statement_lines', 'wage_statement_members', 'wage_statement_allocations', 'attendance_records', 'signed_daywork_records', 'wage_statement_daywork_records', 'operation_logs', 'worker_roster_archives', 'worker_roster_receipts'].includes(table)) || !Array.isArray(rows))
        invalid('来源原列含另一主档或非本领域事实')
      const definition = raw.schemas[table]
      if (!definition?.sql || !Array.isArray(definition.columns) || !definition.columns.length || new Set(rows.map(row => row.legacyId)).size !== rows.length)
        invalid('本域原表结构或稳定行身份损坏')
      const names = definition.columns.map(column => column.name).sort()
      for (const row of rows) {
        if (!row.columns || hash(Object.keys(row.columns).sort()) !== hash(names))
          invalid('本域原SQL列被裁剪')
        for (const cell of Object.values(row.columns)) {
          if (!['null', 'integer', 'real', 'text', 'blob'].includes(cell.sqliteType) || (cell.sqliteType === 'null' ? cell.exactValue !== null : typeof cell.exactValue !== 'string') || ((cell.sqliteType === 'text' || cell.sqliteType === 'blob') ? typeof cell.rawHex !== 'string' || !/^(?:[a-f0-9]{2})*$/i.test(cell.rawHex) : cell.rawHex !== null))
            invalid('本域原值的SQLite类型及原字节证据损坏')
        }
      }
    }
  }
  return { metadataOnlyFileIds: [] }
}
