import type { CoreMigrationSourceDTO } from '../../app/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createPayrollService } from '../../server/utils/payroll-service'
import { payrollWorkbookService } from '../../server/utils/payroll-workbook-runtime'
import { createPayrollWorkbookService } from '../../server/utils/payroll-workbook-service'
import { workbookHash, workbookManifestHash } from '../../server/utils/payroll-workbook-storage'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { workerRosterRuntimeOptions } from '../../server/utils/worker-roster-runtime'
import { createWorkerRosterService } from '../../server/utils/worker-roster-service'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'
import { numberingCommand } from '../helpers/payroll-numbering-fixture'
import { createPayrollWorkbookFixture } from '../helpers/payroll-workbook-fixture'
import { cloneQuantityHollowSnapshot } from '../helpers/quantity-hollow-migration-fixture'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})
async function migrate(source: CoreMigrationSourceDTO, bytes: Uint8Array) {
  const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
  await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('publication-preflight'), source, backup: null }), session)
  const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('publication-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: new Date().toISOString(), immutable: true } }), session)
  expect(batch.issues.filter(row => row.metricKey === 'apply-failed')).toEqual([])
  await coreMigrationTestInstance.importBatch({ ...envelope('publication-import'), batchId: batch.batchId }, session)
  await coreMigrationTestInstance.confirm({ ...envelope('publication-confirm'), batchId: batch.batchId }, session)
  return batch
}

it('真实工资正式128号、固定名册六张原件与保存目录一起迁入，原JSON及摘要保留', async () => {
  const f = await createPayrollWorkbookFixture()
  try {
    f.input.mode = 'leader-cycle'
    await f.db.execute('INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,snapshot_json) VALUES (?,?,?,?,?,?,?,?,NULL)', ['old-missing-c1', 'other-project', 'outside', '2026-07', 'C1', 'field', 'released', 100])
    const roster = await f.prepareRoster()
    const saved = await f.archive.executeWorkbook(f.command(await f.preview()))
    const original = await f.archive.workbookArchive({ origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })
    const source = await readQuantityCoreSource(f.db)
    const graph = JSON.parse(String(source.entities.payroll_projects!.find(row => row.legacyId === 'p')!.attributes!.payrollGraphJson))
    expect(graph.schemaVersion).toBe(6)
    expect(graph.publication.tables.worker_roster_archives).toHaveLength(1)
    expect(graph.publication.tables.payroll_workbook_archives).toHaveLength(1)
    expect(source.entities.workers!.filter(row => row.attributes?.workerRosterGraphJson)).toHaveLength(3)
    const batch = await migrate(source, f.db.raw.export())
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'p')!.serverId
    const [evidence] = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ mapping_json: string }>('SELECT mapping_json FROM payroll_migration_evidence WHERE project_id=?', [projectId]))
    const mappings: Array<{ tableName: string, legacyId: string, centralId: string }> = JSON.parse(evidence!.mapping_json)
    const mapped = (table: string, id: string) => mappings.find(row => row.tableName === table && row.legacyId === id)!.centralId
    const archiveId = mapped('payroll_workbook_archives', saved.archiveId)
    const read = await payrollWorkbookService.workbookArchive({ origin: 'real' }, { projectId, archiveId })
    expect(read).toMatchObject({ manifestHash: original.manifestHash, sourceVersion: original.sourceVersion, migration: { originalId: saved.archiveId } })
    expect(read.issues[0]!.number).toBe('128')
    expect(read.groups[0]!.entries[0]!.document.actualAmount).toBe(525)
    const privateService = createWorkerRosterService({ ...workerRosterRuntimeOptions, session: () => ({ ...session, capabilities: [...session.capabilities, 'worker:sensitive:read'] }) })
    const migratedRoster = await privateService.archive(projectId, mapped('worker_roster_archives', roster.id))
    expect(migratedRoster.members).toHaveLength(3)
    expect(migratedRoster.migration?.originalContentHash).toBe(original.rosterRef!.contentHash)
    for (const member of migratedRoster.members) {
      expect(member.photos).toHaveLength(2)
      for (const photo of member.photos) {
        const file = await privateService.file({ projectId, archiveId: migratedRoster.id, workerId: member.workerId, assetId: photo.id })
        expect(file.asset.sha256).toBe(photo.sha256)
        expect(file.payloadBase64).toContain('iVBOR')
      }
    }
    const physical = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM payroll_workbook_archives WHERE id=?', [archiveId]))
    expect(physical[0]!.snapshot_json).toBe(graph.publication.tables.payroll_workbook_archives[0].snapshot_json)
    const repeated = await quantityTestInstance.prepareMigrationSnapshot(coreMigrationTestInstance.snapshot(session))
    repeated.commit()
    expect((await payrollWorkbookService.workbookArchive({ origin: 'real' }, { projectId, archiveId })).manifestHash).toBe(original.manifestHash)
    const clone = await cloneQuantityHollowSnapshot(await quantityTestInstance.exportSnapshotBytes())
    const secondSource = await readQuantityCoreSource(clone)
    const secondBytes = clone.raw.export()
    clone.close()
    await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      await tx.execute('INSERT INTO workers(id,name) VALUES (?,?)', ['unrelated-worker', '独立其他工人'])
      await tx.execute('INSERT INTO worker_roster_profile_versions(worker_id,revision,values_json,created_at,actor_id,migration_batch_id) VALUES (?,1,?,?,?,NULL)', ['unrelated-worker', JSON.stringify({ laborContractSigned: false, laborContractSignedOn: null, portraitId: null, bankCardId: null }), '2026-09-22T01:00:00.000Z', session.actorId])
    })
    await coreMigrationTestInstance.rollback({ ...envelope('publication-rollback'), batchId: batch.batchId }, session)
    expect(await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT * FROM payroll_workbook_archives'))).toHaveLength(0)
    expect(await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT * FROM worker_roster_profile_versions WHERE worker_id=?', ['unrelated-worker']))).toHaveLength(1)
    await quantityTestInstance.reset()
    await coreMigrationTestInstance.reset(session.workspaceId)
    const second = await migrate(secondSource, secondBytes)
    const secondProjectId = second.mappings.find(row => row.entityType === 'projects' && row.legacyId === projectId)!.serverId
    const [next] = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ id: string, snapshot_json: string }>('SELECT id,snapshot_json FROM payroll_workbook_archives WHERE project_id=?', [secondProjectId]))
    const nextRead = await payrollWorkbookService.workbookArchive({ origin: 'real' }, { projectId: secondProjectId, archiveId: next!.id })
    expect(nextRead.manifestHash).toBe(original.manifestHash)
    expect(nextRead.migration?.originalId).toBe(saved.archiveId)
    expect(next!.snapshot_json).toBe(physical[0]!.snapshot_json)
    expect(nextRead.groups[0]!.entries[0]!.document.actualAmount).toBe(525)
    await coreMigrationTestInstance.rollback({ ...envelope('second-publication-rollback'), batchId: second.batchId }, session)
  }
  finally { await f.close() }
}, 30_000)

it.each(['photo-bytes', 'private-version', 'proof-registry'] as const)('迁入后 %s 被改写时读取或危险恢复拒绝且整库不变', async (kind) => {
  const f = await createPayrollWorkbookFixture()
  try {
    await f.prepareRoster()
    await f.archive.executeWorkbook(f.command(await f.preview()))
    const batch = await migrate(await readQuantityCoreSource(f.db), f.db.raw.export())
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'p')!.serverId
    await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      if (kind === 'photo-bytes')
        await tx.execute('UPDATE file_payloads SET content=? WHERE file_ref_id=(SELECT file_ref_id FROM worker_roster_assets LIMIT 1)', ['AQID'])
      else if (kind === 'private-version')
        await tx.execute('UPDATE worker_roster_profile_versions SET values_json=? WHERE worker_id=(SELECT worker_id FROM worker_roster_profile_versions LIMIT 1)', [JSON.stringify({ laborContractSigned: true, laborContractSignedOn: '2026-09-22', portraitId: null, bankCardId: null })])
      else await tx.execute('DELETE FROM payroll_publication_migration_proofs WHERE table_name=\'payroll_workbook_archives\'')
    })
    if (kind === 'proof-registry') {
      const [row] = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ id: string }>('SELECT id FROM payroll_workbook_archives WHERE project_id=?', [projectId]))
      await expect(payrollWorkbookService.workbookArchive({ origin: 'real' }, { projectId, archiveId: row!.id })).rejects.toBeDefined()
    }
    const before = workbookHash(Array.from(await quantityTestInstance.exportSnapshotBytes()))
    await expect(coreMigrationTestInstance.rollback({ ...envelope(`tampered-${kind}-rollback`), batchId: batch.batchId }, session)).rejects.toBeDefined()
    expect(workbookHash(Array.from(await quantityTestInstance.exportSnapshotBytes()))).toBe(before)
  }
  finally { await f.close() }
}, 30_000)

it('迁入后独立保存的目录保留零成员引用，危险恢复失败不改任何库正文', async () => {
  const f = await createPayrollWorkbookFixture()
  try {
    await f.prepareRoster()
    await f.archive.executeWorkbook(f.command(await f.preview()))
    const batch = await migrate(await readQuantityCoreSource(f.db), f.db.raw.export())
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'p')!.serverId
    const [row] = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ id: string }>('SELECT id FROM payroll_workbook_archives WHERE project_id=?', [projectId]))
    const original = await payrollWorkbookService.workbookArchive({ origin: 'real' }, { projectId, archiveId: row!.id })
    const preview = await payrollWorkbookService.workbookPreview({ origin: 'real' }, { ...original.input, rosterArchiveId: null, mode: 'leader-cycle' })
    const saved = await payrollWorkbookService.executeWorkbook(f.command(preview, 'independent-directory'))
    const refs = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ record_id: string }>('SELECT record_id FROM payroll_workbook_references WHERE archive_id=? AND table_name=\'workers\'', [saved.archiveId]))
    const zero = batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'zero')!.serverId
    expect(refs.some(row => row.record_id === zero)).toBe(true)
    const before = workbookHash(Array.from(await quantityTestInstance.exportSnapshotBytes()))
    await expect(coreMigrationTestInstance.rollback({ ...envelope('blocked-directory-rollback'), batchId: batch.batchId }, session)).rejects.toBeDefined()
    expect(workbookHash(Array.from(await quantityTestInstance.exportSnapshotBytes()))).toBe(before)
    expect((await payrollWorkbookService.workbookArchive({ origin: 'real' }, { projectId, archiveId: saved.archiveId })).groups[0]!.entries[0]!.document.actualAmount).toBe(525)
  }
  finally { await f.close() }
}, 30_000)

it.each(['roster-command', 'roster-reference', 'actual-fact', 'actual-omitted'] as const)('损坏 %s 即使目录自身摘要一致也拒绝整图接管', async (kind) => {
  const f = await createPayrollWorkbookFixture()
  try {
    await f.prepareRoster()
    const saved = await f.archive.executeWorkbook(f.command(await f.preview()))
    if (kind === 'roster-command') {
      await f.db.execute('UPDATE worker_roster_receipts SET fingerprint=? WHERE archive_id IS NOT NULL', ['a'.repeat(64)])
    }
    else {
      const [stored] = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM payroll_workbook_archives WHERE id=?', [saved.archiveId])
      const archive = JSON.parse(stored!.snapshot_json)
      if (kind === 'roster-reference') {
        archive.rosterRef.contentHash = 'b'.repeat(64)
      }
      else if (kind === 'actual-omitted') {
        archive.groups[0].actualLedger.rows = []
        archive.groups[0].actualLedger.netAmount.value = 0
        archive.groups[0].actualLedger.netAmount.knownValue = 0
      }
      else {
        const ledger = archive.groups[0].actualLedger
        ledger.rows[0].signedAmount.value = 526
        ledger.rows[0].signedAmount.knownValue = 526
        ledger.rows[0].allocations[0].amount += 1
        ledger.netAmount.value = 526
        ledger.netAmount.knownValue = 526
      }
      archive.sourceVersion = workbookHash({ input: archive.input, projectName: archive.projectName, groups: archive.groups, gaps: archive.gaps, deliveryGaps: archive.deliveryGaps, issues: archive.issues, rosterRef: archive.rosterRef })
      archive.manifestHash = workbookManifestHash(archive)
      await f.db.execute('UPDATE payroll_workbook_archives SET snapshot_json=?,snapshot_hash=? WHERE id=?', [JSON.stringify(archive), archive.manifestHash, saved.archiveId])
      const [receipt] = await f.db.select<{ command_json: string, result_json: string }>('SELECT command_json,result_json FROM payroll_workbook_receipts WHERE archive_id=?', [saved.archiveId])
      const command = { ...JSON.parse(receipt!.command_json), sourceVersion: archive.sourceVersion }
      const result = { ...JSON.parse(receipt!.result_json), manifestHash: archive.manifestHash }
      await f.db.execute('UPDATE payroll_workbook_receipts SET command_json=?,fingerprint=?,result_json=? WHERE archive_id=?', [JSON.stringify(command), workbookHash(command), JSON.stringify(result), saved.archiveId])
    }
    await expect(migrate(await readQuantityCoreSource(f.db), f.db.raw.export())).rejects.toBeDefined()
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
  }
  finally { await f.close() }
}, 30_000)

it('归档后新增真实退款和两层冲销不污染旧账前缀，全部原事件随完整图迁入', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const actor = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] }
    const service = createPayrollWorkbookService({ session: () => actor, transaction: work => f.withTransaction(work), payroll: db => createPayrollService({ session: () => actor, identities: () => f.source, transaction: work => work(db, actor) }), roster: () => {
      throw new Error('未选名册')
    } })
    const input = { projectId: 'p', mode: 'leader-cycle' as const, statementIds: [f.statementId], rosterArchiveId: null }
    const numbered = () => f.service.numbering({ origin: 'real' }, { projectId: 'p', statementId: f.statementId })
    await f.service.executeNumbering(numberingCommand(await numbered(), 'start', { kind: 'initialize', nextNumber: 1, evidenceNote: '已核对纸质旧号' }))
    await f.service.executeNumbering(numberingCommand(await numbered(), 'issue', { kind: 'issue' }))
    const save = async (commandId: string) => {
      const read = await service.workbookPreview({ origin: 'real' }, input)
      return service.executeWorkbook({ schemaVersion: 1, commandId, workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.sourceVersion, input, action: 'archive' })
    }
    await save('before-refund')
    const correction = await f.correct(900)
    const refund = await f.refund(correction.adjustment.id, 40)
    await save('after-refund')
    async function reverse(eventId: string, key: string) {
      const target = { kind: 'recording-reversal' as const, draftKey: key, original: { kind: 'actual-event' as const, eventId } }
      const draft = { confirmedNotOccurred: true, confirmedOn: '2026-09-06', evidenceNote: '核查仅错记，追加冲销不抹原账' }
      const read = await f.service.actualReversalForm({ origin: 'real' }, { target, draft })
      return f.service.executeAdjustment({ commandId: key, workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-recording-reversal', reversal: draft } })
    }
    const first = await reverse(refund.actualEventId!, 'reverse-once')
    await reverse(first.actualEventId!, 'reverse-twice')
    const batch = await migrate(await readQuantityCoreSource(f.db), f.db.raw.export())
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'p')!.serverId
    const history = await payrollWorkbookService.workbookArchives({ origin: 'real' }, { projectId })
    const totals = []
    for (const entry of history) {
      const archive = await payrollWorkbookService.workbookArchive({ origin: 'real' }, { projectId, archiveId: entry.id })
      totals.push(archive.groups[0]!.actualLedger.netAmount.value)
    }
    expect(totals.sort()).toEqual([1000, 960])
    expect(await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT id FROM payroll_actual_events'))).toHaveLength(3)
  }
  finally { await f.close() }
}, 30_000)
