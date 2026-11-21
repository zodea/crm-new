import { describe, expect, it } from 'vitest'
import {
  CREW_WRITE_CAPABILITY,
  WORKER_WRITE_CAPABILITY,
} from '~/lib/crew-worker/command-contract'
import { formDefaults } from '~/lib/master-data/page'
import { createCrewWorkerCommandTestInstance } from '../../server/utils/crew-worker-command-test-instance'
import { createCrewWorkerReadTestInstance } from '../../server/utils/crew-worker-read-test-instance'
import { readSourceVersion } from '../../server/utils/read-meta'

const session = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: [CREW_WRITE_CAPABILITY, WORKER_WRITE_CAPABILITY],
}

describe('班组—工人中央 command 测试实例', () => {
  it.each([
    { name: '负比例', ratio: -0.01 },
    { name: '大于百分之百', ratio: 1.01 },
  ])('班组保存拒绝$name且不产生记录', async ({ ratio }) => {
    const instance = createCrewWorkerCommandTestInstance()
    const draft = { ...formDefaults('crew'), name: '比例班组', trade: '泥工', contactName: '负责人', contactPhone: '13812345678', defaultPayRatio: ratio }
    const request = { ...session, requiredCapability: CREW_WRITE_CAPABILITY, commandId: 'invalid-ratio', baseVersion: null, action: 'save' as const, draft, attachments: {} }
    await expect(instance.executeCrew(request, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', fieldErrors: { defaultPayRatio: ['发放比例必须在 0 到 1 之间'] } } })
    expect(instance.crewRows()).toEqual([])
  })

  it.each([null, 0, 1])('班组保存接受未配置及边界比例 %s', async (ratio) => {
    const instance = createCrewWorkerCommandTestInstance()
    const draft = { ...formDefaults('crew'), name: '比例班组', trade: '泥工', contactName: '负责人', contactPhone: '13812345678', defaultPayRatio: ratio }
    const request = { ...session, requiredCapability: CREW_WRITE_CAPABILITY, commandId: 'valid-ratio', baseVersion: null, action: 'save' as const, draft, attachments: {} }
    const created = await instance.executeCrew(request, session)
    expect(instance.crewForm(created.id, session).draft.defaultPayRatio).toBe(ratio)
  })

  it('局部更新沿用已启用的开关，拒绝清空单价并保留原版本', async () => {
    const instance = createCrewWorkerCommandTestInstance()
    const request = { ...session, requiredCapability: CREW_WRITE_CAPABILITY, commandId: 'create-fees', baseVersion: null, action: 'draft' as const, attachments: {} }
    const saved = await instance.executeCrew({
      ...request,
      draft: { name: '合成班组', rentSubsidyEnabled: true, rentSubsidyPrice: 0.005, mgmtFeeEnabled: false, mgmtFeePrice: 0 },
    }, session)
    await expect(instance.executeCrew({
      ...request,
      commandId: 'clear-fee-price',
      id: saved.id,
      baseVersion: saved.version,
      draft: { name: '合成班组', rentSubsidyPrice: null },
    }, session)).rejects.toMatchObject({
      problem: { code: 'validation-failed', fieldErrors: { rentSubsidyPrice: ['启用房租补贴时，单价必须大于 0'] } },
    })
    expect(instance.crewForm(saved.id, session)).toMatchObject({
      version: saved.version,
      draft: { rentSubsidyEnabled: true, rentSubsidyPrice: 0.005, mgmtFeeEnabled: false, mgmtFeePrice: 0 },
    })
  })

  it.each([
    { action: 'draft', fees: { rentSubsidyEnabled: true }, field: 'rentSubsidyPrice', label: '房租补贴' },
    { action: 'save', fees: { rentSubsidyEnabled: true, rentSubsidyPrice: 0 }, field: 'rentSubsidyPrice', label: '房租补贴' },
    { action: 'submit', fees: { rentSubsidyEnabled: true, rentSubsidyPrice: -1 }, field: 'rentSubsidyPrice', label: '房租补贴' },
    { action: 'draft', fees: { mgmtFeeEnabled: true, mgmtFeePrice: 0 }, field: 'mgmtFeePrice', label: '管理提成' },
    { action: 'save', fees: { mgmtFeeEnabled: true, mgmtFeePrice: null }, field: 'mgmtFeePrice', label: '管理提成' },
    { action: 'submit', fees: { mgmtFeeEnabled: true, mgmtFeePrice: -1 }, field: 'mgmtFeePrice', label: '管理提成' },
  ] as const)('启用 $label 的 $action 命令必须提供大于 0 的单价', async ({ action, fees, field, label }) => {
    const instance = createCrewWorkerCommandTestInstance()
    const draft = { ...formDefaults('crew'), name: '合成班组', trade: '泥工', contactName: '负责人', contactPhone: '13812345678', ...fees }
    const request = { ...session, requiredCapability: CREW_WRITE_CAPABILITY, commandId: 'invalid-fee-price', baseVersion: null, action, draft, attachments: {} }

    await expect(instance.executeCrew(request, session)).rejects.toMatchObject({
      problem: { code: 'validation-failed', fieldErrors: { [field]: [`启用${label}时，单价必须大于 0`] } },
    })
    expect(instance.crewRows()).toEqual([])
  })

  it('由服务器分配稳定 ID，幂等创建，并用 baseVersion 保护显式编辑', async () => {
    let sequence = 0
    const instance = createCrewWorkerCommandTestInstance({
      createId: kind => `${kind}-${++sequence}`,
      now: () => '2026-08-23T00:00:00.000Z',
    })
    const crewDraft = {
      ...formDefaults('crew'),
      name: '中央泥水班组',
      trade: '泥工',
      contactName: '陈师傅',
      contactPhone: '13812345678',
    }
    const crewRequest = {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CREW_WRITE_CAPABILITY,
      commandId: 'command-create-crew',
      baseVersion: null,
      action: 'save' as const,
      draft: crewDraft,
      attachments: {},
    }

    const createdCrew = await instance.executeCrew(crewRequest, session)
    expect(createdCrew).toMatchObject({ id: 'crew-1', version: '1' })
    await expect(instance.executeCrew(crewRequest, session)).resolves.toEqual(createdCrew)
    await expect(instance.executeCrew({ ...crewRequest, draft: { ...crewDraft, name: '异文班组' } }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.resolve('crew', crewRequest.commandId, session)).toEqual({ outcome: 'applied', result: createdCrew })
    expect(instance.resolve('crew', 'crew-never-applied', session)).toEqual({ outcome: 'not-applied', commandId: 'crew-never-applied' })
    await expect(instance.executeCrew({ ...crewRequest, commandId: 'crew-never-applied' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.crewRows()).toHaveLength(1)

    const workerDraft = {
      ...formDefaults('worker'),
      name: '张三',
      phone: '13912345678',
      trade: '泥工',
      bankName: '某银行',
      bankAccount: '6222021234567890',
      crewId: createdCrew.id,
    }
    const createdWorker = await instance.executeWorker({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: WORKER_WRITE_CAPABILITY,
      commandId: 'command-create-worker',
      baseVersion: null,
      action: 'save',
      draft: workerDraft,
      attachments: {},
    }, session)
    expect(createdWorker).toMatchObject({ id: 'worker-2', version: '1' })
    expect(instance.resolve('worker', createdWorker.commandId, session)).toEqual({ outcome: 'applied', result: createdWorker })
    expect(instance.workerRows()[0]).toMatchObject({ id: 'worker-2', crewId: 'crew-1' })

    await expect(instance.executeCrew({
      ...crewRequest,
      id: createdCrew.id,
      commandId: 'command-stale-edit',
      baseVersion: '0',
      draft: { ...crewDraft, id: createdCrew.id, name: '不应覆盖' },
    }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.crewRows()[0]?.name).toBe('中央泥水班组')
  })
})

describe('全局工人主档与项目关系复用', () => {
  it('选择原工人移入另一项目仍使用同ID，同名他人独立，原命令回执不随现名及当前项目改变', async () => {
    const capabilities = ['worker:list:read', 'crew:list:read', 'worker:write', 'worker:sensitive:read', 'project:list:read']
    const actor = { ...session, capabilities }
    const projects = [{ id: 'project-a', name: '第一项目', code: 'PA', status: '施工中', dataOrigin: 'real' as const, permission: 'allowed' as const }, { id: 'project-b', name: '第二项目', code: 'PB', status: '施工中', dataOrigin: 'real' as const, permission: 'allowed' as const }]
    let next = 0
    const commands = createCrewWorkerCommandTestInstance({ createId: () => `worker-global-${++next}`, projectIds: () => projects.map(row => row.id) })
    const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: WORKER_WRITE_CAPABILITY, commandId: 'original-worker-project-a', baseVersion: null, action: 'save' as const, draft: { ...formDefaults('worker'), name: '同名工人', phone: '13800000011', trade: '泥工', bankName: '合成银行', bankAccount: '62220011', currentProjectId: 'project-a' }, attachments: {} }
    const original = await commands.executeWorker(request, actor)
    const other = await commands.executeWorker({ ...request, commandId: 'another-person', draft: { ...request.draft, phone: '13800000022', bankAccount: '62220022', currentProjectId: 'project-b' } }, actor)
    const reads = createCrewWorkerReadTestInstance(() => capabilities, () => commands.crewRows(), () => commands.workerRows(), () => commands.sourceVersion(), undefined, () => ({ rows: projects, source: { key: 'projects', state: 'readable', sourceVersion: readSourceVersion('actual-test-project-owner', projects), asOf: '2026-10-04T10:00:00.000Z' } }))
    const before = await reads.listWorkers({ includeDemo: false })
    expect(before.items.map(row => row.worker.id).sort()).toEqual([original.id, other.id].sort())
    expect(before.items.find(row => row.worker.id === original.id)!.currentProject).toMatchObject({ id: 'project-a', label: '第一项目' })
    const form = commands.workerForm(original.id, actor)
    const moved = await commands.executeWorker({ ...request, id: original.id, commandId: 'reuse-worker-project-b', baseVersion: form.version, draft: { ...form.draft, currentProjectId: 'project-b', name: '工人现名' } }, actor)
    expect(moved).toMatchObject({ id: original.id, version: '2' })
    const after = await reads.listWorkers({ includeDemo: false })
    expect(after.items.find(row => row.worker.id === original.id)).toMatchObject({ worker: { id: original.id, label: '工人现名' }, currentProject: { id: 'project-b', label: '第二项目' } })
    expect(after.pagination.total).toBe(2)
    expect(after.meta.sourceVersion).not.toBe(before.meta.sourceVersion)
    expect(commands.resolve('worker', request.commandId, actor)).toEqual({ outcome: 'applied', result: original })
    expect(commands.workerForm(other.id, actor).draft).toMatchObject({ name: '同名工人', phone: '13800000022', currentProjectId: 'project-b' })
    await expect(commands.executeWorker({ ...request, id: original.id, commandId: 'invalid-project-target', baseVersion: '2', draft: { ...form.draft, currentProjectId: 'nonexistent-project' } }, actor)).rejects.toMatchObject({ problem: { code: 'validation-failed', fieldErrors: { currentProjectId: ['必须选择同工作区真实项目'] } } })
    expect(commands.workerRows()).toHaveLength(2)
    expect(commands.workerForm(original.id, actor).draft.currentProjectId).toBe('project-b')
  })

  it('项目目录读取失败不丢失全局工人，项目不可用不回落商务单据名或泄露隐藏关系', async () => {
    const commands = createCrewWorkerCommandTestInstance({ projectIds: () => ['project-hidden'] })
    const actor = { ...session, capabilities: ['worker:write', 'worker:list:read', 'crew:list:read', 'worker:sensitive:read', 'project:list:read'] }
    const worker = await commands.executeWorker({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: WORKER_WRITE_CAPABILITY, commandId: 'worker-project-unavailable', baseVersion: null, action: 'save', draft: { ...formDefaults('worker'), name: '全局资料仍可见', phone: '13800000011', bankName: '合成银行', bankAccount: '62220011', trade: '泥工', currentProjectId: 'project-hidden' }, attachments: {} }, actor)
    for (const code of ['unavailable', 'forbidden']) {
      const reads = createCrewWorkerReadTestInstance(() => actor.capabilities, () => [], () => commands.workerRows(), () => commands.sourceVersion(), undefined, () => {
        throw Object.assign(new Error('真实项目来源失败'), { problem: { code } })
      })
      const page = await reads.listWorkers({ includeDemo: false })
      expect(page.items[0]!.worker).toMatchObject({ id: worker.id, label: '全局资料仍可见' })
      expect(page.items[0]!.currentProject).toEqual({ state: code, entity: 'project', id: null, label: null, reason: code === 'forbidden' ? 'permission-denied' : 'source-unavailable' })
      expect(page.meta.sources.find(source => source.key === 'projects')).toEqual({ key: 'projects', state: code, sourceVersion: null, asOf: null })
      expect(JSON.stringify(page)).not.toContain('project-hidden')
    }
  })
})

describe('班组—工人中央 read 测试实例', () => {
  it('通过同一中央接缝返回演示关系，并区分空、禁止与来源错配', async () => {
    const instance = createCrewWorkerReadTestInstance(
      () => ['crew:list:read', 'worker:list:read', 'demo:read'],
      () => [],
      () => [],
      () => 'formal-v0',
    )

    const crews = await instance.listCrews({ includeDemo: 'true' })
    expect(crews.items.some(item => item.crew.id === 'crew_demo_001')).toBe(true)
    const worker = await instance.workerDetail('wkr_demo_001', { origin: 'demo', includeDemo: 'true' })
    expect(worker.assignments[0]).toMatchObject({ unit: { entity: 'quantity-unit' } })
    expect(worker.wageStatements[0]).toMatchObject({ statement: { entity: 'wage-statement' } })
    expect(worker.penalties[0]).toMatchObject({ penalty: { entity: 'subcontract-document' } })
    await expect(instance.relationFactIdentity('wage', 'wage-demo-1', { origin: 'demo', includeDemo: 'true' }))
      .resolves
      .toMatchObject({
        projectId: 'proj_demo_001',
        owners: [{ kind: 'crew', id: 'crew_demo_001' }, { kind: 'worker', id: 'wkr_demo_001' }],
      })
    await expect(instance.relationFactIdentity('assignment', 'qty_u_1_02_01', { origin: 'demo', includeDemo: 'true' }))
      .resolves
      .toMatchObject({
        projectId: 'proj_demo_001',
        owners: [{ kind: 'crew', id: 'crew_demo_001' }, { kind: 'worker', id: 'wkr_demo_001' }],
      })
    await expect(instance.relationFactIdentity('wage', 'not-there', { origin: 'demo', includeDemo: 'true' }))
      .rejects
      .toMatchObject({ problem: { code: 'not-found' } })

    await expect(instance.workerDetail('wkr_demo_001', { origin: 'real', includeDemo: 'true' }))
      .rejects
      .toMatchObject({ problem: { code: 'relationship-mismatch' } })
    instance.reset('empty')
    await expect(instance.listWorkers({})).resolves.toMatchObject({ items: [], empty: { reason: 'no-records' } })
    instance.reset('forbidden')
    await expect(instance.listCrews({})).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })
})
