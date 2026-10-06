import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '~/lib/crew-worker/repository'
import { formDefaults } from '~/lib/master-data/page'
import { useCrewWorkerCommandStore } from '~/stores/crew-worker-command'
import { createCrewWorkerCommandTestInstance } from '../../server/utils/crew-worker-command-test-instance'

const actor = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['crew:write', 'worker:write', 'worker:sensitive:read'] }
let persisted: Map<string, string>
beforeEach(() => {
  setActivePinia(createPinia())
  persisted = new Map()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => persisted.get(key) ?? null, setItem: (key: string, value: string) => persisted.set(key, value), removeItem: (key: string) => persisted.delete(key) })
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  let sequence = 0
  const owner = createCrewWorkerCommandTestInstance({ createId: kind => `${kind}-record-${++sequence}`, now: () => '2026-10-04T00:00:00.000Z' })
  const repository = {
    context: vi.fn(async () => ({ ...actor, capabilities: [...actor.capabilities] })),
    loadCrewForm: vi.fn(async (id: string) => owner.crewForm(id, actor)),
    loadWorkerForm: vi.fn(async (id: string) => owner.workerForm(id, actor)),
    executeCrew: vi.fn(async (request: Parameters<typeof owner.executeCrew>[0]) => owner.executeCrew(request, actor)),
    executeWorker: vi.fn(async (request: Parameters<typeof owner.executeWorker>[0]) => owner.executeWorker(request, actor)),
    resolveCrew: vi.fn(async (id: string) => owner.resolve('crew', id, actor)),
    resolveWorker: vi.fn(async (id: string) => owner.resolve('worker', id, actor)),
  }
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { crewWorkerCommands: repository } }))
  return { owner, repository, store: useCrewWorkerCommandStore() }
}

describe.each(['crew', 'worker'] as const)('%s 原命令恢复与合法读回', (kind) => {
  it('真正写入但响应丢失，刷新只恢复原编号；原回执和档案不重复', async () => {
    const { owner, repository, store } = setup()
    const session = store.createSession()
    await store.hydrate(session, kind, null)
    const execute = kind === 'crew' ? repository.executeCrew : repository.executeWorker
    const actual = execute.getMockImplementation()!
    execute.mockImplementationOnce(async (request) => {
      await actual(request as never)
      throw new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '响应丢失', true))
    })
    const draft = { ...formDefaults(kind), name: '原提交档案' }
    const save = kind === 'crew' ? store.saveCrew : store.saveWorker
    await expect(save(session, draft, 'draft')).rejects.toThrow('响应丢失')
    const pending = store.formSession(session, kind).pending!
    const originalId = pending.id
    const encoded = [...persisted.values()][0]!
    expect(JSON.parse(encoded)).toEqual({ commandId: originalId, workspaceId: actor.workspaceId, actorId: actor.actorId, family: kind, targetId: null, action: 'draft' })
    draft.name = '后来输入'
    await expect(save(session, draft, 'draft')).rejects.toThrow('先核对原编号')
    expect(execute).toHaveBeenCalledTimes(1)
    const reopened = store.createSession()
    const recovered = await store.hydrate(reopened, kind, null)
    expect(recovered.draft?.name).toBe('原提交档案')
    expect(recovered.productionNotice).toContain('保存成功')
    expect(persisted.size).toBe(0)
    expect(kind === 'crew' ? owner.crewRows() : owner.workerRows()).toHaveLength(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('回执已知但读回失败只重试读取；期间后来输入继续保留', async () => {
    const { repository, store } = setup()
    const session = store.createSession()
    await store.hydrate(session, kind, null)
    const load = kind === 'crew' ? repository.loadCrewForm : repository.loadWorkerForm
    load.mockRejectedValueOnce(new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '读取失败', true)))
    const draft = { ...formDefaults(kind), name: '保存原文' }
    const save = kind === 'crew' ? store.saveCrew : store.saveWorker
    await expect(save(session, draft, 'draft')).rejects.toThrow('已保存待刷新')
    expect(store.formSession(session, kind).pending?.result?.version).toBe('1')
    draft.name = '读回期间后来输入'
    const resolved = await store.recover(session, kind)
    expect(resolved.outcome).toBe('applied')
    expect(draft.name).toBe('读回期间后来输入')
    expect(kind === 'crew' ? repository.executeCrew : repository.executeWorker).toHaveBeenCalledTimes(1)
    expect(kind === 'crew' ? repository.resolveCrew : repository.resolveWorker).not.toHaveBeenCalled()
    expect(persisted.size).toBe(0)
  })

  it('提交前身份检查迟到，页面停用后不发送且保原编号；核对封存后才清理', async () => {
    const { repository, store } = setup()
    const session = store.createSession()
    await store.hydrate(session, kind, null)
    let finish!: (value: typeof actor) => void
    repository.context.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const save = kind === 'crew' ? store.saveCrew : store.saveWorker
    const pending = save(session, { ...formDefaults(kind), name: '尚未发送' }, 'draft')
    store.deactivate(session, kind)
    finish(actor)
    await expect(pending).rejects.toThrow('恢复原编号')
    expect(kind === 'crew' ? repository.executeCrew : repository.executeWorker).not.toHaveBeenCalled()
    expect(store.formSession(session, kind).pending).not.toBeNull()
    const oldId = store.formSession(session, kind).pending!.id
    const recovered = await store.recover(session, kind)
    expect(recovered.outcome).toBe('not-applied')
    expect(persisted.size).toBe(0)
    expect(kind === 'crew' ? repository.resolveCrew : repository.resolveWorker).toHaveBeenCalledWith(oldId)
  })
})
