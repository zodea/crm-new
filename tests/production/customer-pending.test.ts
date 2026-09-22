import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { customerPendingKey } from '../../app/lib/customer/pending'
import { CustomerCommandConflictError, useCustomerCommandStore } from '../../app/stores/customer-command'

const context = { workspaceId: 'persistent-workspace', actorId: 'persistent-owner', capabilities: ['customer:write', 'customer:original:write'] }
const form = { draft: { id: 'saved-customer', name: '已经提交', contact: '合成人' }, attachments: [], version: '1', updatedAt: '2026-09-22T00:00:00.000Z' }
const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('window', { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  } })
})
afterEach(() => vi.unstubAllGlobals())

it('成功后响应丢失保留原键，未明确采用已保存内容前不重复添加原件', async () => {
  let commandId = ''
  const execute = vi.fn(async (request) => {
    commandId = request.commandId
    throw new Error('response lost after commit')
  })
  const result = () => ({ id: 'saved-customer', commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: ['saved-original'] })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: {
    customerCommands: { context: async () => context, loadForm: async () => form, execute },
    customerProduction: { resolve: async () => ({ outcome: 'applied', result: result() }) },
  } }))
  const store = useCustomerCommandStore()
  const session = store.createSession()
  await store.hydrate(session, null)
  const draft = { name: '已经提交', contact: '合成人' }
  const attachments = { add: [{ fileName: '原件.txt', fileSize: 3, contentBase64: 'YWJj' }] }
  await expect(store.saveForm(session, draft, 'save', attachments)).rejects.toThrow()
  expect([...values.values()]).toEqual([commandId])
  const failure = await store.saveForm(session, { ...draft, name: '尚未保存的新输入' }, 'save', attachments).catch(cause => cause)
  expect(failure).toBeInstanceOf(CustomerCommandConflictError)
  expect(failure.alreadyApplied).toBe(true)
  expect(execute).toHaveBeenCalledTimes(1)
  expect([...values.values()]).toEqual([commandId])
  store.acceptLatest(session, form)
  expect(values.size).toBe(0)
  expect(session.targetCustomerId).toBe('saved-customer')
})

it('冷恢复在原客户读回失败时保留原键；下次正确读回才清理，不保存原件正文', async () => {
  const key = customerPendingKey(context, 'form:new')
  values.set(key, 'original-create-key')
  const loadForm = vi.fn().mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValueOnce(form)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: {
    customerCommands: { context: async () => context, loadForm },
    customerProduction: { resolve: async () => ({ outcome: 'applied', result: { ...form, id: form.draft.id, commandId: 'original-create-key', attachmentIds: [] } }) },
  } }))
  const store = useCustomerCommandStore()
  await expect(store.hydrate(store.createSession(), null)).rejects.toThrow('read unavailable')
  expect(values.get(key)).toBe('original-create-key')
  expect(await store.pendingForms()).toEqual(['/base/customer/form'])
  const recovered = await store.hydrate(store.createSession(), null)
  expect(recovered.draft?.id).toBe(form.draft.id)
  expect(recovered.productionNotice).toContain('保存成功')
  expect(values.size).toBe(0)
})
