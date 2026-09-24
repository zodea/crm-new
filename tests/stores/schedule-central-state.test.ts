import type { ScheduleBindingRead } from '~/lib/schedule/central-binding-contract'
import type { ScheduleCommand, ScheduleRead } from '~/lib/schedule/central-contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleProblem } from '~/lib/schedule/central-contract'
import { useScheduleStore } from '~/stores/schedule'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
const mocks = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn(), read: vi.fn(), save: vi.fn(), binding: vi.fn() }))
vi.mock('~/lib/db/connection', () => ({ execute: mocks.execute, select: mocks.select, withTransaction: vi.fn() }))
function read(projectId = 'p', version = 'v1'): ScheduleRead {
  return { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: version, capabilities: ['schedule:read', 'schedule:write'], snapshot: { id: projectId, name: projectId, code: projectId, groups: [], dependencies: [], disabledDependencies: [], plannedStart: null, plannedFinish: null, actualProgress: 0, plannedProgress: 0, deviationDays: 0 }, contracts: [], buildings: [], buildingCoverage: [], history: { logs: [], removedTasks: [], migrationEvidence: [] } }
}
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { schedule: { read: mocks.read, execute: mocks.save, binding: mocks.binding }, processLibraries: {} } }))
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
    const original = JSON.parse(JSON.stringify(store.pendingCommand))
    expect(original).toMatchObject({ sourceVersion: 'preview-version', action: { kind: 'bind-contract', groupId: 'g', contractId: 'c' } })
    mocks.save.mockImplementationOnce(async command => ({ commandId: command.commandId, projectId: 'p', sourceVersion: 'done', value: {} }))
    await store.recoverPending()
    expect(mocks.save.mock.calls[1]![0]).toEqual(original)
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
    const original = JSON.parse(JSON.stringify(store.pendingCommand!)) as ScheduleCommand
    await expect(store.setBaseline('p')).rejects.toThrow('原提交')
    mocks.read.mockRejectedValueOnce(scheduleProblem('forbidden', '权限暂不可用'))
    await expect(store.recheck()).rejects.toThrow()
    expect(store.pendingCommand?.commandId).toBe(original.commandId)
    expect(store.canWrite).toBe(false)
    await store.recheck()
    mocks.save.mockImplementationOnce(async (command: ScheduleCommand) => ({ commandId: command.commandId, projectId: 'p', sourceVersion: 'v2', value: ['log'] }))
    await store.recoverPending()
    expect(mocks.save.mock.calls[1]![0]).toEqual(original)
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
    expect(store.pendingCommand?.projectId).toBe('new')
  })
  it('失响应后恢复遇通用陈旧来源不能释放原ID，只有匹配未应用证明才释放', async () => {
    const store = useScheduleStore()
    await store.loadProject('p')
    mocks.save.mockRejectedValueOnce(scheduleProblem('unavailable', 'lost'))
    await expect(store.setBaseline('p')).rejects.toThrow()
    const id = store.pendingCommand!.commandId
    mocks.save.mockRejectedValueOnce(scheduleProblem('stale-source', '来源回查变化'))
    await expect(store.recoverPending()).rejects.toThrow()
    expect(store.pendingCommand!.commandId).toBe(id)
    const rejected = scheduleProblem('stale-source', '原提交明确未应用')
    Object.assign(rejected.problem, { commandId: id, commandOutcome: 'not-applied' })
    mocks.save.mockRejectedValueOnce(rejected)
    await expect(store.recoverPending()).rejects.toThrow()
    expect(store.pendingCommand).toBeNull()
  })
})
