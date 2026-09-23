import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollPublicationGraph, PayrollPublicationOrigin, PublicationArchiveTable } from '../../app/lib/migration/payroll-publication-source'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { PayrollNumberingDocument } from '../../app/lib/payroll/central-numbering-contract'
import type { PayrollWorkbookArchive } from '../../app/lib/payroll/central-workbook-contract'
import type { QuantityHollowMigrationGraph } from '../../app/lib/quantity/hollow-migration-contract'
import type { WorkerRosterArchive } from '../../app/lib/worker-roster/contract'
import { PAYROLL_PUBLICATION_COLUMNS, PAYROLL_PUBLICATION_TABLES, publicationRowId, readPayrollPublicationGraph } from '../../app/lib/migration/payroll-publication-source'
import { parsePayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { mapPublicationArchiveRow, mapRosterArchive, mapWorkbookArchive, provePublicationOriginal, publicationMapper, publicationProofHash } from './payroll-publication-proof'
import { initializePayrollWorkbookSchema, workbookHash } from './payroll-workbook-storage'
import { initializeWorkerRosterSchema, workerRosterAssets } from './worker-roster-storage'

const key = (table: string, id: unknown) => JSON.stringify([table, id])
const receiptTable = (table: PublicationArchiveTable) => table === 'worker_roster_archives' ? 'worker_roster_receipts' : 'payroll_workbook_receipts'
function invalid(): never {
  throw payrollProblem('conflict', '固定目录与名册的迁入关系或原件证明不完整，不能部分接管')
}

async function initialize(db: TransactionDb) {
  await initializeWorkerRosterSchema(db)
  await initializePayrollWorkbookSchema(db)
  await db.execute('CREATE TABLE IF NOT EXISTS payroll_publication_migration_proofs(table_name TEXT NOT NULL,record_id TEXT NOT NULL,proof_json TEXT NOT NULL,PRIMARY KEY(table_name,record_id))')
}

function mapReceipt(table: 'worker_roster_receipts' | 'payroll_workbook_receipts', row: PayrollMigrationRow, mappings: PayrollIdentityMapping[]): PayrollMigrationRow {
  const id = publicationMapper(mappings)
  return { ...row, command_id: id(table, publicationRowId(table, row)), ...(table === 'payroll_workbook_receipts' ? { project_id: id('projects', String(row.project_id)) } : {}), archive_id: row.archive_id === null ? null : id(table === 'worker_roster_receipts' ? 'worker_roster_archives' : 'payroll_workbook_archives', String(row.archive_id)) }
}

function verifyOrigin(origin: PayrollPublicationOrigin, row: PayrollMigrationRow, receipt: PayrollMigrationRow) {
  if (publicationProofHash(origin) !== origin.proofHash || origin.recordId !== row.id
    || workbookHash(mapPublicationArchiveRow(origin.tableName, origin.sourceRow, origin.mappings, origin.quantity)) !== workbookHash(row)
    || workbookHash(mapReceipt(receiptTable(origin.tableName), origin.receiptRow, origin.mappings)) !== workbookHash(receipt)) {
    invalid()
  }
  return provePublicationOriginal(origin.tableName, origin.sourceRow, origin.receiptRow)
}

export function publicationViews(source: PayrollPublicationGraph) {
  const rosters: WorkerRosterArchive[] = []
  const workbooks: PayrollWorkbookArchive[] = []
  for (const table of ['worker_roster_archives', 'payroll_workbook_archives'] as const) {
    for (const row of source.tables[table]) {
      const receipts = source.tables[receiptTable(table)].filter(receipt => receipt.archive_id === row.id)
      if (receipts.length !== 1)
        invalid()
      const prior = source.origins.find(origin => origin.tableName === table && origin.recordId === row.id)
      const original = prior ? verifyOrigin(prior, row, receipts[0]!) : provePublicationOriginal(table, row, receipts[0]!)
      if (table === 'worker_roster_archives')
        rosters.push(prior ? mapRosterArchive(original as WorkerRosterArchive, prior.mappings) : original as WorkerRosterArchive)
      else workbooks.push(prior ? mapWorkbookArchive(original as PayrollWorkbookArchive, prior.mappings, prior.quantity) : original as PayrollWorkbookArchive)
    }
  }
  return { rosters, workbooks }
}

/** The archive is an immutable copy of proven wages, never a replacement authority for wages. */
export async function provePublicationWageParents(tx: TransactionDb, source: PayrollPublicationGraph, documents: ReadonlyMap<string, PayrollNumberingDocument>) {
  const { rosters, workbooks } = publicationViews(source)
  for (const roster of rosters) {
    const members = new Map<string, string[]>()
    for (const statementId of roster.scope.statementIds) {
      const document = documents.get(statementId)
      if (!document)
        invalid()
      for (const member of document.members)
        members.set(member.workerId, [...members.get(member.workerId) ?? [], statementId].sort())
    }
    if (members.size !== roster.members.length || roster.members.some(member => workbookHash(member.statementIds.toSorted()) !== workbookHash(members.get(member.workerId))))
      invalid()
  }
  for (const workbook of workbooks) {
    for (const group of workbook.groups) {
      const current = await loadPayrollActualFacts(tx, group.actualLedger.scope)
      if (group.actualLedger.rows.some(fact => !current.rows.some(proven => proven.identity === fact.identity && workbookHash(proven) === workbookHash(fact))))
        invalid()
      if (current.rows.some(fact => (fact.kind === 'initial-release' || (fact.recordedAt !== null && fact.recordedAt < workbook.createdAt)) && !group.actualLedger.rows.some(saved => saved.identity === fact.identity)))
        invalid()
      // Later events may exist, but the archived prefix and its own total must remain exactly provable.
      if (workbookHash(payrollAAmount(group.actualLedger.rows.map(fact => fact.signedAmount.value), group.actualLedger.netAmount.reasons)) !== workbookHash(group.actualLedger.netAmount))
        invalid()
    }
    for (const entry of workbook.groups.flatMap(group => group.entries)) {
      const document = documents.get(entry.row.id)
      if (!document || workbookHash(document) !== workbookHash(entry.document))
        invalid()
    }
    if (workbook.rosterRef) {
      const roster = rosters.find(row => row.id === workbook.rosterRef!.id)
      if (!roster)
        invalid()
      const { context: _context, ...body } = roster
      const ref = workbook.rosterRef
      if (roster.scope.projectId !== workbook.input.projectId || workbookHash(roster.scope.statementIds.toSorted()) !== workbookHash(workbook.input.statementIds.toSorted())
        || ref.version !== roster.version || ref.registeredOn !== roster.scope.registeredOn || ref.sourceVersion !== roster.sourceVersion
        || (ref.contentHash !== workbookHash(body) && ref.contentHash !== roster.migration?.originalContentHash)) {
        invalid()
      }
    }
  }
}

export function mapPayrollPublicationGraph(source: PayrollPublicationGraph | undefined, entityId: string, mapping: Map<string, PayrollIdentityMapping>, quantity?: QuantityHollowMigrationGraph): PayrollPublicationGraph | undefined {
  if (!source)
    return undefined
  for (const table of PAYROLL_PUBLICATION_TABLES.filter(table => table !== 'payroll_workbook_references')) {
    for (const row of source.tables[table]) {
      const legacyId = publicationRowId(table, row)
      mapping.set(key(table, legacyId), { tableName: table, legacyId, centralId: `publication-import-${workbookHash({ entityId, table, legacyId })}` })
    }
  }
  const all = [...mapping.values()]
  const id = publicationMapper(all)
  const origins: PayrollPublicationOrigin[] = []
  const tables = {} as PayrollPublicationGraph['tables']
  for (const table of ['worker_roster_archives', 'payroll_workbook_archives'] as const) {
    tables[table] = source.tables[table].map((row) => {
      const receipts = source.tables[receiptTable(table)].filter(receipt => receipt.archive_id === row.id)
      if (receipts.length !== 1)
        invalid()
      const receipt = receipts[0]!
      const prior = source.origins.find(origin => origin.tableName === table && origin.recordId === row.id)
      if (prior)
        verifyOrigin(prior, row, receipt)
      else provePublicationOriginal(table, row, receipt)
      const mapped = prior
        ? prior.mappings.map((entry) => {
            let previous = entry.centralId
            if (previous && ['worker_roster_receipts', 'payroll_workbook_receipts'].includes(entry.tableName)) {
              const [workspace, actor] = JSON.parse(entry.legacyId) as string[]
              previous = JSON.stringify([workspace, actor, previous])
            }
            return { ...entry, centralId: previous === null ? null : mapping.get(key(entry.tableName, previous))?.centralId ?? null }
          })
        : all
      const base = { tableName: table, recordId: id(table, String(row.id)), sourceRow: prior?.sourceRow ?? row, receiptRow: prior?.receiptRow ?? receipt, mappings: mapped.map(entry => ({ ...entry })), quantity: (prior?.quantity ?? quantity ?? null) as PayrollPublicationOrigin['quantity'] }
      origins.push({ ...base, proofHash: publicationProofHash(base) })
      return mapPublicationArchiveRow(table, base.sourceRow, mapped, base.quantity)
    })
  }
  for (const table of ['worker_roster_receipts', 'payroll_workbook_receipts'] as const)
    tables[table] = source.tables[table].map(row => mapReceipt(table, row, all))
  tables.payroll_workbook_references = source.tables.payroll_workbook_references.map(row => ({ ...row, archive_id: id('payroll_workbook_archives', String(row.archive_id)), record_id: id(String(row.table_name), String(row.record_id)) }))
  return { schemaVersion: 1, tables, origins }
}

export async function insertPayrollPublicationRows(db: TransactionDb, graph: PayrollPublicationGraph | undefined) {
  if (!graph)
    return
  await initialize(db)
  for (const table of PAYROLL_PUBLICATION_TABLES) {
    const columns = PAYROLL_PUBLICATION_COLUMNS[table]
    for (const row of graph.tables[table])
      await db.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
  }
  for (const origin of graph.origins)
    await db.execute('INSERT INTO payroll_publication_migration_proofs VALUES (?,?,?)', [origin.tableName, origin.recordId, JSON.stringify(origin)])
  // Fixed private data must reference its actual immutable version and bytes, not only matching strings in JSON.
  for (const roster of publicationViews(graph).rosters) {
    for (const member of roster.members) {
      if (member.revision !== null && member.revision > 0) {
        const [version] = await db.select<{ values_json: string }>('SELECT values_json FROM worker_roster_profile_versions WHERE worker_id=? AND revision=?', [member.workerId, member.revision])
        if (!version || workbookHash(JSON.parse(version.values_json)) !== workbookHash(member.values))
          invalid()
      }
      const assets = await workerRosterAssets(db, member.workerId)
      for (const photo of member.photos) {
        const { purpose: _purpose, ...asset } = photo
        if (workbookHash(assets.find(row => row.id === photo.id)) !== workbookHash(asset))
          invalid()
      }
    }
  }
}

export async function removePayrollPublicationRows(db: TransactionDb, graph: PayrollPublicationGraph | undefined) {
  if (!graph)
    return
  await initialize(db)
  for (const table of [...PAYROLL_PUBLICATION_TABLES].reverse()) {
    for (const row of graph.tables[table]) {
      if (table.endsWith('_receipts'))
        await db.execute(`DELETE FROM ${table} WHERE workspace_id=? AND actor_id=? AND command_id=?`, [row.workspace_id, row.actor_id, row.command_id])
      else if (table === 'payroll_workbook_references')
        await db.execute('DELETE FROM payroll_workbook_references WHERE archive_id=? AND table_name=? AND record_id=?', [row.archive_id, row.table_name, row.record_id])
      else await db.execute(`DELETE FROM ${table} WHERE id=?`, [row.id])
    }
  }
  for (const origin of graph.origins)
    await db.execute('DELETE FROM payroll_publication_migration_proofs WHERE table_name=? AND record_id=?', [origin.tableName, origin.recordId])
}

export const payrollPublicationFingerprint = (graph: PayrollPublicationGraph | undefined) => graph ? workbookHash({ tables: Object.fromEntries(PAYROLL_PUBLICATION_TABLES.map(table => [table, graph.tables[table].toSorted((a, b) => publicationRowId(table, a).localeCompare(publicationRowId(table, b)))])), origins: graph.origins.toSorted((a, b) => key(a.tableName, a.recordId).localeCompare(key(b.tableName, b.recordId))) }) : null

async function readMigrated(db: TransactionDb, table: PublicationArchiveTable, projectId: string, archiveId: string) {
  const names = await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_publication_migration_proofs\'')
  if (!names.length)
    return null
  const [stored] = await db.select<{ proof_json: string }>('SELECT proof_json FROM payroll_publication_migration_proofs WHERE table_name=? AND record_id=?', [table, archiveId])
  const evidenceRows = await db.select<{ entity_id: string, source_graph_json: string, mapping_json: string }>('SELECT entity_id,source_graph_json,mapping_json FROM payroll_migration_evidence WHERE project_id=?', [projectId])
  const expected = evidenceRows.flatMap((evidence) => {
    const source = parsePayrollProjectGraph(JSON.parse(evidence.source_graph_json))
    const mappings = JSON.parse(evidence.mapping_json) as PayrollIdentityMapping[]
    const projected = mapPayrollPublicationGraph(source.publication, evidence.entity_id, new Map(mappings.map(row => [key(row.tableName, row.legacyId), row])), source.deductions?.quantity)
    return projected?.origins.filter(origin => origin.tableName === table && origin.recordId === archiveId) ?? []
  })
  if (!stored) {
    if (expected.length)
      invalid()
    return null
  }
  const origin = JSON.parse(stored.proof_json) as PayrollPublicationOrigin
  if (origin.tableName !== table || origin.recordId !== archiveId || expected.length !== 1 || workbookHash(expected[0]) !== workbookHash(origin))
    invalid()
  const [row] = await db.select<PayrollMigrationRow>(`SELECT ${PAYROLL_PUBLICATION_COLUMNS[table].join(',')} FROM ${table} WHERE id=? AND project_id=?`, [archiveId, projectId])
  const receipts = await db.select<PayrollMigrationRow>(`SELECT ${PAYROLL_PUBLICATION_COLUMNS[receiptTable(table)].join(',')} FROM ${receiptTable(table)} WHERE archive_id=?`, [archiveId])
  if (!row || receipts.length !== 1)
    invalid()
  const original = verifyOrigin(origin, row, receipts[0]!)
  return { original, mappings: origin.mappings, quantity: origin.quantity }
}
export async function readMigratedPayrollWorkbookArchive(db: TransactionDb, projectId: string, archiveId: string): Promise<PayrollWorkbookArchive | null> {
  const source = await readMigrated(db, 'payroll_workbook_archives', projectId, archiveId)
  return source ? mapWorkbookArchive(source.original as PayrollWorkbookArchive, source.mappings, source.quantity) : null
}
export async function readMigratedWorkerRosterArchive(db: TransactionDb, projectId: string, archiveId: string): Promise<WorkerRosterArchive | null> {
  const source = await readMigrated(db, 'worker_roster_archives', projectId, archiveId)
  return source ? mapRosterArchive(source.original as WorkerRosterArchive, source.mappings) : null
}
export { readPayrollPublicationGraph }
