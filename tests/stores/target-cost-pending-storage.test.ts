// @vitest-environment jsdom
import type { TargetCostFormRead } from '~/lib/target-cost/central-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTargetCostStore } from '~/stores/target-cost'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
const execute = vi.fn()
const read: TargetCostFormRead = { context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'original', capabilities: ['target-cost:read', 'target-cost:write'] }, targetCostId: null, draftKey: 'draft', draft: {}, deletedAt: null, files: [], projects: [], projectOptionsStatus: 'available' }
const storageKey = 'target-cost-central-pending-v1'
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  execute.mockReset()
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { targetCosts: { execute } } }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('原附件提交不能可靠保存时阻断发送，恢复存储后可用原草稿重试', async () => {
  const store = useTargetCostStore()
  execute.mockResolvedValue({ commandId: 'result', id: 'new-id', sourceVersion: 'saved', attachmentIds: [], affectedVersionIds: ['new-id'], logIds: [] })
  const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  const files = { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] }
  expect(() => store.saveForm(read, { name: '保留原稿' }, 'draft', files)).toThrow('尚未发送')
  expect(execute).not.toHaveBeenCalled()
  expect(store.getPending(read)).toBeNull()
  expect(files.add[0]?.payloadBase64).toBe('YWJj')
  quota.mockRestore()
  await store.saveForm(read, { name: '保留原稿' }, 'draft', files)
  expect(execute).toHaveBeenCalledTimes(1)
})
it('发送前持久化完整bytes和key，失响应重建store后按同一内容恢复', async () => {
  const store = useTargetCostStore()
  execute.mockImplementation(async (command) => {
    expect(Object.values(JSON.parse(sessionStorage.getItem(storageKey)!))).toContainEqual(command)
    throw new Error('响应丢失')
  })
  await expect(store.saveForm(read, {}, 'draft', { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] })).rejects.toThrow('响应丢失')
  const original = store.getPending(read)!
  store.$dispose()
  setActivePinia(createPinia())
  const restored = useTargetCostStore()
  expect(restored.getPending(read)?.command).toEqual(original.command)
  execute.mockResolvedValue({ id: 'saved-id', commandId: original.command.commandId, sourceVersion: 'saved', attachmentIds: [], affectedVersionIds: ['saved-id'], logIds: [] })
  await restored.recover(restored.getPending(read)!)
  expect(execute.mock.calls[1]![0]).toEqual(original.command)
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({})
})
