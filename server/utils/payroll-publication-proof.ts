import type { PayrollPublicationOrigin, PublicationArchiveTable } from '../../app/lib/migration/payroll-publication-source'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { PayrollWorkbookArchive } from '../../app/lib/payroll/central-workbook-contract'
import type { QuantityHollowMigrationGraph } from '../../app/lib/quantity/hollow-migration-contract'
import type { WorkerRosterArchive } from '../../app/lib/worker-roster/contract'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { decodePayrollWorkbookRead, encodePayrollWorkbookRead } from '../../app/lib/payroll/workbook-codec'
import { payrollWorkbookSubjectKey } from '../../app/lib/payroll/workbook-subject'
import { parsePayrollWorkbookCommand } from '../../app/lib/payroll/workbook-validation'
import { decodeRosterArchive } from '../../app/lib/worker-roster/codec'
import { createPayrollMigratedMapper } from './payroll-migrated-mapping'
import { workbookHash, workbookManifestHash } from './payroll-workbook-storage'
import { rosterHash } from './worker-roster-storage'

function invalid(): never {
  throw payrollProblem('unavailable', '固定目录或名册的原件、回执、映射证明不一致')
}
const key = (table: string, id: string) => JSON.stringify([table, id])
export function publicationMapper(mappings: PayrollIdentityMapping[]) {
  const indexed = new Map(mappings.map(row => [key(row.tableName, row.legacyId), row.centralId]))
  if (indexed.size !== mappings.length)
    invalid()
  return (table: string, id: string): string => indexed.get(key(table, id)) || invalid()
}
export function publicationProofHash(origin: Omit<PayrollPublicationOrigin, 'proofHash'> | PayrollPublicationOrigin) {
  return workbookHash(Object.fromEntries(Object.entries(origin).filter(([field]) => field !== 'proofHash')))
}

/** Validate the native original before any projection; source-provided migration metadata has no authority. */
export function provePublicationOriginal(table: PublicationArchiveTable, row: PayrollMigrationRow, receipt: PayrollMigrationRow): WorkerRosterArchive | PayrollWorkbookArchive {
  try {
    const value = JSON.parse(String(row.snapshot_json))
    const result = JSON.parse(String(receipt.result_json))
    if (value.migration !== undefined || value.id !== row.id || value.version !== row.version || value.createdAt !== row.created_at || value.createdBy !== receipt.actor_id
      || result.commandId !== receipt.command_id || result.archiveId !== row.id || receipt.archive_id !== row.id || !/^[a-f0-9]{64}$/.test(String(receipt.fingerprint))) {
      invalid()
    }
    if (table === 'worker_roster_archives') {
      if (result.workerId !== null || result.revision !== row.version || receipt.worker_id !== null)
        invalid()
      const archive = decodeRosterArchive(value, String(row.project_id), String(row.id))
      const command = { commandId: receipt.command_id, workspaceId: receipt.workspace_id, actorId: receipt.actor_id, origin: 'real', action: 'archive', scope: archive.scope, sourceVersion: archive.sourceVersion }
      if (rosterHash(command) !== receipt.fingerprint || rosterHash({ projectId: archive.scope.projectId, statementIds: archive.scope.statementIds }) !== row.scope_key)
        invalid()
      return archive
    }
    const archive = decodePayrollWorkbookRead<PayrollWorkbookArchive>(encodePayrollWorkbookRead(value), 'archive', { origin: 'real', projectId: String(row.project_id) }, { projectId: String(row.project_id), archiveId: String(row.id) })
    const command = parsePayrollWorkbookCommand(JSON.parse(String(receipt.command_json)))
    if (workbookHash(command) !== receipt.fingerprint || command.workspaceId !== receipt.workspace_id || command.actorId !== receipt.actor_id || command.commandId !== receipt.command_id
      || command.input.projectId !== row.project_id || receipt.project_id !== row.project_id || command.sourceVersion !== archive.sourceVersion || workbookHash(command.input) !== workbookHash(archive.input)
      || archive.createdBy !== row.created_by || archive.manifestHash !== row.snapshot_hash || workbookManifestHash(archive) !== row.snapshot_hash || result.manifestHash !== row.snapshot_hash || result.version !== row.version
      || workbookHash({ input: archive.input, projectName: archive.projectName, groups: archive.groups, gaps: archive.gaps, deliveryGaps: archive.deliveryGaps, issues: archive.issues, rosterRef: archive.rosterRef }) !== archive.sourceVersion) {
      invalid()
    }
    return archive
  }
  catch { return invalid() }
}

export function mapRosterArchive(original: WorkerRosterArchive, mappings: PayrollIdentityMapping[]): WorkerRosterArchive {
  const id = publicationMapper(mappings)
  const maybe = (table: string, value: string | null) => value === null ? null : id(table, value)
  const { context: _context, ...body } = original
  return {
    ...original,
    id: id('worker_roster_archives', original.id),
    scope: { ...original.scope, projectId: id('projects', original.scope.projectId), statementIds: original.scope.statementIds.map(value => id('wage_statements', value)).sort() },
    members: original.members.map(member => ({
      ...member,
      workerId: id('workers', member.workerId),
      statementIds: member.statementIds.map(value => id('wage_statements', value)).sort(),
      profile: member.profile ? { ...member.profile, id: id('workers', member.profile.id), crewId: maybe('crews', member.profile.crewId), currentProjectId: maybe('projects', member.profile.currentProjectId) } : null,
      values: { ...member.values, portraitId: maybe('worker_roster_assets', member.values.portraitId), bankCardId: maybe('worker_roster_assets', member.values.bankCardId) },
      photos: member.photos.map(photo => ({ ...photo, id: id('worker_roster_assets', photo.id), workerId: id('workers', photo.workerId) })),
    })),
    migration: { originalId: original.id, originalContentHash: workbookHash(body) },
  }
}

export function mapWorkbookArchive(original: PayrollWorkbookArchive, mappings: PayrollIdentityMapping[], quantity?: QuantityHollowMigrationGraph | null): PayrollWorkbookArchive {
  const id = publicationMapper(mappings)
  const maybe = (table: string, value: string | null) => value === null ? null : id(table, value)
  const mapper = createPayrollMigratedMapper(mappings, quantity ?? undefined)
  const book = (value: NonNullable<PayrollWorkbookArchive['groups'][number]['entries'][number]['row']['book']>) => value.bookPurpose === 'ordinary' ? value : { ...value, managementBookId: id('payroll_a_management_books', value.managementBookId) }
  return {
    ...original,
    id: id('payroll_workbook_archives', original.id),
    input: { ...original.input, projectId: id('projects', original.input.projectId), statementIds: original.input.statementIds.map(value => id('wage_statements', value)).sort(), rosterArchiveId: maybe('worker_roster_archives', original.input.rosterArchiveId) },
    rosterRef: original.rosterRef ? { ...original.rosterRef, id: id('worker_roster_archives', original.rosterRef.id) } : null,
    groups: original.groups.map(group => ({
      ...group,
      key: original.input.mode === 'leader-cycle' ? payrollWorkbookSubjectKey({ ...group.entries[0]!.row, projectId: id('projects', group.entries[0]!.row.projectId), leaderWorkerId: id('workers', group.entries[0]!.row.leaderWorkerId), ...(group.entries[0]!.row.book ? { book: book(group.entries[0]!.row.book) } : {}) }) : group.key,
      entries: group.entries.map(entry => ({
        row: { ...entry.row, id: id('wage_statements', entry.row.id), projectId: id('projects', entry.row.projectId), crewId: maybe('crews', entry.row.crewId), leaderWorkerId: id('workers', entry.row.leaderWorkerId), subjectConfigId: maybe('payroll_subject_configs', entry.row.subjectConfigId), ...(entry.row.book ? { book: book(entry.row.book) } : {}) },
        document: entry.document.formatFamily === 'A' ? mapper.aDocument(entry.document) : entry.document.formatFamily === 'C1' ? mapper.c1Document(entry.document) : mapper.c2Document(entry.document),
      })),
      actualLedger: { ...group.actualLedger, scope: { ...group.actualLedger.scope, projectId: id('projects', group.actualLedger.scope.projectId), ...(group.actualLedger.scope.originalStatementIds ? { originalStatementIds: group.actualLedger.scope.originalStatementIds.map(value => id('wage_statements', value)) } : {}) }, rows: group.actualLedger.rows.map(mapper.fact) },
    })),
    issues: original.issues.map(issue => ({ ...issue, id: id('payroll_official_issues', issue.id), projectId: id('projects', issue.projectId), statementId: id('wage_statements', issue.statementId), commandId: id('payroll_command_receipts', issue.commandId) })),
    gaps: original.gaps.map(gap => ({ ...gap, statementId: id('wage_statements', gap.statementId) })),
    deliveryGaps: original.deliveryGaps.map(gap => ({ ...gap, statementId: maybe('wage_statements', gap.statementId) })),
    migration: { originalId: original.id, originalContentHash: original.manifestHash },
  }
}

export function mapPublicationArchiveRow(table: PublicationArchiveTable, row: PayrollMigrationRow, mappings: PayrollIdentityMapping[], quantity?: QuantityHollowMigrationGraph | null): PayrollMigrationRow {
  const id = publicationMapper(mappings)
  const original = JSON.parse(String(row.snapshot_json))
  const mapped = table === 'worker_roster_archives' ? mapRosterArchive(original, mappings) : mapWorkbookArchive(original, mappings, quantity)
  const scope = 'scope' in mapped ? { projectId: mapped.scope.projectId, statementIds: mapped.scope.statementIds } : { ...mapped.input, rosterArchiveId: null }
  return { ...row, id: id(table, String(row.id)), project_id: id('projects', String(row.project_id)), scope_key: workbookHash(scope) }
}
