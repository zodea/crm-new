import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollPublicationGraph } from '../../app/lib/migration/payroll-publication-source'
import type { PayrollRemovedIdentities, planPayrollMigration } from './payroll-migration'
import { PAYROLL_PUBLICATION_TABLES, publicationRowId, readPayrollPublicationGraph } from '../../app/lib/migration/payroll-publication-source'
import { PAYROLL_MIGRATION_PARTS, PAYROLL_MIGRATION_TABLES } from '../../app/lib/migration/payroll-source'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollCentralGraphKeys } from './payroll-central-migration'
import { payrollFeesGraphKeys } from './payroll-fees-migration'
import { payrollHollowGraphKeys } from './payroll-hollow-migration'
import { payrollNumberingGraphKeys } from './payroll-numbering-migration'
import { payrollPublicationFingerprint, publicationViews, removePayrollPublicationRows } from './payroll-publication-migration'
import { completeWorkbookReferences } from './payroll-workbook-references'
import { workbookHash } from './payroll-workbook-storage'

const key = (table: string, id: unknown) => JSON.stringify([table, id])
function invalid(): never {
  throw payrollProblem('conflict', '固定目录、名册或原件已有独立引用或被改写，危险恢复已整批拒绝')
}

/** Validate and remove owned immutable publications in the candidate transaction, before worker guards run. */
export async function preparePayrollPublicationRemoval(db: TransactionDb, plan: ReturnType<typeof planPayrollMigration>, removed: PayrollRemovedIdentities) {
  const current = await readPayrollPublicationGraph(db)
  if (!current)
    return
  const owned = new Set(plan.removed.flatMap(previous => previous.graph.publication ? PAYROLL_PUBLICATION_TABLES.flatMap(table => previous.graph.publication!.tables[table].map(row => key(table, publicationRowId(table, row)))) : []))
  const removedKeys = new Set([
    ...owned,
    ...plan.removed.flatMap(previous => [...PAYROLL_MIGRATION_PARTS.flatMap(part => previous.graph[part].map(row => key(PAYROLL_MIGRATION_TABLES[part], row.id))), ...payrollCentralGraphKeys(previous.graph.central), ...payrollFeesGraphKeys(previous.graph.fees), ...payrollHollowGraphKeys(previous.graph.deductions), ...payrollNumberingGraphKeys(previous.graph.numbering)]),
    ...(['projects', 'crews', 'workers'] as const).flatMap(table => [...removed[table]].map(id => key(table, id))),
    ...removed.quantity.map(row => key(row.table, row.id)),
  ])
  const assets = await db.select<{ id: string, worker_id: string, file_ref_id: string }>('SELECT id,worker_id,file_ref_id FROM worker_roster_assets')
  for (const asset of assets.filter(row => removed.workers.has(row.worker_id))) {
    removedKeys.add(key('worker_roster_assets', asset.id))
    removedKeys.add(key('file_refs', asset.file_ref_id))
  }
  if (!removedKeys.size)
    return
  for (const previous of plan.removed) {
    const expected = previous.graph.publication
    if (!expected)
      continue
    const actual: PayrollPublicationGraph = { schemaVersion: 1, tables: Object.fromEntries(PAYROLL_PUBLICATION_TABLES.map(table => [table, current.tables[table].filter(row => expected.tables[table].some(old => publicationRowId(table, old) === publicationRowId(table, row)))])) as PayrollPublicationGraph['tables'], origins: current.origins.filter(origin => expected.origins.some(old => old.tableName === origin.tableName && old.recordId === origin.recordId)) }
    if (payrollPublicationFingerprint(actual) !== payrollPublicationFingerprint(expected))
      invalid()
  }
  const { rosters, workbooks } = publicationViews(current)
  for (const workbook of workbooks) {
    const refs = await completeWorkbookReferences(db, workbook, rosters.find(roster => roster.id === workbook.rosterRef?.id))
    const stored = current.tables.payroll_workbook_references.filter(row => row.archive_id === workbook.id).map(row => ({ tableName: String(row.table_name), recordId: String(row.record_id) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    if (workbookHash(refs) !== workbookHash(stored))
      invalid()
    if (!owned.has(key('payroll_workbook_archives', workbook.id)) && refs.some(ref => removedKeys.has(key(ref.tableName, ref.recordId))))
      invalid()
  }
  for (const roster of rosters) {
    if (owned.has(key('worker_roster_archives', roster.id)))
      continue
    if (removedKeys.has(key('projects', roster.scope.projectId)) || roster.scope.statementIds.some(id => removedKeys.has(key('wage_statements', id)))
      || roster.members.some(member => removedKeys.has(key('workers', member.workerId)) || member.photos.some(photo => removedKeys.has(key('worker_roster_assets', photo.id))))) {
      invalid()
    }
  }
  for (const receipt of current.tables.payroll_workbook_receipts) {
    if (!owned.has(key('payroll_workbook_receipts', publicationRowId('payroll_workbook_receipts', receipt))) && removedKeys.has(key('projects', receipt.project_id)))
      invalid()
  }
  const logs = await db.select<{ id: string, table_name: string, record_id: string }>('SELECT id,table_name,record_id FROM operation_logs')
  if (logs.some(log => ['worker_roster_archives', 'payroll_workbook_archives'].includes(log.table_name) && removedKeys.has(key(log.table_name, log.record_id)) && !removedKeys.has(key('operation_logs', log.id))))
    invalid()
  for (const previous of plan.removed)
    await removePayrollPublicationRows(db, previous.graph.publication)
}
