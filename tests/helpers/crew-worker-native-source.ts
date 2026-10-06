import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { migrations, runMigrations } from '../../app/lib/db/migrations'
import { EMPTY_WORKER_PRIVATE } from '../../app/lib/worker-roster/contract'
import { initializeWorkerRosterSchema, insertWorkerPhoto, rosterHash } from '../../server/utils/worker-roster-storage'
import { createMemoryDb } from './memory-db'

export async function createCrewWorkerNativeSource(receiptScope = { workspaceId: 'native-original-workspace', actorId: 'native-original-actor' }, withLegacyRelatedWorker = false) {
  const db = await createMemoryDb()
  try {
    await runMigrations(db, migrations.filter(row => row.version <= 57))
    await initializeWorkerRosterSchema(db)
    await db.execute('INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,?,?,?)', ['native-project', '原项目名称', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'])
    await db.execute('INSERT INTO crews(id,name,default_pay_ratio,created_at) VALUES (?,?,?,?)', ['native-crew', '原班组', 0, '2026-10-01T00:00:00.000Z'])
    await db.execute('INSERT INTO workers(id,crew_id,name,phone,current_project_id,daily_wage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', ['native-worker', 'native-crew', '原工人', '13800000099', 'native-project', 0, '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'])
    if (withLegacyRelatedWorker) {
      await db.execute('INSERT INTO workers(id,name,created_at,updated_at) VALUES (?,?,?,?)', ['native-linked-worker', '原关联人员', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'])
      await db.execute('UPDATE workers SET linked_worker_id=? WHERE id=?', ['native-linked-worker', 'native-worker'])
    }
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9])
    const photoId = await insertWorkerPhoto(db, 'native-worker', { fileName: 'native-synthetic.png', mimeType: 'image/png', fileSize: bytes.length, payloadBase64: bytes.toString('base64') }, 'native-original-actor', '2026-10-02T00:00:00.000Z')
    const values = { ...EMPTY_WORKER_PRIVATE, portraitId: photoId, laborContractSigned: false }
    await db.execute('INSERT INTO worker_roster_profile_versions VALUES (?,?,?,?,?,NULL)', ['native-worker', 1, JSON.stringify(values), '2026-10-02T00:00:00.000Z', 'native-original-actor'])
    const result = { commandId: 'native-original-private-key', workerId: 'native-worker', archiveId: null, revision: 1 }
    await db.execute('INSERT INTO worker_roster_receipts VALUES (?,?,?,?,?,?,NULL)', [result.commandId, receiptScope.workspaceId, receiptScope.actorId, '1'.repeat(64), JSON.stringify(result), 'native-worker'])
    const profile = { dataOrigin: 'real', id: 'native-worker', crewId: 'native-crew', currentProjectId: 'native-project', name: '原冻结工人姓名', trade: '泥工', phone: '13800000099', idCard: 'synthetic-native-id', projectStatus: '离场', entryDate: '2026-09-01', exitDate: '2026-09-30', safetyEducation: false, status: 'active', updatedAt: '2026-10-02T00:00:00.000Z' }
    const photo = { id: photoId, workerId: 'native-worker', fileName: 'native-synthetic.png', mimeType: 'image/png', fileSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: '2026-10-02T00:00:00.000Z', legacyCategory: null, state: 'available', purpose: 'portrait' }
    const scope = { projectId: 'native-project', statementIds: ['native-frozen-wage'], registeredOn: '2026-10-03' }
    const archive = { context: { workspaceId: 'native-original-workspace', actorId: 'native-original-actor', capabilities: ['worker:sensitive:read', 'payroll:read'], origin: 'real' }, scope, projectName: '原冻结项目名称', sourceVersion: 'native-frozen-proof', members: [{ workerId: 'native-worker', payrollNames: ['原工资冻结姓名'], statementIds: ['native-frozen-wage'], isLeader: false, profile, sourceVersion: 'native-frozen-person-proof', revision: 1, values, photos: [photo], siteStatus: 'left', diagnostics: [] }], diagnostics: ['原日期资料补充版本'], counts: { present: 0, left: 1, notEntered: 0, unknown: 0 }, id: 'native-frozen-roster', version: 1, createdAt: '2026-10-03T00:00:00.000Z', createdBy: 'native-original-actor', evidenceKind: 'dated-supplement' }
    const rawArchive = JSON.stringify(archive)
    await db.execute('INSERT INTO worker_roster_archives VALUES (?,?,?,?,?,?)', [archive.id, scope.projectId, rosterHash(scope), 1, rawArchive, archive.createdAt])
    const snapshot = db.raw.export()
    return { source: { sha256: createHash('sha256').update(snapshot).digest('hex'), payloadBase64: Buffer.from(snapshot).toString('base64') }, bytes, photoId, values, result, rawArchive, archive }
  }
  finally { db.close() }
}
