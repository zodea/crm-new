import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { encodePayrollHostSection } from '../../app/lib/crew-worker/payroll-read'
import { decodeWorkerDetailRead } from '../../app/lib/crew-worker/read-decoder'
import { formDefaults } from '../../app/lib/master-data/page'
import { collectReadPages } from '../../app/lib/read-model/collection'
import { EMPTY_WORKER_PRIVATE } from '../../app/lib/worker-roster/contract'
import { PRODUCTION_CREW_WORKER_CAPABILITIES } from '../../server/utils/production-crew-worker-access'
import { createProductionCrewWorkerImport } from '../../server/utils/production-crew-worker-import'
import { listWorkerReferences, readWorkerReference } from '../../server/utils/production-crew-worker-references'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { validateProductionCrewWorkerJournal } from '../../server/utils/production-crew-worker-validation'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createCrewWorkerNativeSource } from '../helpers/crew-worker-native-source'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

async function fixture() {
  const base = testTempRoot('a03-crew-worker-production')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const options = { directory, workspaceId: 'crew-workspace', ownerId: 'crew-owner', purpose: 'verification' as const }
  const storage = await createSeededProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: [...PRODUCTION_CREW_WORKER_CAPABILITIES, 'project:list:read', 'project:write'] }
  return { storage, actor }
}

it('正式同事务工人候选按全局稳定 ID 返回，跨项目和同名均不截断或合并，冷读取不泄露私密草稿', async () => {
  const { storage, actor } = await fixture()
  try {
    await storage.withTransaction(async (tx) => {
      for (const [id, project] of [['worker-first', 'project-one'], ['worker-second', 'project-two']]) {
        const record = { id, version: 1, updatedAt: '2026-10-05T08:00:00.000Z', draft: { id, name: '同名工人', currentProjectId: project, bankAccount: 'private-bank-account', idCard: 'private-id-card' } }
        await tx.execute('INSERT INTO workers(id,record_json) VALUES (?,?)', [id, JSON.stringify(record)])
      }
      expect(await listWorkerReferences(tx, actor)).toEqual([{ id: 'worker-first', name: '同名工人' }, { id: 'worker-second', name: '同名工人' }])
      expect(await readWorkerReference(tx, actor, 'worker-second')).toEqual({ id: 'worker-second', name: '同名工人', deleted_at: null })
      expect(await readWorkerReference(tx, actor, 'worker-absent')).toBeNull()
    })
    await storage.close()
    const reopened = await storage.withTransaction(tx => listWorkerReferences(tx, actor))
    expect(reopened).toHaveLength(2)
    expect(JSON.stringify(reopened)).not.toMatch(/private-bank-account|private-id-card|currentProjectId/)
  }
  finally { await storage.close() }
})

const workerRequest = (actor: Awaited<ReturnType<typeof fixture>>['actor'], commandId: string) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId, requiredCapability: 'worker:write', action: 'save' as const, baseVersion: null, draft: { ...formDefaults('worker'), name: '合成全局工人', phone: '13800000011', trade: '泥工', bankName: '合成测试银行', bankAccount: 'synthetic-bank-account', dailyWage: 0 }, attachments: {} })
it('正式写入、原键幂等、未知结果冷恢复、版本冲突、未应用封存均在同一真实磁盘事务中闭合', async () => {
  const { storage, actor } = await fixture()
  try {
    let service = createProductionCrewWorkerService(storage)
    const request = workerRequest(actor, 'worker-original-submit')
    const result = await service.executeWorker(request, () => actor)
    expect(await service.executeWorker(request, () => actor)).toEqual(result)
    await storage.close()
    service = createProductionCrewWorkerService(storage)
    expect(await service.resolve('worker', request.commandId, () => actor)).toEqual({ outcome: 'applied', result })
    const form = await service.workerForm(result.id, () => actor)
    expect(form).toMatchObject({ version: '1', draft: { dailyWage: 0, bankAccount: 'synthetic-bank-account' } })
    await expect(service.executeWorker({ ...request, commandId: 'worker-stale-edit', id: result.id, baseVersion: '0', draft: { ...form.draft, name: '不应覆盖' } }, () => actor, result.id)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await service.resolve('worker', 'worker-never-applied', () => actor)).toEqual({ outcome: 'not-applied', commandId: 'worker-never-applied' })
    await expect(service.executeWorker({ ...request, commandId: 'worker-never-applied' }, () => actor)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const detail = await service.workerDetail(result.id, { origin: 'real' }, () => actor)
    expect(Object.values(detail.summary)).toEqual(Array.from({ length: 11 }).fill(null))
    expect(detail.worker.dailyWage).toBe(0)
    expect(detail.meta.sources.find(source => source.key === 'wages')).toMatchObject({ state: 'unavailable', sourceVersion: null })
    expect(decodeWorkerDetailRead({ ...detail, payrollActual: encodePayrollHostSection(detail.payrollActual!) }).worker.id).toBe(result.id)
    await storage.withTransaction(async (tx) => {
      expect(await tx.select('SELECT entity_id FROM crew_worker_audits')).toEqual([{ entity_id: result.id }])
      expect(await tx.select('SELECT command_id FROM crew_worker_command_receipts')).toEqual([{ command_id: request.commandId }])
      await validateProductionCrewWorkerJournal(tx, storage.identity)
      await expect(tx.execute('DELETE FROM crew_worker_command_receipts')).rejects.toThrow('Frozen')
    })
  }
  finally { await storage.close() }
})

async function project(storage: Awaited<ReturnType<typeof fixture>>['storage'], actor: Awaited<ReturnType<typeof fixture>>['actor'], suffix: string) {
  return createProductionProjectService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: `project-command-${suffix}`, requiredCapability: 'project:write', action: 'draft', baseVersion: null, draft: { ...formDefaults('project'), name: `真实合成项目${suffix}` }, attachments: {} }, () => actor)
}
it('实际项目目录与全局工人不同归属，跨项目复用只改独立关系，隐藏项目不泄露稳定目标', async () => {
  const { storage, actor } = await fixture()
  try {
    const first = await project(storage, actor, 'first')
    const second = await project(storage, actor, 'second')
    const service = createProductionCrewWorkerService(storage)
    const crew = await service.executeCrew({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'crew-cross-project', requiredCapability: 'crew:write', action: 'save', baseVersion: null, draft: { ...formDefaults('crew'), name: '全局共享班组', trade: '泥工', contactName: '合成负责人', contactPhone: '13900139000' }, attachments: {} }, () => actor)
    const request = { ...workerRequest(actor, 'worker-project-first'), draft: { ...workerRequest(actor, 'ignored').draft, crewId: crew.id, currentProjectId: first.id } }
    const worker = await service.executeWorker(request, () => actor)
    const form = await service.workerForm(worker.id, () => actor)
    const moved = await service.executeWorker({ ...request, id: worker.id, commandId: 'worker-project-second', baseVersion: form.version, draft: { ...form.draft, currentProjectId: second.id } }, () => actor, worker.id)
    expect(moved.id).toBe(worker.id)
    expect((await service.listWorkers({}, () => actor)).items).toMatchObject([{ worker: { id: worker.id }, currentProject: { id: second.id } }])
    expect(await storage.withTransaction(tx => listWorkerReferences(tx, actor))).toEqual([{ id: worker.id, name: '合成全局工人' }])
    const workerCandidates = await collectReadPages({ load: page => service.listWorkers({ includeDemo: false, sort: 'name-asc', page, pageSize: 100 }, () => actor), identity: item => item.worker.id })
    expect(workerCandidates.items).toMatchObject([{ worker: { id: worker.id }, crew: { id: crew.id }, currentProject: { id: second.id } }])
    expect(workerCandidates.first.meta.authorizedScope.coverage).toBe('complete')
    const crewCandidates = await collectReadPages({ load: page => service.listCrews({ includeDemo: false, sort: 'name-asc', page, pageSize: 100 }, () => actor), identity: item => item.crew.id })
    expect(crewCandidates.items).toMatchObject([{ crew: { id: crew.id }, memberCount: 1, projectCount: null }])
    expect(crewCandidates.first.meta.authorizedScope.coverage).toBe('complete')
    expect(crewCandidates.first.meta.sources.find(source => source.key === 'wages')).toMatchObject({ state: 'unavailable', sourceVersion: null })
    expect((await service.crewDetail(crew.id, { origin: 'real' }, () => actor)).meta.authorizedScope.coverage).toBe('unknown')
    const hidden = { ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'project:list:read') }
    const list = await service.listWorkers({}, () => hidden)
    expect(list.items[0]!.currentProject.state).toBe('forbidden')
    expect(JSON.stringify(list)).not.toContain(second.id)
    const visibleCandidates = await collectReadPages({ load: page => service.listWorkers({ includeDemo: false, page, pageSize: 100 }, () => hidden), identity: item => item.worker.id })
    expect(visibleCandidates.items).toMatchObject([{ worker: { id: worker.id }, currentProject: { state: 'forbidden' } }])
    expect(visibleCandidates.first.meta.sources.find(source => source.key === 'projects')).toMatchObject({ state: 'forbidden', sourceVersion: null })
    const denied = { ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'worker:list:read') }
    await expect(collectReadPages({ load: page => service.listWorkers({ page, pageSize: 100 }, () => denied), identity: item => item.worker.id })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await service.resolve('worker', request.commandId, () => actor)).toEqual({ outcome: 'applied', result: worker })
    await storage.withTransaction(tx => validateProductionCrewWorkerJournal(tx, storage.identity))
  }
  finally { await storage.close() }
})

it('实名资料使用 shared BLOB 精确工人归属，冷恢复不重复原件，改草稿及权限切换均不能覆盖冻结版本', async () => {
  const { storage, actor } = await fixture()
  try {
    let service = createProductionCrewWorkerService(storage)
    const worker = await service.executeWorker(workerRequest(actor, 'worker-with-photo'), () => actor)
    const profile = await service.profile(worker.id, () => actor)
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const command = { commandId: 'private-original-command', workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'save-profile', origin: 'real', sourceVersion: profile.sourceVersion, workerId: worker.id, values: { ...EMPTY_WORKER_PRIVATE, laborContractSigned: false }, uploads: { portrait: { fileName: 'synthetic.png', mimeType: 'image/png', fileSize: bytes.length, payloadBase64: bytes.toString('base64') } } }
    const original = await service.executeRoster(command, () => actor)
    await storage.close()
    service = createProductionCrewWorkerService(storage)
    expect(await service.resolveRoster(command.commandId, 'save-profile', () => actor)).toEqual({ state: 'applied', result: original })
    expect(await service.executeRoster(command, () => actor)).toEqual(original)
    const read = await service.profile(worker.id, () => actor)
    expect(read).toMatchObject({ revision: 1, values: { laborContractSigned: false }, assets: [{ state: 'available', workerId: worker.id }] })
    expect((await service.rosterFile({ workerId: worker.id, assetId: read.assets[0]!.id }, () => actor)).payloadBase64).toBe(bytes.toString('base64'))
    await expect(service.executeRoster({ ...command, commandId: 'stale-private-command', values: { ...command.values, laborContractSigned: true, laborContractSignedOn: '2026-10-05' } }, () => actor)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    await expect(service.profile(worker.id, () => ({ ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'worker:sensitive:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await storage.withTransaction(async (tx) => {
      expect((await tx.select('SELECT id FROM file_refs WHERE owner_type=\'worker\''))).toHaveLength(1)
      await validateProductionCrewWorkerJournal(tx, storage.identity)
      await expect(tx.execute('UPDATE worker_roster_profile_versions SET values_json=\'{}\'')).rejects.toThrow('Frozen')
    })
  }
  finally { await storage.close() }
})

it('真实 Native 快照先明确项目映射后同事务迁入，原稳定 ID/真实零/原操作者/原件/私密版本保全，冷恢复只采用一次', async () => {
  const { storage, actor } = await fixture()
  try {
    const local = await createCrewWorkerNativeSource(undefined, true)
    const target = await project(storage, actor, 'mapping-target')
    let service = createProductionCrewWorkerImport(storage)
    const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'native-cw-import', action: 'preflight', source: local.source, referenceMappings: [] }
    expect(await service.execute(request, () => actor)).toMatchObject({ eligible: false, projects: [{ legacyId: 'native-project' }], originalCount: 1 })
    const adopted = { ...request, action: 'adopt', referenceMappings: [{ entityType: 'projects', legacyId: 'native-project', serverId: target.id, version: target.version }] }
    const result = await service.execute(adopted, () => actor)
    expect(result).toMatchObject({ workerIds: ['native-linked-worker', 'native-worker'], crewIds: ['native-crew'], originalCount: 1 })
    await storage.close()
    service = createProductionCrewWorkerImport(storage)
    expect(await service.resolve({ commandId: request.commandId }, () => actor)).toEqual({ outcome: 'applied', result })
    expect(await service.execute(adopted, () => actor)).toEqual(result)
    const owner = createProductionCrewWorkerService(storage)
    expect((await owner.workerForm('native-worker', () => actor)).draft).toMatchObject({ id: 'native-worker', currentProjectId: target.id, dailyWage: 0 })
    expect((await owner.profile('native-worker', () => actor)).values).toEqual(local.values)
    expect((await owner.rosterFile({ workerId: 'native-worker', assetId: local.photoId }, () => actor)).payloadBase64).toBe(local.bytes.toString('base64'))
    const frozen = await owner.rosterArchive(target.id, local.archive.id, () => actor)
    expect(frozen).toMatchObject({ createdBy: 'native-original-actor', projectName: '原冻结项目名称', scope: { projectId: target.id, statementIds: ['native-frozen-wage'] }, members: [{ payrollNames: ['原工资冻结姓名'], profile: { name: '原冻结工人姓名' }, values: local.values }], migration: { originalId: local.archive.id } })
    const form = await owner.workerForm('native-worker', () => actor)
    await owner.executeWorker({ ...workerRequest(actor, 'edited-imported-worker'), id: form.draft.id, baseVersion: form.version, action: 'draft', draft: { ...form.draft, name: '现工人姓名', dailyWage: null, bankAccount: 'current-private-account' } }, () => actor, 'native-worker')
    expect((await owner.rosterArchive(target.id, local.archive.id, () => actor)).members[0]!.profile!.name).toBe('原冻结工人姓名')
    expect((await owner.workerDetail('native-worker', { origin: 'real' }, () => actor)).relatedWorkers).toMatchObject([{ worker: { state: 'resolved', id: 'native-linked-worker', label: '原关联人员' } }])
    expect((await owner.rosterFile({ workerId: 'native-worker', assetId: local.photoId, projectId: target.id, archiveId: local.archive.id }, () => actor)).payloadBase64).toBe(local.bytes.toString('base64'))
    await storage.withTransaction(async (tx) => {
      expect(await tx.select('SELECT actor_id FROM worker_roster_profile_versions')).toEqual([{ actor_id: 'native-original-actor' }])
      expect(await tx.select('SELECT command_id FROM worker_roster_receipts')).toEqual([])
      expect((await tx.select('SELECT source_sha256 FROM crew_worker_import_sources'))).toHaveLength(1)
      expect((await tx.select('SELECT id FROM workers ORDER BY id'))).toEqual([{ id: 'native-linked-worker' }, { id: 'native-worker' }])
      const [evidence] = await tx.select<{ source_graph_json: string }>('SELECT source_graph_json FROM crew_worker_import_sources')
      expect(JSON.parse(evidence!.source_graph_json).archives[0].snapshot_json).toBe(local.rawArchive)
      expect(JSON.parse(evidence!.source_graph_json).receipts).toMatchObject([{ command_id: local.result.commandId, actor_id: 'native-original-actor', workspace_id: 'native-original-workspace', result_json: JSON.stringify(local.result) }])
      await validateProductionCrewWorkerJournal(tx, storage.identity)
      await expect(tx.execute('DELETE FROM crew_worker_import_sources')).rejects.toThrow('Frozen')
    })
  }
  finally { await storage.close() }
})

it('来源 SHA 错误、伪 JSON、旧映射版本、未应用封存与迁入身份变化均不留下半份目录或原件', async () => {
  const { storage, actor } = await fixture()
  try {
    const local = await createCrewWorkerNativeSource()
    const service = createProductionCrewWorkerImport(storage)
    const target = await project(storage, actor, 'reject-target')
    const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'reject-original-import', action: 'adopt', source: local.source, referenceMappings: [{ entityType: 'projects', legacyId: 'native-project', serverId: target.id, version: target.version }] }
    await expect(service.execute({ ...request, source: { ...local.source, sha256: '0'.repeat(64) } }, () => actor)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const fake = Buffer.from('{}')
    await expect(service.execute({ ...request, source: { payloadBase64: fake.toString('base64'), sha256: createHash('sha256').update(fake).digest('hex') } }, () => actor)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(service.execute({ ...request, referenceMappings: [{ ...request.referenceMappings[0], version: '999' }] }, () => actor)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await service.resolve({ commandId: request.commandId }, () => actor)).toEqual({ outcome: 'not-applied', commandId: request.commandId })
    await expect(service.execute(request, () => actor)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    let calls = 0
    await expect(service.execute({ ...request, commandId: 'identity-changed-import' }, () => ++calls > 1 ? { ...actor, actorId: 'changed-owner' } : actor)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await storage.withTransaction(async (tx) => {
      expect(await tx.select('SELECT id FROM workers')).toEqual([])
      expect(await tx.select('SELECT id FROM crews')).toEqual([])
      expect(await tx.select('SELECT id FROM file_refs WHERE owner_type=\'worker\'')).toEqual([])
      expect(await tx.select('SELECT source_sha256 FROM crew_worker_import_sources')).toEqual([])
    })
  }
  finally { await storage.close() }
})

it('native 原 workspace/actor/key 即使与中央新意图碰撞，也只保留历史证据而不冒充中央已应用回执', async () => {
  const { storage, actor } = await fixture()
  try {
    const local = await createCrewWorkerNativeSource(actor)
    const target = await project(storage, actor, 'collision-target')
    await createProductionCrewWorkerImport(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'collision-adoption', action: 'adopt', source: local.source, referenceMappings: [{ entityType: 'projects', legacyId: 'native-project', serverId: target.id, version: target.version }] }, () => actor)
    await storage.withTransaction(async (tx) => {
      expect(await tx.select('SELECT command_id FROM worker_roster_receipts')).toEqual([])
      const [evidence] = await tx.select<{ source_graph_json: string }>('SELECT source_graph_json FROM crew_worker_import_sources')
      expect(JSON.parse(evidence!.source_graph_json).receipts).toMatchObject([{ workspace_id: actor.workspaceId, actor_id: actor.actorId, command_id: local.result.commandId, result_json: JSON.stringify(local.result) }])
    })
    const owner = createProductionCrewWorkerService(storage)
    const profile = await owner.profile('native-worker', () => actor)
    const central = await owner.executeRoster({ commandId: local.result.commandId, workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'save-profile', origin: 'real', sourceVersion: profile.sourceVersion, workerId: 'native-worker', values: { ...profile.values, laborContractSigned: true, laborContractSignedOn: '2026-10-05' }, uploads: {} }, () => actor)
    expect(central).toMatchObject({ commandId: local.result.commandId, revision: 2 })
    expect(central).not.toEqual(local.result)
    await storage.close()
    expect(await createProductionCrewWorkerService(storage).resolveRoster(local.result.commandId, 'save-profile', () => actor)).toEqual({ state: 'applied', result: central })
    await storage.withTransaction(tx => validateProductionCrewWorkerJournal(tx, storage.identity))
  }
  finally { await storage.close() }
})

it('同源目录权限、工作区和维护人逐次核对，错误 actor 与缺权限不能读取旧工人姓名', async () => {
  const { storage, actor } = await fixture()
  try {
    for (const invalid of [{ ...actor, actorId: 'another-owner' }, { ...actor, workspaceId: 'another-workspace' }, { ...actor, capabilities: [] }]) {
      await expect(storage.withTransaction(tx => listWorkerReferences(tx, invalid))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      await expect(storage.withTransaction(tx => readWorkerReference(tx, invalid, 'worker-first'))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    }
    await storage.withTransaction(async (tx) => {
      await tx.execute('INSERT INTO workers(id,record_json) VALUES (?,?)', ['worker-damaged', JSON.stringify({ id: 'worker-damaged', draft: { name: 0 } })])
      await expect(listWorkerReferences(tx, actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    })
  }
  finally { await storage.close() }
})
