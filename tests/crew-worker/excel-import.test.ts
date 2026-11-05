import { mkdir, mkdtemp } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { crewExcelDuplicates, normalizeCrewExcelRow } from '../../app/lib/crew-worker/excel-import'
import { parseCrewExcelImport, parseCrewExcelPreview } from '../../server/utils/crew-excel-import-request'
import { createCrewWorkerCommandService } from '../../server/utils/crew-worker-command-service'
import { PRODUCTION_CREW_WORKER_CAPABILITIES } from '../../server/utils/production-crew-worker-access'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { testTempRoot } from '../helpers/test-temp-root'

const actor = { workspaceId: 'crew-excel-test', actorId: 'synthetic-actor', capabilities: [...PRODUCTION_CREW_WORKER_CAPABILITIES] }
const session = () => actor
const command = (commandId: string, draft: unknown, decision: unknown) => parseCrewExcelImport({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'crew:write', commandId, draft, decision })

it('表格只转换已映射列，保留缺省、显式零及可调整的百分比', () => {
  expect(normalizeCrewExcelRow({ name: '合成班组', defaultPayRatio: '85%', rentSubsidyEnabled: '', rentSubsidyPrice: 0, capabilityTrades: '泥工、木工' })).toEqual({ name: '合成班组', defaultPayRatio: 0.85, rentSubsidyPrice: 0, capabilityTrades: ['泥工', '木工'] })
  expect(normalizeCrewExcelRow({ name: '合成班组', defaultPayRatio: '' })).toEqual({ name: '合成班组', defaultPayRatio: null })
  expect(normalizeCrewExcelRow({ name: '合成班组' })).toEqual({ name: '合成班组' })
  expect(() => normalizeCrewExcelRow({ name: '合成班组', defaultPayRatio: '85' })).toThrow('比例')
  expect(() => normalizeCrewExcelRow({ name: '合成班组', rentSubsidyPrice: '-1' })).toThrow('非负')
  expect(crewExcelDuplicates([{ index: 0, draft: { name: '合成 A' } }, { index: 1, draft: { name: '合成  a' } }, { index: 2, draft: { name: '其他' } }])).toEqual(new Map([[0, [1]], [1, [0]]]))
})

it('预览重复、明确替换并保持未映射字段，变更后拒绝旧版本', async () => {
  const service = createCrewWorkerCommandService({ createId: () => 'synthetic-crew' })
  const original = { name: '合成班组', trade: '泥工', note: '原备注', defaultPayRatio: null, rentSubsidyEnabled: true, rentSubsidyPrice: 0 }
  const initial = service.previewCrewExcel([original], actor)[0]!
  await service.importCrewExcel(command('crew-initial', original, { kind: 'create', fingerprint: initial.fingerprint }), actor)
  const change = { name: '合成班组', note: '新备注' }
  const preview = service.previewCrewExcel([change], actor)[0]!
  expect(preview.candidates).toMatchObject([{ id: 'synthetic-crew', version: '1', fields: { note: '原备注' } }])
  const decision = { kind: 'replace', fingerprint: preview.fingerprint, id: 'synthetic-crew', version: '1' }
  const applied = await service.importCrewExcel(command('crew-replace', change, decision), actor)
  expect(service.crewForm(applied.id, actor).draft).toMatchObject({ trade: '泥工', note: '新备注', defaultPayRatio: null, rentSubsidyEnabled: true, rentSubsidyPrice: 0 })
  expect(await service.importCrewExcel(command('crew-replace', change, decision), actor)).toEqual(applied)
  await expect(service.importCrewExcel(command('crew-replace', { ...change, note: '试图修改原命令' }, decision), actor)).rejects.toThrow('同一命令编号')
  await expect(service.importCrewExcel(command('crew-stale', change, decision), actor)).rejects.toThrow('重新预览')
  const next = service.previewCrewExcel([change], actor)[0]!
  await expect(service.importCrewExcel(command('crew-unconfirmed', change, { kind: 'create', fingerprint: next.fingerprint }), actor)).rejects.toThrow('班组名称已存在')
})

it('拒绝伪造身份字段、无权限预览及负补贴，缺省比例不伪造数值', async () => {
  expect(() => parseCrewExcelPreview({ drafts: [{ name: '合成班组', id: 'forged' }] })).toThrow('班组导入请求无效')
  expect(() => parseCrewExcelImport({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'crew:write', commandId: 'forged-command', draft: { name: '合成班组' }, decision: { kind: 'create', fingerprint: 'a'.repeat(64), id: 'forged' } })).toThrow('班组导入请求无效')
  const service = createCrewWorkerCommandService({ createId: () => 'missing-ratio' })
  expect(() => service.previewCrewExcel([{ name: '合成班组' }], { ...actor, capabilities: ['crew:write'] })).toThrow('权限')
  const invalid = { name: '合成班组', rentSubsidyPrice: -1 }
  const invalidPreview = service.previewCrewExcel([invalid], actor)[0]!
  await expect(service.importCrewExcel(command('bad-subsidy', invalid, { kind: 'create', fingerprint: invalidPreview.fingerprint }), actor)).rejects.toThrow('无效')
  const valid = { name: '合成班组' }
  const preview = service.previewCrewExcel([valid], actor)[0]!
  await service.importCrewExcel(command('missing-ratio', valid, { kind: 'create', fingerprint: preview.fingerprint }), actor)
  expect(service.crewForm('missing-ratio', actor).draft.defaultPayRatio).toBeUndefined()
})

it('替换历史班组时保持未映射状态，不把历史状态改成草稿', async () => {
  const seed = createCrewWorkerCommandService({ createId: () => 'legacy-crew' })
  const draft = { name: '合成历史班组' }
  const first = seed.previewCrewExcel([draft], actor)[0]!
  await seed.importCrewExcel(command('legacy-create', draft, { kind: 'create', fingerprint: first.fingerprint }), actor)
  const state = seed.snapshot()
  state.crews.get('legacy-crew')!.draft.status = 'legacy-status'
  const service = createCrewWorkerCommandService({ initialState: state })
  const change = { ...draft, note: '新的备注' }
  const preview = service.previewCrewExcel([change], actor)[0]!
  await service.importCrewExcel(command('legacy-replace', change, { kind: 'replace', fingerprint: preview.fingerprint, id: 'legacy-crew', version: '1' }), actor)
  expect(service.crewForm('legacy-crew', actor).draft).toMatchObject({ status: 'legacy-status', note: '新的备注' })
})

it('旧事实未知时明确填写关闭才记录关闭，未映射的费用仍保持未知', async () => {
  const seed = createCrewWorkerCommandService({ createId: () => 'legacy-fees' })
  const draft = { name: '合成旧班组', rentSubsidyEnabled: false, mgmtFeeEnabled: false }
  const first = seed.previewCrewExcel([draft], actor)[0]!
  await seed.importCrewExcel(command('fees-create', draft, { kind: 'create', fingerprint: first.fingerprint }), actor)
  const state = seed.snapshot()
  state.crews.get('legacy-fees')!.payrollFeeDefaults!.rentEnabled = { state: 'missing' }
  state.crews.get('legacy-fees')!.payrollFeeDefaults!.managementEnabled = { state: 'missing' }
  const service = createCrewWorkerCommandService({ initialState: state })
  const change = { name: '合成旧班组', rentSubsidyEnabled: false }
  const preview = service.previewCrewExcel([change], actor)[0]!
  expect(preview.candidates[0]!.fields.rentSubsidyEnabled).toBeNull()
  await service.importCrewExcel(command('fees-replace', change, { kind: 'replace', fingerprint: preview.fingerprint, id: 'legacy-fees', version: '1' }), actor)
  expect(service.payrollCrewFeeDefaults().rows[0]).toMatchObject({ rentEnabled: { state: 'value', value: false }, managementEnabled: { state: 'missing' } })
})

it('正式数据冷打开后可用原编号核对并重放，替换保留未映射比例与补贴', async () => {
  const base = testTempRoot('crew-excel-import')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  try {
    let service = createProductionCrewWorkerService(storage)
    const initial = { name: '合成冷恢复班组', defaultPayRatio: null, rentSubsidyPrice: 0, note: '原备注' }
    const first = (await service.previewCrewExcel({ drafts: [initial] }, session)).previews[0]!
    const created = await service.importCrewExcel(command('cold-create', initial, { kind: 'create', fingerprint: first.fingerprint }), session)
    const change = { name: initial.name, note: '新备注' }
    const preview = (await service.previewCrewExcel({ drafts: [change] }, session)).previews[0]!
    const request = command('cold-replace', change, { kind: 'replace', fingerprint: preview.fingerprint, id: created.id, version: created.version })
    const result = await service.importCrewExcel(request, session)
    await storage.close()
    service = createProductionCrewWorkerService(storage)
    expect(await service.resolve('crew', request.commandId, session)).toEqual({ outcome: 'applied', result })
    expect(await service.importCrewExcel(request, session)).toEqual(result)
    expect((await service.crewForm(created.id, session)).draft).toMatchObject({ note: '新备注', defaultPayRatio: null, rentSubsidyPrice: 0 })
    expect(await service.resolve('crew', 'cold-never-sent', session)).toEqual({ outcome: 'not-applied', commandId: 'cold-never-sent' })
    const newDraft = { name: '合成未发送班组' }
    const fresh = (await service.previewCrewExcel({ drafts: [newDraft] }, session)).previews[0]!
    await expect(service.importCrewExcel(command('cold-never-sent', newDraft, { kind: 'create', fingerprint: fresh.fingerprint }), session)).rejects.toThrow('封存')
  }
  finally { await storage.close() }
})
