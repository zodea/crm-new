import type { ScheduleBindingRead } from '~/lib/schedule/central-binding-contract'
import type { ScheduleCommand, ScheduleRead } from '~/lib/schedule/central-contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleProblem } from '~/lib/schedule/central-contract'
import { useScheduleStore } from '~/stores/schedule'

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
  it('只释放带当前编号未应用证明的冲突，其他编号仍需恢复', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    mocks.save.mockImplementationOnce(async (command: ScheduleCommand) => {
      const failure = scheduleProblem('stale-source', '来源变化')
      Object.assign(failure.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
      throw failure
    })
    await expect(store.setBaseline('p')).rejects.toThrow('来源变化')
    expect(store.pendingCommand).toBeNull()
    mocks.save.mockImplementationOnce(async () => {
      const failure = scheduleProblem('stale-source', '来源变化')
      Object.assign(failure.problem, { commandId: 'other', commandOutcome: 'not-applied' })
      throw failure
    })
    await expect(store.setBaseline('p')).rejects.toThrow('来源变化')
    expect(store.pendingCommand).not.toBeNull()
  })
  it('依赖保存的准确回读只推进对应任务的编辑版本；后续其他变更不能抬高草稿版本', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    store.beginPlanEdit('task')
    mocks.save.mockImplementation(async (command: ScheduleCommand) => ({ commandId: command.commandId, projectId: 'p', sourceVersion: 'v2', value: null }))
    mocks.read.mockResolvedValueOnce(read('p', 'v2'))
    await store.updateDependency('task', 'predecessor', 0)
    expect(mocks.save.mock.calls[0]![0].sourceVersion).toBe('v1')
    mocks.read.mockResolvedValueOnce(read('p', 'v3'))
    await store.recheck()
    mocks.save.mockRejectedValueOnce(scheduleProblem('stale-source', '其他修改'))
    await expect(store.saveTaskPlan('task', { plannedStart: '2026-09-01', plannedFinish: '2026-09-06', manualProgress: 0, floorPlans: [], dependency: null })).rejects.toThrow('其他修改')
    expect(mocks.save.mock.calls[1]![0].sourceVersion).toBe('v2')
  })
  it('依赖保存后读到更新的第三方版本时不改变编辑依据', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    store.beginPlanEdit('task')
    mocks.save.mockImplementationOnce(async (command: ScheduleCommand) => ({ commandId: command.commandId, projectId: 'p', sourceVersion: 'v2', value: null }))
    mocks.read.mockResolvedValueOnce(read('p', 'v3'))
    await store.updateDependency('task', 'predecessor', 0)
    mocks.save.mockRejectedValueOnce(scheduleProblem('stale-source', '其他修改'))
    await expect(store.saveTaskPlan('task', { plannedStart: '2026-09-01', plannedFinish: '2026-09-06', manualProgress: 0, floorPlans: [], dependency: null })).rejects.toThrow('其他修改')
    expect(mocks.save.mock.calls[1]![0].sourceVersion).toBe('v1')
  })
  it('拖动调整使用当前页面版本，不沿用先前任务草稿的版本', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    store.beginPlanEdit('task')
    mocks.read.mockResolvedValueOnce(read('p', 'v2'))
    await store.recheck()
    mocks.save.mockRejectedValueOnce(scheduleProblem('stale-source', '拒绝提交'))
    await expect(store.rescheduleTask('task', { plannedFinish: '2026-09-07' }, [])).rejects.toThrow('拒绝提交')
    expect(mocks.save.mock.calls[0]![0].sourceVersion).toBe('v2')
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
