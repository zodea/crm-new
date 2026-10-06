import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCrewWorkerCommandStore } from '~/stores/crew-worker-command'

beforeEach(() => {
  setActivePinia(createPinia())
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe.each(['crew', 'worker'] as const)('%s 保留输入后的重新验权', (kind) => {
  it('只读取原目标与身份，不前移版本或清理原命令', async () => {
    let version = '2'
    const context = vi.fn(async () => ({ workspaceId: 'workspace-a', actorId: 'actor-a', capabilities: [`${kind}:write`] }))
    const load = vi.fn(async (id: string) => ({ draft: { id, name: '档案' }, version, attachments: [], updatedAt: '' }))
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { crewWorkerCommands: { context, loadCrewForm: load, loadWorkerForm: load } } }))
    const store = useCrewWorkerCommandStore()
    const session = store.createSession()
    await store.hydrate(session, kind, 'original')
    version = '8'
    const evidence = await store.revalidate(session, kind)
    expect(evidence.form?.version).toBe('8')
    expect(load).toHaveBeenLastCalledWith('original')
    expect(session.targets[kind]).toBe('original')
    expect(session.versions[kind]).toBe('2')
    const original = store.formSession(session, kind)
    original.pending = { id: 'original-command', fingerprint: 'original-content', result: null, descriptor: { commandId: 'original-command', workspaceId: 'workspace-a', actorId: 'actor-a', family: kind, targetId: 'original', action: 'draft' } }
    await expect(store.revalidate(session, kind)).rejects.toThrow('先核对原提交')
    expect(original.pending.id).toBe('original-command')
    expect(original.baseVersion).toBe('2')
  })

  it('身份、权限或返回目标变化均拒绝，原输入基线和命令不动', async () => {
    let actorId = 'actor-a'
    let capabilities = [`${kind}:write`]
    let returnedId = 'original'
    const load = vi.fn(async () => ({ draft: { id: returnedId, name: '档案' }, version: '2', attachments: [], updatedAt: '' }))
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { crewWorkerCommands: {
      context: async () => ({ workspaceId: 'workspace-a', actorId, capabilities }),
      loadCrewForm: load,
      loadWorkerForm: load,
    } } }))
    const store = useCrewWorkerCommandStore()
    const session = store.createSession()
    await store.hydrate(session, kind, 'original')
    actorId = 'actor-b'
    await expect(store.revalidate(session, kind)).rejects.toThrow('身份或权限')
    actorId = 'actor-a'
    capabilities = []
    await expect(store.revalidate(session, kind)).rejects.toThrow('身份或权限')
    capabilities = [`${kind}:write`]
    returnedId = 'other'
    await expect(store.revalidate(session, kind)).rejects.toThrow('原编辑目标')
    expect(session.targets[kind]).toBe('original')
    expect(session.versions[kind]).toBe('2')
    expect(store.formSession(session, kind).pending).toBeNull()
  })
})

describe('成员命令异步验权边界', () => {
  it('context/form迟到时操作已失效，不发送命令且不生成替代恢复编号', async () => {
    let finish!: (value: unknown) => void
    const executeWorker = vi.fn()
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { crewWorkerCommands: {
      context: async () => ({ workspaceId: 'workspace-a', actorId: 'actor-a', capabilities: ['worker:write'] }),
      loadWorkerForm: () => new Promise((resolve) => { finish = resolve }),
      executeWorker,
    } } }))
    const store = useCrewWorkerCommandStore()
    const session = store.createMembershipSession()
    let current = true
    const pending = store.setWorkerCrewMembership(session, { workerId: 'worker-1', expectedCrewId: null, crewId: 'crew-original' }, () => current)
    current = false
    finish({ draft: { id: 'worker-1', crewId: null, status: 'submitted' }, version: '2' })
    await expect(pending).rejects.toThrow('已失效')
    expect(executeWorker).not.toHaveBeenCalled()
    expect(session.pending).toBeNull()
  })
})
