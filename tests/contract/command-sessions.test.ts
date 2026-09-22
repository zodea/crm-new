import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { f2FormDefaults } from '~/lib/contract/page'
import { useConstructionContractCommandStore } from '~/stores/construction-contract-command'
import { useMaterialContractCommandStore } from '~/stores/material-contract-command'
import { useSubcontractContractCommandStore } from '~/stores/subcontract-contract-command'

const cases = [
  ['construction', useConstructionContractCommandStore],
  ['material', useMaterialContractCommandStore],
  ['subcontract', useSubcontractContractCommandStore],
] as const

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

describe.each(cases)('%s 合同表单会话', (kind, useStore) => {
  it('失败重试复用命令身份，保存并新建后不会沿用刚保存的记录', async () => {
    const repository = {
      context: vi.fn().mockResolvedValue({ workspaceId: 'w', actorId: 'u', projects: [], customers: [], suppliers: [] }),
      loadForm: vi.fn(),
      execute: vi.fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValue({ id: 'saved', version: '1', attachmentIds: [] }),
    }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: {
      constructionContractCommands: repository,
      materialContractCommands: repository,
      subcontractContractCommands: repository,
    } }))
    const store = useStore()
    const session = store.createSession()
    await store.hydrate(session, null)
    const draft = f2FormDefaults(kind)
    await expect(store.saveForm(session, draft, 'save')).rejects.toThrow()
    await store.saveForm(session, draft, 'save')
    const first = repository.execute.mock.calls[0]![0]
    expect(repository.execute.mock.calls[1]![0].commandId).toBe(first.commandId)
    await store.hydrate(session, null)
    await store.saveForm(session, draft, 'save')
    const next = repository.execute.mock.calls[2]![0]
    expect(next.id).toBeUndefined()
    expect(next.baseVersion).toBeNull()
    expect(next.commandId).not.toBe(first.commandId)
  })

  it('两个编辑页交替保存时，各自携带记录 ID 和版本', async () => {
    const repository = {
      context: vi.fn().mockResolvedValue({ workspaceId: 'w', actorId: 'u', projects: [], customers: [], suppliers: [] }),
      loadForm: vi.fn(async (id: string) => ({
        draft: { ...f2FormDefaults(kind), id, name: id },
        attachments: [],
        version: id === 'a' ? '7' : '12',
        updatedAt: '',
      })),
      execute: vi.fn(async (request: { id: string }) => ({ id: request.id, version: '13', attachmentIds: [] })),
    }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: {
      constructionContractCommands: repository,
      materialContractCommands: repository,
      subcontractContractCommands: repository,
    } }))
    const pageA = useStore()
    const pageB = useStore()
    const sessionA = pageA.createSession()
    const sessionB = pageB.createSession()
    await pageA.hydrate(sessionA, 'a')
    await pageB.hydrate(sessionB, 'b')
    await pageA.saveForm(sessionA, { ...f2FormDefaults(kind), id: 'a', name: 'A 新内容' }, 'save')
    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'a',
      baseVersion: '7',
      draft: expect.objectContaining({ id: 'a', name: 'A 新内容' }),
    }))
    await pageB.saveForm(sessionB, { ...f2FormDefaults(kind), id: 'b', name: 'B 新内容' }, 'save')
    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b', baseVersion: '12' }))
  })
})
