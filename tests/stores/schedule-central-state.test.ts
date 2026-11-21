import type { ScheduleBindingRead } from '~/lib/schedule/central-binding-contract'
import type { ScheduleCommand, ScheduleRead } from '~/lib/schedule/central-contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleProblem } from '~/lib/schedule/central-contract'
import { useScheduleStore } from '~/stores/schedule'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
const mocks = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn(), read: vi.fn(), save: vi.fn(), binding: vi.fn(), resolve: vi.fn() }))
vi.mock('~/lib/db/connection', () => ({ execute: mocks.execute, select: mocks.select, withTransaction: vi.fn() }))
function read(projectId = 'p', version = 'v1'): ScheduleRead {
  return { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: version, capabilities: ['schedule:read', 'schedule:write'], snapshot: { id: projectId, name: projectId, code: projectId, groups: [], dependencies: [], disabledDependencies: [], plannedStart: null, plannedFinish: null, actualProgress: 0, plannedProgress: 0, deviationDays: 0 }, contracts: [], buildings: [], buildingCoverage: [], history: { logs: [], removedTasks: [], migrationEvidence: [] } }
}
beforeEach(() => {
  vi.clearAllMocks()
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  setActivePinia(createPinia())
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { schedule: { read: mocks.read, execute: mocks.save, binding: mocks.binding, resolve: mocks.resolve }, processLibraries: {} } }))
  mocks.read.mockImplementation(async query => read(query.projectId))
})

function binding(groupId = 'g', sourceVersion = 'preview-version'): ScheduleBindingRead {
  return { ...read(), sourceVersion, group: { id: groupId, projectId: 'p', name: groupId, scopeBasis: 'provisional', contractId: null }, contracts: [], state: 'unbound', binding: null, preview: { groupId, projectId: 'p', groupName: groupId, contractId: 'c', contractNo: 'C', contractName: '合同', buildings: [], extraContractBuildings: [], items: [], blockers: [], warnings: [], canBind: true } }
}

describe('中央绑定固定预览与原提交恢复', () => {
  it('后台工作区读取不能抬高已确认预览的来源版本，失响应恢复保持原绑定内容', async () => {
    const store = useScheduleStore()
    mocks.binding.mockResolvedValue(binding())
    const preview = await store.readBinding('p', 'g', 'c')
    mocks.read.mockResolvedValueOnce(read('p', 'new-workspace-version'))
    await store.loadProject('p')
    mocks.save.mockRejectedValueOnce(scheduleProblem('unavailable', '响应中断'))
    await expect(store.confirmBinding(preview)).rejects.toThrow('响应中断')
    const original = JSON.parse(JSON.stringify(store.pendingCommand?.command))
    expect(original).toMatchObject({ sourceVersion: 'preview-version', action: { kind: 'bind-contract', groupId: 'g', contractId: 'c' } })
    mocks.resolve.mockResolvedValueOnce({ outcome: 'applied', result: { commandId: original.commandId, projectId: 'p', sourceVersion: 'done', value: {} } })
    await store.recoverPending()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.resolve).toHaveBeenCalledWith({ commandId: original.commandId, workspaceId: original.workspaceId, actorId: original.actorId, family: 'schedule', targetId: 'p', action: 'bind-contract' })
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('切换同项目分组或关闭页面后，旧确认及迟到预览不能重开旧目标', async () => {
    const store = useScheduleStore()
    mocks.binding.mockResolvedValueOnce(binding('old'))
    const old = await store.readBinding('p', 'old', 'c')
    mocks.binding.mockResolvedValueOnce(binding('new'))
    await store.readBinding('p', 'new', 'c')
    await expect(store.confirmBinding(old)).rejects.toThrow('已变化')
    let finish!: (read: ScheduleBindingRead) => void
    mocks.binding.mockImplementationOnce(() => new Promise<ScheduleBindingRead>((resolve) => {
      finish = resolve
    }))
    const pending = store.readBinding('p', 'slow', 'c')
    store.cancelBindingRead()
    finish(binding('slow'))
    await expect(pending).rejects.toThrow('已变化')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})

describe('浏览器中央 WBS 项目会话与失响应恢复', () => {
  it.each([['v2', 'v2'], ['v3-from-another-write', 'v1']])('依赖写后读回 %s 时继续从 %s 保存原工序草稿', async (readVersion, expectedBasis) => {
    const store = useScheduleStore()
    await store.loadProject('p')
    store.beginPlanEdit('task')
    const apply = async (command: ScheduleCommand) => ({ commandId: command.commandId, projectId: 'p', sourceVersion: 'v2', value: {} })
    mocks.save.mockImplementationOnce(apply).mockImplementationOnce(apply)
    mocks.read.mockResolvedValueOnce(read('p', readVersion))
    await store.updateDependency('task', 'previous', 0)
    const draft = { task: { plannedStart: '2026-09-02', plannedFinish: '2026-09-06' }, floorPlans: [], dependency: null }
    await store.saveTaskPlan('task', draft)
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({ sourceVersion: 'v1', action: { kind: 'update-dependency' } })
    expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({ sourceVersion: expectedBasis, action: { kind: 'save-task-plan', draft } })
  })
  it('在同一工序草稿内连续恢复及移除依赖，各动作沿已核对的原任务新基准提交', async () => {
    const dependency = { id: 'dependency', predId: 'previous', succId: 'task', dependencyType: 'FS' as const, lagDays: 0 }
    const initial = read()
    initial.snapshot.disabledDependencies = [{ ...dependency, disabledAt: '2026-09-06', disabledReason: 'schedule-conflict', auditLogId: 'log' }]
    mocks.read.mockResolvedValueOnce(initial)
    const store = useScheduleStore()
    await store.loadProject('p')
    store.beginPlanEdit('task')
    const restored = read('p', 'v2')
    restored.snapshot.dependencies = [dependency]
    mocks.read.mockResolvedValueOnce(restored).mockResolvedValueOnce(read('p', 'v3')).mockResolvedValueOnce(read('p', 'v4'))
    for (const sourceVersion of ['v2', 'v3', 'v4'])
      mocks.save.mockImplementationOnce(async (command: ScheduleCommand) => ({ commandId: command.commandId, projectId: 'p', sourceVersion, value: {} }))
    await store.restoreDependency(dependency.id)
    await store.removeDependency(dependency.id)
    const draft = { task: { plannedStart: '2026-09-02', plannedFinish: '2026-09-06' }, floorPlans: [], dependency: null }
    await store.saveTaskPlan('task', draft)
    expect(mocks.save.mock.calls.map(([command]) => [command.action.kind, command.sourceVersion])).toEqual([
      ['restore-dependency', 'v1'],
      ['remove-dependency', 'v2'],
      ['save-task-plan', 'v3'],
    ])
  })
  it('甘特图拖动按当前排程提交，不沿用之前工序详情的编辑版本', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    store.beginPlanEdit('task')
    mocks.read.mockResolvedValueOnce(read('p', 'v2'))
    await store.loadProject('p')
    mocks.save.mockImplementationOnce(async (command: ScheduleCommand) => ({ commandId: command.commandId, projectId: 'p', sourceVersion: 'v3', value: {} }))
    mocks.read.mockResolvedValueOnce(read('p', 'v3'))
    await store.rescheduleTask('task', { plannedFinish: '2026-09-07' }, [])
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ sourceVersion: 'v2', action: { kind: 'reschedule-task', taskId: 'task', patch: { plannedFinish: '2026-09-07' }, dependencyIdsToDisable: [] } }))
  })
  it('正式读取从不访问本地 SQL；项目切换的迟到读取不覆盖新项目', async () => {
    let resolve!: (value: ScheduleRead) => void
    mocks.read.mockImplementationOnce(() => new Promise<ScheduleRead>((done) => {
      resolve = done
    }))
    const store = useScheduleStore()
    const oldRead = store.loadProject('old', '2026-09-12')
    await store.loadProject('new', '2026-09-12')
    resolve(read('old'))
    await oldRead
    expect(store.snapshot?.id).toBe('new')
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('原提交失响应再撤权仍保同一命令，重新读取权限后恢复且不重复新建', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    mocks.save.mockRejectedValueOnce(scheduleProblem('unavailable', '响应中断'))
    await expect(store.setBaseline('p')).rejects.toThrow('响应中断')
    const original = JSON.parse(JSON.stringify(store.pendingCommand!.command)) as ScheduleCommand
    await expect(store.setBaseline('p')).rejects.toThrow('原提交')
    mocks.read.mockRejectedValueOnce(scheduleProblem('forbidden', '权限暂不可用'))
    await expect(store.recheck()).rejects.toThrow()
    expect(store.pendingCommand?.descriptor.commandId).toBe(original.commandId)
    expect(store.canWrite).toBe(false)
    await store.recheck()
    mocks.resolve.mockResolvedValueOnce({ outcome: 'applied', result: { commandId: original.commandId, projectId: 'p', sourceVersion: 'v2', value: ['log'] } })
    await store.recoverPending()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.resolve.mock.calls[0]![0]).toEqual({ commandId: original.commandId, workspaceId: original.workspaceId, actorId: original.actorId, family: 'schedule', targetId: 'p', action: 'set-baseline' })
    expect(store.pendingCommand).toBeNull()
  })
  it('旧项目基线确认不能作用于新项目；已写成功但回读失败仍保原命令', async () => {
    const store = useScheduleStore()
    await store.loadProject('old')
    await store.loadProject('new')
    await expect(store.setBaseline('old')).rejects.toThrow('项目已变化')
    expect(mocks.save).not.toHaveBeenCalled()
    mocks.save.mockImplementationOnce(async (command: ScheduleCommand) => ({ commandId: command.commandId, projectId: 'new', sourceVersion: 'v2', value: [] }))
    mocks.read.mockRejectedValueOnce(scheduleProblem('forbidden', '读回无权'))
    await expect(store.setBaseline('new')).rejects.toThrow()
    expect(store.pendingCommand?.descriptor.targetId).toBe('new')
    expect(store.pendingCommand?.state).toBe('applied')
    mocks.read.mockResolvedValueOnce(read('new', 'v2'))
    await store.recoverPending()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('失响应后恢复遇通用陈旧来源不能释放原ID，只有匹配未应用证明才释放', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    mocks.save.mockRejectedValueOnce(scheduleProblem('unavailable', 'lost'))
    await expect(store.setBaseline('p')).rejects.toThrow()
    const id = store.pendingCommand!.descriptor.commandId
    mocks.resolve.mockRejectedValueOnce(scheduleProblem('stale-source', '来源回查变化'))
    await expect(store.recoverPending()).rejects.toThrow()
    expect(store.pendingCommand!.descriptor.commandId).toBe(id)
    mocks.resolve.mockResolvedValueOnce({ outcome: 'not-applied', commandId: id })
    await expect(store.recoverPending()).rejects.toThrow()
    expect(store.pendingCommand).toBeNull()
  })
})
