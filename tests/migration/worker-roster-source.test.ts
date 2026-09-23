import { afterEach, expect, it, vi } from 'vitest'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { demoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { workerRosterService } from '../../server/utils/worker-roster-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { importPayrollC2MigrationSource, seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
  vi.restoreAllMocks()
})
async function fixture() {
  vi.spyOn(demoWorkspaceTestInstance, 'capabilities').mockImplementation(() => [...resolveBusinessSession().capabilities, 'worker:sensitive:read'])
  const db = await createMemoryDb()
  try {
    await seedPayrollC2MigrationSource(db)
    await db.execute('UPDATE workers SET gender=?,hometown=?,id_card=?,bank_name=?,bank_account=?,entry_date=?,exit_date=? WHERE id=?', ['女', '广东', '440000199001010001', '测试银行', '6222000000000001', '2026-07-01', '2026-08-20', 'c2-worker'])
    for (const [id, category, content, deletedAt] of [['portrait', 'portrait', PNG, null], ['bank', 'bank-card', null, null], ['unknown', '身份证扫描', PNG, null], ['old-portrait', 'portrait', PNG, '2026-08-01']] as const) {
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,deleted_at) VALUES (?,\'worker\',\'c2-worker\',?,\'C:/用户历史照片.png\',?,\'image/png\',?,\'原经办人\',?)', [id, `${id}.png`, content ? Uint8Array.from(atob(content), c => c.charCodeAt(0)).length : null, category, deletedAt])
      if (content)
        await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES (?,\'base64\',?)', [id, content])
    }
    return { db, imported: await importPayrollC2MigrationSource(db) }
  }
  catch (cause) {
    db.close()
    throw cause
  }
}

it('完整实名字段及原件从旧库接管，缺正文和未知用途不猜；重复接管保日常版本，危险恢复拒绝', async () => {
  const f = await fixture()
  try {
    const source = await readQuantityCoreSource(f.db)
    const original = source.entities.workers.find(row => row.legacyId === 'c2-worker')!
    expect(JSON.parse(String(original.attributes!.workerOriginalJson))).toMatchObject({ id_card: '440000199001010001', bank_account: '6222000000000001' })
    expect(JSON.parse(String(original.attributes!.workerFilesJson))).toHaveLength(4)
    const profile = await workerRosterService.profile(f.imported.workerId)
    expect(profile.worker).toMatchObject({ gender: '女', hometown: '广东', idCard: '440000199001010001', bankName: '测试银行', bankAccount: '6222000000000001', entryDate: '2026-07-01', exitDate: '2026-08-20' })
    expect(profile.values).toMatchObject({ laborContractSigned: null, laborContractSignedOn: null })
    expect(profile.assets).toHaveLength(3)
    const portrait = profile.assets.find(asset => asset.legacyCategory === 'portrait')!
    const bank = profile.assets.find(asset => asset.legacyCategory === 'bank-card')!
    expect(profile.values).toMatchObject({ portraitId: portrait.id, bankCardId: bank.id })
    expect(bank.state).toBe('missing')
    expect((await workerRosterService.file({ workerId: f.imported.workerId, assetId: portrait.id })).payloadBase64).toBe(PNG)
    await expect(workerRosterService.file({ workerId: f.imported.workerId, assetId: bank.id })).rejects.toMatchObject({ problem: { code: 'not-found' } })
    const command = { commandId: 'private-after-import', workspaceId: profile.context.workspaceId, actorId: profile.context.actorId, origin: 'real', sourceVersion: profile.sourceVersion, action: 'save-profile', workerId: f.imported.workerId, values: { ...profile.values, bankCardId: null, laborContractSigned: true, laborContractSignedOn: '2026-09-22' }, uploads: {} }
    await workerRosterService.execute(command)
    const changed = await workerRosterService.profile(f.imported.workerId)
    const snapshot = coreMigrationTestInstance.snapshot(f.imported.session)
    const repeat = await quantityTestInstance.prepareMigrationSnapshot(snapshot)
    repeat.commit()
    expect(await workerRosterService.profile(f.imported.workerId)).toEqual(changed)
    await expect(coreMigrationTestInstance.rollback({ ...f.imported.envelope('private-rollback'), batchId: f.imported.batch.batchId }, f.imported.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(f.imported.session)).toEqual(snapshot)
    expect(await workerRosterService.profile(f.imported.workerId)).toEqual(changed)
  }
  finally { f.db.close() }
}, 30000)

it('没有后续引用的原批次可回滚，原件与迁入版本一起清理', async () => {
  const f = await fixture()
  try {
    await coreMigrationTestInstance.rollback({ ...f.imported.envelope('clean-rollback'), batchId: f.imported.batch.batchId }, f.imported.session)
    const counts = await quantityTestInstance.withWorkspaceTransaction(async db => Promise.all(['worker_roster_assets', 'worker_roster_profile_versions', 'worker_roster_migration_evidence'].map(table => db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`))))
    expect(counts.map(rows => rows[0]!.count)).toEqual([0, 0, 0])
    expect(coreMigrationTestInstance.snapshot(f.imported.session).authority).toBe('local')
  }
  finally { f.db.close() }
}, 30000)

it('已归档工资名册阻止删除所引用工人和原件，候选失败不改变现行权威与归档', async () => {
  const f = await fixture()
  try {
    const { projectId, workerId, leaderWorkerId } = f.imported
    const query = { origin: 'real' as const }
    const config = await payrollService.c2Config(query, { projectId, leaderWorkerId })
    const draft = { projectId, crewId: config.config!.crewId, leaderWorkerId, memberWorkerIds: [leaderWorkerId, workerId], month: '2026-08', note: '' }
    const form = await payrollService.c2Form(query, { statementId: null, draftKey: 'roster-migration-wage', draft })
    const envelope = { workspaceId: form.context.workspaceId, actorId: form.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId, configScope: null, configId: null }
    const saved = await payrollService.executeC2({ ...envelope, sourceVersion: form.context.sourceVersion, statementId: null, draftKey: form.draftKey, commandId: 'roster-wage-save', action: { kind: 'save-c2-draft', draft } })
    const statementId = saved.statementId!
    const read = () => payrollService.c2Form(query, { statementId })
    await payrollService.executeC2({ ...envelope, sourceVersion: (await read()).context.sourceVersion, statementId, draftKey: null, commandId: 'roster-wage-check', action: { kind: 'check-c2' } })
    await payrollService.executeC2({ ...envelope, sourceVersion: (await read()).context.sourceVersion, statementId, draftKey: null, commandId: 'roster-wage-release', action: { kind: 'release-c2', release: { actualAmount: 100, allocations: [{ workerId: leaderWorkerId, amount: 0 }, { workerId, amount: 100 }] } } })
    const scope = { projectId, statementIds: [statementId], registeredOn: '2026-09-22' }
    const preview = await workerRosterService.preview(scope)
    const savedArchive = await workerRosterService.execute({ commandId: 'roster-archive-confirm', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', sourceVersion: preview.sourceVersion, action: 'archive', scope })
    const archive = await workerRosterService.archive(projectId, savedArchive.archiveId!)
    const before = coreMigrationTestInstance.snapshot(f.imported.session)
    await expect(coreMigrationTestInstance.rollback({ ...f.imported.envelope('archived-roster-rollback'), batchId: f.imported.batch.batchId }, f.imported.session)).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('固定目录、名册或原件已有独立引用') } })
    expect(coreMigrationTestInstance.snapshot(f.imported.session)).toEqual(before)
    expect(await workerRosterService.archive(projectId, savedArchive.archiveId!)).toEqual(archive)
    const photo = archive.members.find(member => member.workerId === workerId)!.photos.find(asset => asset.purpose === 'portrait')!
    expect((await workerRosterService.file({ projectId, archiveId: archive.id, workerId, assetId: photo.id })).payloadBase64).toBe(PNG)
  }
  finally { f.db.close() }
}, 30000)
