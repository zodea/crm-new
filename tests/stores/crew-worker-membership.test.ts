import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '~/lib/crew-worker/repository'
import {
  CrewWorkerMembershipConflictError,
  useCrewWorkerCommandStore,
} from '~/stores/crew-worker-command'

const repositories = {
  crewWorkerCommands: {
    context: vi.fn(),
    loadWorkerForm: vi.fn(),
    executeWorker: vi.fn(),
  },
}

describe('班组成员关系 command store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: repositories }))
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'membership-command-1') })
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

    await expect(store.setWorkerCrewMembership(session, input)).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
    await store.setWorkerCrewMembership(session, input)

    expect(repositories.crewWorkerCommands.loadWorkerForm).toHaveBeenCalledTimes(1)
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
    await expect(store.setWorkerCrewMembership(second, { ...input, crewId: 'crew-b' })).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
    await expect(store.setWorkerCrewMembership(first, input)).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
    const requests = repositories.crewWorkerCommands.executeWorker.mock.calls.map(([request]) => request)
    expect(requests[2]).toEqual(requests[0])
    expect(requests[1].commandId).not.toBe(requests[0].commandId)
    expect(requests[1].draft.crewId).toBe('crew-b')
  })
})
