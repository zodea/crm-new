import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '~/lib/crew-worker/repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import {
  CrewWorkerMembershipConflictError,
  useCrewWorkerCommandStore,
} from '~/stores/crew-worker-command'

const repositories = {
  crewWorkerCommands: {
    context: vi.fn(),
    loadWorkerForm: vi.fn(),
    executeWorker: vi.fn(),
    resolveWorker: vi.fn(),
  },
}
let recovery: Map<string, string>

describe('班组成员关系 command store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: repositories }))
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'membership-command-1') })
    const values = recovery = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      get length() { return values.size },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    repositories.crewWorkerCommands.resolveWorker.mockImplementation(async (commandId: string) => ({ outcome: 'not-applied', commandId }))
    repositories.crewWorkerCommands.context.mockResolvedValue({
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      capabilities: ['worker:write'],
    })
    repositories.crewWorkerCommands.loadWorkerForm.mockResolvedValue({
      draft: {
        id: 'worker-1',
        name: '张师傅',
        phone: '13800000000',
        trade: '泥工',
        bankName: '示例银行',
        bankAccount: '6222',
        crewId: null,
        status: 'submitted',
      },
      attachments: [],
      version: '7',
      updatedAt: '2026-08-23T00:00:00.000Z',
    })
  })

  it('以页面所见原归属和最新版本提交，只改工人班组归属', async () => {
    repositories.crewWorkerCommands.executeWorker.mockResolvedValue({
      id: 'worker-1',
      commandId: 'membership-command-1',
      version: '8',
      updatedAt: '2026-08-24T00:00:00.000Z',
      attachmentIds: [],
    })
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()

    repositories.crewWorkerCommands.loadWorkerForm.mockResolvedValueOnce(await repositories.crewWorkerCommands.loadWorkerForm()).mockResolvedValueOnce({ draft: { id: 'worker-1', crewId: 'crew-target' }, version: '8' })

    await store.setWorkerCrewMembership(session, { workerId: 'worker-1', expectedCrewId: null, crewId: 'crew-target' })

    expect(repositories.crewWorkerCommands.executeWorker).toHaveBeenCalledWith(expect.objectContaining({
      id: 'worker-1',
      commandId: 'membership-command-1',
      baseVersion: '7',
      action: 'save',
      draft: expect.objectContaining({ name: '张师傅', crewId: 'crew-target' }),
      attachments: {},
    }))
  })

  it('原归属已变化时拒绝静默覆盖并且不提交命令', async () => {
    repositories.crewWorkerCommands.loadWorkerForm.mockResolvedValue({
      draft: { id: 'worker-1', crewId: 'crew-other', status: 'submitted' },
      attachments: [],
      version: '8',
      updatedAt: '2026-08-24T00:00:00.000Z',
    })
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()

    await expect(store.setWorkerCrewMembership(session, {
      workerId: 'worker-1',
      expectedCrewId: null,
      crewId: 'crew-target',
    })).rejects.toBeInstanceOf(CrewWorkerMembershipConflictError)
    expect(repositories.crewWorkerCommands.executeWorker).not.toHaveBeenCalled()
  })

  it('其他工人字段造成版本冲突时使用准确提示并读取最新归属', async () => {
    repositories.crewWorkerCommands.executeWorker.mockRejectedValue(
      new CrewWorkerRepositoryProblem(crewWorkerProblem('conflict', '工人版本已变化')),
    )
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()

    await expect(store.setWorkerCrewMembership(session, {
      workerId: 'worker-1',
      expectedCrewId: null,
      crewId: 'crew-target',
    })).rejects.toMatchObject({
      message: '工人档案或班组归属已变化，已刷新最新成员关系，请重新选择',
      latestCrewId: null,
    })
    expect(repositories.crewWorkerCommands.loadWorkerForm).toHaveBeenCalledTimes(2)
  })

  it('响应丢失后重试复用同一个 commandId 和 baseVersion', async () => {
    repositories.crewWorkerCommands.executeWorker
      .mockRejectedValueOnce(new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '响应丢失', true)))
      .mockResolvedValueOnce({
        id: 'worker-1',
        commandId: 'membership-command-1',
        version: '8',
        updatedAt: '2026-08-24T00:00:00.000Z',
        attachmentIds: [],
      })
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()
    const input = { workerId: 'worker-1', expectedCrewId: null, crewId: 'crew-target' }

    const original = await repositories.crewWorkerCommands.loadWorkerForm()
    repositories.crewWorkerCommands.loadWorkerForm.mockClear().mockResolvedValueOnce(original).mockResolvedValueOnce({ draft: { id: 'worker-1', crewId: 'crew-target' }, version: '8' })

    await expect(store.setWorkerCrewMembership(session, input)).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
    await store.setWorkerCrewMembership(session, input)

    expect(repositories.crewWorkerCommands.loadWorkerForm).toHaveBeenCalledTimes(2)
    expect(repositories.crewWorkerCommands.executeWorker.mock.calls[0]?.[0].commandId)
      .toBe(repositories.crewWorkerCommands.executeWorker.mock.calls[1]?.[0].commandId)
    expect(repositories.crewWorkerCommands.executeWorker.mock.calls[0]?.[0].baseVersion)
      .toBe(repositories.crewWorkerCommands.executeWorker.mock.calls[1]?.[0].baseVersion)
  })

  it('两个班组页面的失败操作分别重试，不能互换请求身份', async () => {
    let serial = 0
    vi.stubGlobal('crypto', { randomUUID: () => `membership-${++serial}` })
    repositories.crewWorkerCommands.executeWorker.mockRejectedValue(
      new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '响应丢失', true)),
    )
    const store = useCrewWorkerCommandStore()
    const first = store.createMembershipSession()
    const second = store.createMembershipSession()
    const input = { workerId: 'worker-1', expectedCrewId: null, crewId: 'crew-a' }
    await expect(store.setWorkerCrewMembership(first, input)).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
    repositories.crewWorkerCommands.loadWorkerForm.mockResolvedValueOnce({ draft: { id: 'worker-2', name: '另一工人', crewId: null, status: 'submitted' }, version: '7' })
    await expect(store.setWorkerCrewMembership(second, { ...input, workerId: 'worker-2', crewId: 'crew-b' })).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
    await expect(store.setWorkerCrewMembership(first, input)).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
    const requests = repositories.crewWorkerCommands.executeWorker.mock.calls.map(([request]) => request)
    expect(requests[2]).toEqual(requests[0])
    expect(requests[1].commandId).not.toBe(requests[0].commandId)
    expect(requests[1].draft.crewId).toBe('crew-b')
  })

  it('未知原操作禁止另一归属替换编号；刷新后只在原班组独立核对封存', async () => {
    repositories.crewWorkerCommands.executeWorker.mockRejectedValue(new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '响应丢失', true)))
    const store = useCrewWorkerCommandStore()
    const first = store.createMembershipSession()
    const input = { workerId: 'worker-1', expectedCrewId: null, crewId: 'crew-a' }
    await expect(store.setWorkerCrewMembership(first, input)).rejects.toThrow('响应丢失')
    const original = first.pending!.request
    await expect(store.setWorkerCrewMembership(first, { ...input, crewId: 'crew-b' })).rejects.toThrow('不能以新归属')
    expect(first.pending!.request).toEqual(original)
    expect(repositories.crewWorkerCommands.executeWorker).toHaveBeenCalledTimes(1)
    const otherPage = store.createMembershipSession()
    await expect(store.setWorkerCrewMembership(otherPage, { ...input, crewId: 'crew-b' })).rejects.toThrow('原成员提交恢复入口')
    expect(await store.inspectMembershipRecovery(otherPage, 'crew-b')).toEqual([])
    const [item] = await store.inspectMembershipRecovery(otherPage, 'crew-a')
    await expect(store.recoverMembership(otherPage, 'crew-a', item!.descriptor)).resolves.toEqual({ outcome: 'not-applied', commandId: original.commandId })
    expect(repositories.crewWorkerCommands.resolveWorker).toHaveBeenCalledWith(original.commandId)
    expect(repositories.crewWorkerCommands.executeWorker).toHaveBeenCalledTimes(1)
    expect(recovery.size).toBe(0)
  })

  it('回执已知但后读失败，保持原编号并只重读；保存内容不进入最小恢复描述', async () => {
    const result = { id: 'worker-1', commandId: 'membership-command-1', version: '8', updatedAt: '2026-10-04T00:00:00.000Z', attachmentIds: [] }
    repositories.crewWorkerCommands.executeWorker.mockResolvedValue(result)
    const original = await repositories.crewWorkerCommands.loadWorkerForm()
    repositories.crewWorkerCommands.loadWorkerForm.mockClear().mockResolvedValueOnce(original).mockRejectedValueOnce(new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '后读失败', true))).mockResolvedValueOnce({ draft: { id: 'worker-1', crewId: 'crew-target' }, version: '8' })
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()
    const input = { workerId: 'worker-1', expectedCrewId: null, crewId: 'crew-target' }
    await expect(store.setWorkerCrewMembership(session, input)).rejects.toThrow('后读失败')
    expect(session.pending?.result).toEqual(result)
    expect(JSON.parse([...recovery.values()][0]!)).toEqual({ workspaceId: 'workspace-default', actorId: 'actor-default', commandId: 'membership-command-1', family: 'worker-membership', targetId: 'worker-1', action: 'membership', scopeId: 'crew-target' })
    const [item] = await store.inspectMembershipRecovery(session, 'crew-target')
    expect(item!.resultKnown).toBe(true)
    await expect(store.recoverMembership(session, 'crew-target', item!.descriptor)).resolves.toEqual({ outcome: 'applied', result })
    expect(repositories.crewWorkerCommands.executeWorker).toHaveBeenCalledTimes(1)
    expect(repositories.crewWorkerCommands.resolveWorker).not.toHaveBeenCalled()
    expect(session.pending).toBeNull()
    expect(recovery.size).toBe(0)
  })

  it('真写后响应丢失，刷新后按原键核对应用结果，后读失败后只重读', async () => {
    const result = { id: 'worker-1', commandId: 'membership-command-1', version: '8', updatedAt: '2026-10-04T00:00:00.000Z', attachmentIds: [] }
    repositories.crewWorkerCommands.executeWorker.mockRejectedValue(new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '响应丢失', true)))
    const store = useCrewWorkerCommandStore()
    await expect(store.setWorkerCrewMembership(store.createMembershipSession(), { workerId: 'worker-1', expectedCrewId: null, crewId: 'crew-target' })).rejects.toThrow('响应丢失')
    const originalEncoded = [...recovery.values()][0]!
    repositories.crewWorkerCommands.resolveWorker.mockResolvedValue({ outcome: 'applied', result })
    repositories.crewWorkerCommands.loadWorkerForm.mockRejectedValueOnce(new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', 'GET 503', true))).mockResolvedValue({ draft: { id: 'worker-1', crewId: 'crew-target' }, version: '8' })
    const refreshed = store.createMembershipSession()
    const [item] = await store.inspectMembershipRecovery(refreshed, 'crew-target')
    expect(item!.resultKnown).toBe(false)
    await expect(store.recoverMembership(refreshed, 'crew-target', item!.descriptor)).rejects.toThrow('GET 503')
    expect([...recovery.values()]).toEqual([originalEncoded])
    const [known] = await store.inspectMembershipRecovery(refreshed, 'crew-target')
    expect(known!.resultKnown).toBe(true)
    await expect(store.recoverMembership(refreshed, 'crew-target', known!.descriptor)).resolves.toEqual({ outcome: 'applied', result })
    expect(repositories.crewWorkerCommands.executeWorker).toHaveBeenCalledTimes(1)
    expect(repositories.crewWorkerCommands.resolveWorker).toHaveBeenCalledExactlyOnceWith('membership-command-1')
    expect(recovery.size).toBe(0)
  })

  function preserveDescriptor(extra: object = {}) {
    const descriptor = { workspaceId: 'workspace-default', actorId: 'actor-default', family: 'worker-membership', targetId: 'worker-legacy', action: 'membership', commandId: 'legacy-member-1', ...extra }
    const key = commandRecoveryKey(descriptor)
    recovery.set(key, JSON.stringify(descriptor))
    return descriptor
  }

  it('旧六字段最小描述保全，显式核对原工人，不补写当前班组或写体', async () => {
    const legacy = preserveDescriptor()
    const before = [...recovery.values()][0]
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()
    const items = await store.inspectMembershipRecovery(session, 'any-current-crew')
    expect(items.map(item => item.descriptor)).toEqual([legacy])
    expect(items[0]!.descriptor.scopeId).toBeUndefined()
    expect([...recovery.values()]).toEqual([before])
    await expect(store.recoverMembership(session, 'any-current-crew', legacy)).resolves.toEqual({ outcome: 'not-applied', commandId: legacy.commandId })
    expect(repositories.crewWorkerCommands.resolveWorker).toHaveBeenCalledExactlyOnceWith(legacy.commandId)
    expect(repositories.crewWorkerCommands.loadWorkerForm).not.toHaveBeenCalled()
    expect(repositories.crewWorkerCommands.executeWorker).not.toHaveBeenCalled()
  })

  it.each([{ unknown: 'private bank data' }, { scopeId: 1 }, { scopeId: '' }, { scopeId: 'crew/wrong' }, { scopeId: 'crew\u0000bad' }])('未知字段或非法 scope 拒绝读取并保全原记录 %j', async (extra) => {
    preserveDescriptor(extra)
    const before = [...recovery.entries()]
    const storage = createCommandRecoveryStorage()
    expect(() => storage.read(before[0]![0])).toThrow('无法可靠核对')
    await expect(useCrewWorkerCommandStore().inspectMembershipRecovery(useCrewWorkerCommandStore().createMembershipSession(), 'crew-current')).rejects.toThrow('无法可靠核对')
    expect([...recovery.entries()]).toEqual(before)
    expect(repositories.crewWorkerCommands.resolveWorker).not.toHaveBeenCalled()
  })

  it('合法 scope 仅定位原班组；错误 scope 与另一个 actor 均不泄露或清除原工人', async () => {
    const descriptor = preserveDescriptor({ scopeId: 'crew-original' })
    const before = [...recovery.entries()]
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()
    expect(await store.inspectMembershipRecovery(session, 'crew-other')).toEqual([])
    await expect(store.recoverMembership(session, 'crew-other', descriptor)).rejects.toThrow('班组上下文不一致')
    repositories.crewWorkerCommands.context.mockResolvedValue({ workspaceId: 'workspace-default', actorId: 'actor-other', capabilities: ['worker:write'] })
    expect(await store.inspectMembershipRecovery(session, 'crew-original')).toEqual([])
    await expect(store.recoverMembership(session, 'crew-original', descriptor)).rejects.toThrow('身份或权限已变化')
    expect([...recovery.entries()]).toEqual(before)
    expect(repositories.crewWorkerCommands.resolveWorker).not.toHaveBeenCalled()
  })

  it('核对读取中 actor 切换或页面来源失效不发布旧身份、保全原键', async () => {
    const descriptor = preserveDescriptor({ scopeId: 'crew-original' })
    const before = [...recovery.entries()]
    const store = useCrewWorkerCommandStore()
    let current = true
    repositories.crewWorkerCommands.context.mockResolvedValueOnce({ workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['worker:write'] }).mockImplementationOnce(async () => {
      current = false
      return { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['worker:write'] }
    })
    await expect(store.inspectMembershipRecovery(store.createMembershipSession(), 'crew-original', () => current)).rejects.toThrow('身份或权限已变化')
    current = true
    repositories.crewWorkerCommands.context.mockResolvedValue({ workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['worker:write'] })
    repositories.crewWorkerCommands.resolveWorker.mockImplementationOnce(async () => {
      repositories.crewWorkerCommands.context.mockResolvedValue({ workspaceId: 'workspace-default', actorId: 'actor-other', capabilities: ['worker:write'] })
      return { outcome: 'not-applied', commandId: descriptor.commandId }
    })
    await expect(store.recoverMembership(store.createMembershipSession(), 'crew-original', descriptor)).rejects.toThrow('身份或权限已变化')
    expect([...recovery.entries()]).toEqual(before)
    expect(repositories.crewWorkerCommands.executeWorker).not.toHaveBeenCalled()
  })

  it.each(['wrong-command', 'wrong-worker', 'old-version'])('原回执或重读对象不一致不能清理恢复定位 %s', async (fault) => {
    const descriptor = preserveDescriptor({ scopeId: 'crew-original' })
    const before = [...recovery.entries()]
    const result = { id: fault === 'wrong-worker' ? 'worker-other' : 'worker-legacy', commandId: fault === 'wrong-command' ? 'command-other' : descriptor.commandId, version: '8', updatedAt: '2026-10-04T00:00:00.000Z', attachmentIds: [] }
    repositories.crewWorkerCommands.resolveWorker.mockResolvedValue({ outcome: 'applied', result })
    repositories.crewWorkerCommands.loadWorkerForm.mockResolvedValue({ draft: { id: 'worker-legacy' }, version: fault === 'old-version' ? '7' : '8' })
    const store = useCrewWorkerCommandStore()
    await expect(store.recoverMembership(store.createMembershipSession(), 'crew-original', descriptor)).rejects.toThrow()
    expect([...recovery.entries()]).toEqual(before)
    expect(repositories.crewWorkerCommands.executeWorker).not.toHaveBeenCalled()
  })
})
