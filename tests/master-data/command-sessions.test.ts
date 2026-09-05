import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCrewWorkerCommandStore } from '~/stores/crew-worker-command'
import { useCustomerCommandStore } from '~/stores/customer-command'
import { useProjectCommandStore } from '~/stores/project-command'
import { useSupplierCommandStore } from '~/stores/supplier-command'

beforeEach(() => {
  setActivePinia(createPinia())
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() { return values.size },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe.each([
  ['项目', useProjectCommandStore, 'projectCommands'],
  ['客户', useCustomerCommandStore, 'customerCommands'],
  ['分供方', useSupplierCommandStore, 'supplierCommands'],
] as const)('%s 多页签编辑', (kind, useStore, repositoryKey) => {
  it('打开两个主档后，保存前一个只更新自己的记录和版本', async () => {
    const repository = {
      context: async () => ({ workspaceId: 'w', actorId: 'u' }),
      loadForm: async (id: string) => ({ draft: { id, name: id }, attachments: [], version: id === 'a' ? '2' : '9', updatedAt: '' }),
      execute: vi.fn(async (request: { id: string }) => ({ id: request.id, version: '10', attachmentIds: [] })),
    }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { [repositoryKey]: repository } }))
    const first = useStore()
    const second = useStore()
    const firstSession = first.createSession()
    const secondSession = second.createSession()
    await first.hydrate(firstSession, 'a')
    await second.hydrate(secondSession, 'b')
    await first.saveForm(firstSession, { id: 'a', name: `${kind} A 修改` }, 'draft')
    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', baseVersion: '2', draft: expect.objectContaining({ id: 'a', name: `${kind} A 修改` }) }))
    await second.saveForm(secondSession, { id: 'b', name: `${kind} B 修改` }, 'draft')
    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b', baseVersion: '9' }))
  })
})

describe.each(['crew', 'worker'] as const)('%s 多页签编辑', (kind) => {
  it('同一类型的两个表单分别提交自己的目标和版本', async () => {
    const load = async (id: string) => ({ draft: { id, name: id }, version: id === 'a' ? '2' : '9' })
    const execute = vi.fn(async (request: { id: string }) => ({ id: request.id, version: '10', attachmentIds: [] }))
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { crewWorkerCommands: {
      context: async () => ({ workspaceId: 'w', actorId: 'u' }),
      loadCrewForm: load,
      loadWorkerForm: load,
      executeCrew: execute,
      executeWorker: execute,
    } } }))
    const store = useCrewWorkerCommandStore()
    const first = store.createSession()
    const second = store.createSession()
    await store.hydrate(first, kind, 'a')
    await store.hydrate(second, kind, 'b')
    const save = kind === 'crew' ? store.saveCrew : store.saveWorker
    await save(first, { id: 'a', name: 'A 修改' }, 'draft')
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', baseVersion: '2' }))
    await save(second, { id: 'b', name: 'B 修改' }, 'draft')
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b', baseVersion: '9' }))
  })
})
