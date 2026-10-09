import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollWorkbookArchive, PayrollWorkbookArchiveSummary, PayrollWorkbookResolution, PayrollWorkbookResult } from '../../app/lib/payroll/central-workbook-contract'
import type { BusinessSession } from './business-session'
import type { createPayrollService } from './payroll-service'
import type { createWorkerRosterService } from './worker-roster-service'
import { randomUUID } from 'node:crypto'
import { logOperation } from '../../app/lib/db/soft-delete'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { decodePayrollWorkbookRead, encodePayrollWorkbookRead } from '../../app/lib/payroll/workbook-codec'
import { parsePayrollWorkbookCommand, parsePayrollWorkbookInput } from '../../app/lib/payroll/workbook-validation'
import { isStableRouteIdentity } from '../../app/lib/util/stable-route-identity'
import { readMigratedPayrollWorkbookArchive } from './payroll-publication-migration'
import { previewPayrollWorkbook, verifyWorkbookRoster } from './payroll-workbook-preview'
import { completeWorkbookReferences } from './payroll-workbook-references'
import { initializePayrollWorkbookSchema, workbookHash, workbookManifestHash } from './payroll-workbook-storage'

export interface PayrollWorkbookReaders {
  payroll: Pick<ReturnType<typeof createPayrollService>, 'list' | 'numbering' | 'actualLedger'>
  roster: () => Pick<ReturnType<typeof createWorkerRosterService>, 'archive' | 'file'>
}
export interface PayrollWorkbookServiceOptions {
  session: (sessionId?: string | null) => BusinessSession
  transaction: <T>(work: (db: TransactionDb) => Promise<T>, sessionId?: string | null) => Promise<T>
  payroll: (db: TransactionDb, sessionId?: string | null) => PayrollWorkbookReaders['payroll']
  roster: (db: TransactionDb, sessionId?: string | null) => ReturnType<PayrollWorkbookReaders['roster']>
  now?: () => string
  beforeWrite?: () => void
}
interface Receipt { command_id: string, workspace_id: string, actor_id: string, project_id: string, fingerprint: string, command_json: string | null, result_json: string | null, archive_id: string | null }
function authorize(session: BusinessSession, write: boolean) {
  if (!session.capabilities.includes('payroll:read') || (write && !session.capabilities.includes('payroll:write')))
    throw payrollProblem('forbidden', '当前身份没有本项工资归档权限')
}
function context(session: BusinessSession, sourceVersion: string): PayrollWritableContext {
  return { ...session, origin: 'real', readonly: !session.capabilities.includes('payroll:write'), sourceVersion }
}
const inputHash = (archive: PayrollWorkbookArchive) => workbookHash({ input: archive.input, projectName: archive.projectName, groups: archive.groups, gaps: archive.gaps, deliveryGaps: archive.deliveryGaps, issues: archive.issues, rosterRef: archive.rosterRef })
function receiptResult(row: Receipt): PayrollWorkbookResult {
  try {
    const command = parsePayrollWorkbookCommand(JSON.parse(row.command_json!))
    const result: PayrollWorkbookResult = JSON.parse(row.result_json!)
    if (workbookHash(command) !== row.fingerprint || command.workspaceId !== row.workspace_id || command.actorId !== row.actor_id || command.commandId !== row.command_id
      || command.input.projectId !== row.project_id || result.commandId !== row.command_id || result.archiveId !== row.archive_id || !isStableRouteIdentity(result.archiveId)
      || !Number.isSafeInteger(result.version) || result.version < 1 || !/^[a-f0-9]{64}$/.test(result.manifestHash)) {
      throw new Error('receipt')
    }
    return result
  }
  catch { throw payrollProblem('unavailable', '原输出目录回执损坏，不能重复归档') }
}
export async function readPayrollWorkbookArchive(db: TransactionDb, session: BusinessSession, projectId: string, archiveId: string): Promise<PayrollWorkbookArchive> {
  const migrated = await readMigratedPayrollWorkbookArchive(db, projectId, archiveId)
  if (migrated) {
    const current = { ...migrated, context: context(session, migrated.sourceVersion) }
    return decodePayrollWorkbookRead<PayrollWorkbookArchive>(encodePayrollWorkbookRead(current), 'archive', { origin: 'real', projectId }, { projectId, archiveId })
  }
  const [row] = await db.select<{ snapshot_json: string, snapshot_hash: string, version: number, created_at: string, created_by: string }>('SELECT snapshot_json,snapshot_hash,version,created_at,created_by FROM payroll_workbook_archives WHERE id=? AND project_id=?', [archiveId, projectId])
  if (!row)
    throw payrollProblem('not-found', '输出目录不存在或不属于当前项目')
  try {
    const value: PayrollWorkbookArchive = JSON.parse(row.snapshot_json)
    parsePayrollWorkbookInput(value.input)
    if (value.id !== archiveId || value.input.projectId !== projectId || value.version !== row.version || value.createdAt !== row.created_at || value.createdBy !== row.created_by
      || value.schemaVersion !== 1 || value.manifestHash !== row.snapshot_hash || workbookManifestHash(value) !== row.snapshot_hash || inputHash(value) !== value.sourceVersion) {
      throw new Error('snapshot')
    }
    const receipts = await db.select<Receipt>('SELECT * FROM payroll_workbook_receipts WHERE archive_id=?', [archiveId])
    if (receipts.length !== 1)
      throw new Error('owner receipt')
    const original = receipts[0]!
    const result = receiptResult(original)
    const command = parsePayrollWorkbookCommand(JSON.parse(original.command_json!))
    if (result.manifestHash !== value.manifestHash || result.version !== value.version || command.actorId !== value.createdBy || command.sourceVersion !== value.sourceVersion || workbookHash(command.input) !== workbookHash(value.input))
      throw new Error('source')
    const current = { ...value, context: context(session, value.sourceVersion) }
    return decodePayrollWorkbookRead<PayrollWorkbookArchive>(encodePayrollWorkbookRead(current), 'archive', { origin: 'real', projectId }, { projectId, archiveId })
  }
  catch { throw payrollProblem('unavailable', '输出目录、原预览或提交回执不一致，不能作为完整归档读取') }
}
export function createPayrollWorkbookService(options: PayrollWorkbookServiceOptions) {
  async function run<T>(write: boolean, sessionId: string | null | undefined, work: (db: TransactionDb, session: BusinessSession, readers: PayrollWorkbookReaders) => Promise<T>) {
    if (write)
      options.beforeWrite?.()
    return options.transaction(async (db) => {
      const session = structuredClone(options.session(sessionId))
      authorize(session, write)
      await initializePayrollWorkbookSchema(db)
      const readers = { payroll: options.payroll(db, sessionId), roster: () => options.roster(db, sessionId) }
      const result = await work(db, session, readers)
      const latest = options.session(sessionId)
      authorize(latest, write)
      if (workbookHash(latest) !== workbookHash(session))
        throw payrollProblem('forbidden', '处理期间工作区、身份或权限已变化，目录未提交')
      return result
    }, sessionId)
  }
  const queryScope = (query: PayrollQuery, projectId: string) => {
    if (query.origin !== 'real' || !isStableRouteIdentity(projectId) || (query.projectId && query.projectId !== projectId))
      throw payrollProblem('relationship-mismatch', '输出目录项目或来源不一致')
  }
  return {
    workbookPreview(query: PayrollQuery, raw: unknown, sessionId?: string | null) {
      const input = parsePayrollWorkbookInput(raw)
      queryScope(query, input.projectId)
      return run(false, sessionId, (_db, _session, readers) => previewPayrollWorkbook(readers, input))
    },
    workbookArchive(query: PayrollQuery, input: { projectId: string, archiveId: string }, sessionId?: string | null) {
      queryScope(query, input.projectId)
      if (!isStableRouteIdentity(input.archiveId))
        throw payrollProblem('validation-failed', '输出目录身份无效')
      return run(false, sessionId, (db, session) => readPayrollWorkbookArchive(db, session, input.projectId, input.archiveId))
    },
    workbookArchives(query: PayrollQuery, input: { projectId: string }, sessionId?: string | null): Promise<PayrollWorkbookArchiveSummary[]> {
      queryScope(query, input.projectId)
      return run(false, sessionId, async (db, session) => {
        const rows = await db.select<{ id: string }>('SELECT id FROM payroll_workbook_archives WHERE project_id=? ORDER BY created_at DESC,version DESC,id', [input.projectId])
        const result: PayrollWorkbookArchiveSummary[] = []
        for (const row of rows) {
          const value = await readPayrollWorkbookArchive(db, session, input.projectId, row.id)
          result.push({ id: value.id, version: value.version, mode: value.input.mode, projectId: value.input.projectId, statementIds: value.input.statementIds, createdAt: value.createdAt, completeness: value.completeness, rosterRef: value.rosterRef })
        }
        return result
      })
    },
    executeWorkbook(raw: unknown, sessionId?: string | null): Promise<PayrollWorkbookResult> {
      const command = parsePayrollWorkbookCommand(raw)
      return run(true, sessionId, async (db, session, readers) => {
        if (command.workspaceId !== session.workspaceId || command.actorId !== session.actorId)
          throw payrollProblem('forbidden', '输出目录提交与当前工作区或身份不一致')
        const [prior] = await db.select<Receipt>('SELECT * FROM payroll_workbook_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [session.workspaceId, session.actorId, command.commandId])
        if (prior) {
          if (prior.fingerprint !== workbookHash(command))
            throw payrollProblem('conflict', '原提交已经确认未执行或正文不同，不能另建输出目录')
          const result = receiptResult(prior)
          await readPayrollWorkbookArchive(db, session, command.input.projectId, result.archiveId)
          return result
        }
        const preview = await previewPayrollWorkbook(readers, command.input)
        if (preview.sourceVersion !== command.sourceVersion)
          throw payrollProblem('stale-source', '预览中的工资、编号、实际收付或名册已变化，请保留选择重新核对')
        if (!preview.eligibility.canSave)
          throw payrollProblem('validation-failed', preview.eligibility.reasons.join('；'))
        const scopeKey = workbookHash({ ...command.input, rosterArchiveId: null })
        const [last] = await db.select<{ version: number | null }>('SELECT MAX(version) AS version FROM payroll_workbook_archives WHERE scope_key=?', [scopeKey])
        const archive: PayrollWorkbookArchive = { context: preview.context, schemaVersion: 1, id: `payroll-workbook-${randomUUID()}`, version: (last?.version ?? 0) + 1, createdAt: options.now?.() ?? new Date().toISOString(), createdBy: session.actorId, sourceVersion: preview.sourceVersion, input: preview.input, projectName: preview.projectName, groups: preview.groups, gaps: preview.gaps, deliveryGaps: preview.deliveryGaps, issues: preview.issues, rosterRef: preview.rosterRef, manifestHash: '', completeness: preview.gaps.length || preview.deliveryGaps.length ? 'partial' : 'complete' }
        archive.manifestHash = workbookManifestHash(archive)
        const rosterRead = await verifyWorkbookRoster(readers, command.input, archive.rosterRef)
        await db.execute('INSERT INTO payroll_workbook_archives(id,project_id,scope_key,version,snapshot_json,snapshot_hash,created_at,created_by,migration_batch_id) VALUES (?,?,?,?,?,?,?,?,NULL)', [archive.id, archive.input.projectId, scopeKey, archive.version, payrollCanonical(archive), archive.manifestHash, archive.createdAt, archive.createdBy])
        const result: PayrollWorkbookResult = { commandId: command.commandId, archiveId: archive.id, version: archive.version, manifestHash: archive.manifestHash }
        await db.execute('INSERT INTO payroll_workbook_receipts(command_id,workspace_id,actor_id,project_id,fingerprint,command_json,result_json,archive_id) VALUES (?,?,?,?,?,?,?,?)', [command.commandId, session.workspaceId, session.actorId, command.input.projectId, workbookHash(command), payrollCanonical(command), payrollCanonical(result), archive.id])
        for (const ref of await completeWorkbookReferences(db, archive, rosterRead?.archive))
          await db.execute('INSERT INTO payroll_workbook_references(archive_id,table_name,record_id) VALUES (?,?,?)', [archive.id, ref.tableName, ref.recordId])
        await logOperation(db, { table: 'payroll_workbook_archives', recordId: archive.id, action: 'create', after: { version: archive.version, manifestHash: archive.manifestHash }, operator: session.actorId })
        return result
      })
    },
    resolveWorkbook(commandId: string, projectId: string, sessionId?: string | null): Promise<PayrollWorkbookResolution> {
      if (!isStableRouteIdentity(commandId) || !isStableRouteIdentity(projectId))
        throw payrollProblem('validation-failed', '原提交或项目身份无效')
      return run(true, sessionId, async (db, session) => {
        const [row] = await db.select<Receipt>('SELECT * FROM payroll_workbook_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [session.workspaceId, session.actorId, commandId])
        if (row) {
          if (row.project_id !== projectId)
            throw payrollProblem('relationship-mismatch', '原提交不属于当前项目')
          if (row.fingerprint === 'cancelled')
            return { state: 'not-applied' }
          const result = receiptResult(row)
          await readPayrollWorkbookArchive(db, session, projectId, result.archiveId)
          return { state: 'applied', result }
        }
        await db.execute('INSERT INTO payroll_workbook_receipts(command_id,workspace_id,actor_id,project_id,fingerprint) VALUES (?,?,?,?,\'cancelled\')', [commandId, session.workspaceId, session.actorId, projectId])
        return { state: 'not-applied' }
      })
    },
  }
}
