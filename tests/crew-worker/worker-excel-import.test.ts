import { mkdir, mkdtemp } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { normalizeWorkerExcelRow, workerExcelDuplicates } from '../../app/lib/crew-worker/worker-excel-import'
import { createCrewWorkerCommandService } from '../../server/utils/crew-worker-command-service'
import { PRODUCTION_CREW_WORKER_CAPABILITIES } from '../../server/utils/production-crew-worker-access'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { parseWorkerExcelImport, parseWorkerExcelPreview } from '../../server/utils/worker-excel-import-request'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { testTempRoot } from '../helpers/test-temp-root'

const actor = { workspaceId: 'worker-excel-test', actorId: 'synthetic-owner', capabilities: [...PRODUCTION_CREW_WORKER_CAPABILITIES, 'project:list:read'] }
const session = () => actor
const command = (commandId: string, draft: unknown, decision: unknown) => parseWorkerExcelImport({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'worker:write', commandId, draft, decision })

it('表格空值不清除原资料，工资零与日期按明确内容转换', () => {
  expect(normalizeWorkerExcelRow({ name: '合成人', dailyWage: '0', idCard: '', crewName: '', safetyEducation: '否', entryDate: '2026-10-01' })).toEqual({ name: '合成人', dailyWage: 0, safetyEducation: false, entryDate: '2026-10-01' })
  expect(() => normalizeWorkerExcelRow({ name: '合成人', dailyWage: '-1' })).toThrow('非负')
  expect(() => normalizeWorkerExcelRow({ name: '合成人', entryDate: '2026-02-31' })).toThrow('日期')
  expect(workerExcelDuplicates([{ index: 0, draft: { name: '同名' } }, { index: 1, draft: { name: '同名' } }])).toEqual(new Map([[0, [1]], [1, [0]]]))
})

it('同名班组和项目显示全部候选，必须明确选择目标且变化后重新预览', async () => {
  let id = 0
  const projects = [{ id: 'project-1', name: '合成同名项目', version: '1' }, { id: 'project-2', name: '合成同名项目', version: '1' }]
  const seed = createCrewWorkerCommandService({ createId: () => `crew-${++id}` })
  for (const name of ['第一班组', '第二班组']) await seed.executeCrew({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'crew:write', commandId: `seed-${id}`, action: 'draft', baseVersion: null, draft: { name }, attachments: {} }, actor)
  const state = seed.snapshot()
  for (const item of state.crews.values()) item.draft.name = '合成同名班组'
  const service = createCrewWorkerCommandService({ initialState: state, createId: () => 'selected-worker', projectIds: () => projects.map(item => item.id), projectReferences: () => projects })
  const draft = { name: '合成人员', crewName: '合成同名班组', projectName: '合成同名项目' }
  const preview = service.previewWorkerExcel([draft], actor)[0]!
  expect(preview.crews).toHaveLength(2)
  expect(preview.projects).toHaveLength(2)
  const decision = { kind: 'create', fingerprint: preview.fingerprint, crew: { id: 'crew-2', version: '1' }, project: { id: 'project-2', version: '1' } }
  const result = await service.importWorkerExcel(command('choose-relations', draft, decision), actor)
  expect(service.workerForm(result.id, actor).draft).toMatchObject({ crewId: 'crew-2', currentProjectId: 'project-2' })
  const fresh = service.previewWorkerExcel([{ name: '另一人员', projectName: '合成同名项目' }], actor)[0]!
  projects[1]!.version = '2'
  await expect(service.importWorkerExcel(command('stale-project', { name: '另一人员', projectName: '合成同名项目' }, { kind: 'create', fingerprint: fresh.fingerprint, project: { id: 'project-2', version: '1' } }), actor)).rejects.toThrow('重新预览')
})

it('同名工人先确认，班组及项目必须明确选定，保存与重试绑定同一身份', async () => {
  let next = 0
  const projects = [{ id: 'project-a', name: '合成项目', version: '1' }]
  const service = createCrewWorkerCommandService({ createId: kind => `${kind}-${++next}`, projectIds: () => projects.map(item => item.id), projectReferences: () => projects })
  const seed = await service.executeCrew({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'crew:write', commandId: 'seed-crew', action: 'draft', baseVersion: null, draft: { name: '合成班组' }, attachments: {} }, actor)
  const original = { name: '合成人员', idCard: 'synthetic-card', bankAccount: 'synthetic-bank', phone: '13800000001', note: '原备注' }
  const first = service.previewWorkerExcel([original], actor)[0]!
  const created = await service.importWorkerExcel(command('seed-worker', original, { kind: 'create', fingerprint: first.fingerprint }), actor)
  const draft = { name: '合成人员', note: '新备注', crewName: '合成班组', projectName: '合成项目' }
  const preview = service.previewWorkerExcel([draft], actor)[0]!
  expect(preview.candidates).toMatchObject([{ id: created.id, matchedBy: ['name'], fields: { note: '原备注' } }])
  await expect(service.importWorkerExcel(command('missing-crew-choice', draft, { kind: 'replace', fingerprint: preview.fingerprint, id: created.id, version: created.version }), actor)).rejects.toThrow('班组')
  const decision = { kind: 'replace', fingerprint: preview.fingerprint, id: created.id, version: created.version, crew: { id: seed.id, version: seed.version }, project: { id: 'project-a', version: '1' } }
  const updated = await service.importWorkerExcel(command('replace-worker', draft, decision), actor)
  expect(service.workerForm(created.id, actor).draft).toMatchObject({ note: '新备注', idCard: 'synthetic-card', bankAccount: 'synthetic-bank', crewId: seed.id, currentProjectId: 'project-a' })
  expect(await service.importWorkerExcel(command('replace-worker', draft, decision), actor)).toEqual(updated)
  await expect(service.importWorkerExcel(command('stale-worker', draft, decision), actor)).rejects.toThrow('重新预览')
  const sameCard = { name: '其他人', idCard: 'synthetic-card' }
  const sameCardPreview = service.previewWorkerExcel([sameCard], actor)[0]!
  await expect(service.importWorkerExcel(command('same-card', sameCard, { kind: 'create', fingerprint: sameCardPreview.fingerprint }), actor)).rejects.toThrow('身份证号已关联')
})

it('敏感资料及项目目录越权、伪造关系和无效日期均拒绝', () => {
  const service = createCrewWorkerCommandService()
  const restricted = { ...actor, capabilities: actor.capabilities.filter(item => item !== 'worker:sensitive:read') }
  expect(() => service.previewWorkerExcel([{ name: '合成人员' }], restricted)).toThrow('权限')
  expect(() => service.previewWorkerExcel([{ name: '合成人员', projectName: '合成项目' }], { ...actor, capabilities: actor.capabilities.filter(item => item !== 'project:list:read') })).toThrow('项目目录权限')
  expect(() => parseWorkerExcelPreview({ drafts: [{ name: '合成人员', crewId: 'forged' }] })).toThrow()
  expect(() => parseWorkerExcelPreview({ drafts: [{ name: '合成人员', entryDate: '2026-02-31' }] })).toThrow()
})

it('正式磁盘冷打开可核对原提交并保留未映射私密字段', async () => {
  const root = testTempRoot('worker-excel-import')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(`${root}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  try {
    let service = createProductionCrewWorkerService(storage)
    const first = { name: '冷恢复合成人', idCard: 'synthetic-id', bankAccount: 'synthetic-account' }
    const preview = (await service.previewWorkerExcel({ drafts: [first] }, session)).previews[0]!
    const created = await service.importWorkerExcel(command('worker-cold-create', first, { kind: 'create', fingerprint: preview.fingerprint }), session)
    const change = { name: first.name, note: '修改备注' }
    const review = (await service.previewWorkerExcel({ drafts: [change] }, session)).previews[0]!
    const request = command('worker-cold-replace', change, { kind: 'replace', fingerprint: review.fingerprint, id: created.id, version: created.version })
    const result = await service.importWorkerExcel(request, session)
    await storage.close()
    service = createProductionCrewWorkerService(storage)
    expect(await service.resolve('worker', request.commandId, session)).toEqual({ outcome: 'applied', result })
    expect(await service.importWorkerExcel(request, session)).toEqual(result)
    expect((await service.workerForm(created.id, session)).draft).toMatchObject({ note: '修改备注', idCard: 'synthetic-id', bankAccount: 'synthetic-account' })
  }
  finally { await storage.close() }
})
