import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { customerPendingKey } from '../../app/lib/customer/pending'
import { useCustomerCommandStore } from '../../app/stores/customer-command'

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

it('成功后响应丢失保留原键，禁止替换原提交；核对和合法回读后才允许新的更正', async () => {
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
  expect(failure.message).toContain('原提交结果未知')
  expect(execute).toHaveBeenCalledTimes(1)
  expect([...values.values()]).toEqual([commandId])
  const recovered = await store.recover(session)
  expect(recovered).toMatchObject({ outcome: 'applied', form })
  expect(values.size).toBe(0)
  expect(session.targetCustomerId).toBe('saved-customer')
})

it('已收到可靠回执但原客户读回失败，只重试读取且保留原键和输入', async () => {
  let commandId = ''
  const execute = vi.fn(async (request) => {
    commandId = request.commandId
    return { id: form.draft.id, commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: [] }
  })
  const loadForm = vi.fn().mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValue(form)
  const resolve = vi.fn()
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { customerCommands: { context: async () => context, loadForm, execute }, customerProduction: { resolve } } }))
  const store = useCustomerCommandStore()
  const session = store.createSession()
  await store.hydrate(session, null)
  const draft = { name: '保留原稿', contact: '继续输入' }
  await expect(store.saveForm(session, draft, 'save')).rejects.toThrow('已保存待刷新')
  expect(values.get(customerPendingKey(context, 'form:new'))).toBe(commandId)
  await expect(store.saveForm(session, { ...draft, name: '新的稿' }, 'save')).rejects.toThrow('只核对原提交')
  await store.recover(session)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(resolve).not.toHaveBeenCalled()
  expect(loadForm).toHaveBeenCalledTimes(2)
  expect(draft).toEqual({ name: '保留原稿', contact: '继续输入' })
  expect(values.size).toBe(0)
})

it('身份切换、错误目标和过旧版本不能清理旧键；后续合法版本不自动重定基线', async () => {
  let currentContext = context
  let commandId = ''
  const execute = vi.fn(async (request) => {
    commandId = request.commandId
    throw new Error('unknown')
  })
  const loadForm = vi.fn().mockResolvedValue(form)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { customerCommands: { context: async () => currentContext, loadForm, execute }, customerProduction: { resolve: async () => ({ outcome: 'applied', result: { id: form.draft.id, commandId, version: '2', updatedAt: form.updatedAt, attachmentIds: [] } }) } } }))
  const store = useCustomerCommandStore()
  const session = store.createSession()
  await store.hydrate(session, null)
  await expect(store.saveForm(session, { name: '原稿' }, 'save')).rejects.toThrow()
  currentContext = { ...context, actorId: 'other-owner' }
  await expect(store.recover(session)).rejects.toThrow('身份或权限')
  expect(values.size).toBe(1)
  expect(session.persistent.context).toBeNull()
  currentContext = context
  loadForm.mockResolvedValueOnce({ ...form, draft: { ...form.draft, id: 'other-customer' }, version: '2' })
  await expect(store.recover(session)).rejects.toThrow('尚未可靠读取')
  await expect(store.recover(session)).rejects.toThrow('尚未可靠读取')
  expect(values.size).toBe(1)
  loadForm.mockResolvedValueOnce({ ...form, version: '5' })
  await store.recover(session)
  expect(session.baseVersion).toBe('2')
  expect(values.size).toBe(0)
  expect(execute).toHaveBeenCalledTimes(1)
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

it('外层权限读取先占代次，迟到客户 A 不能覆盖已读取的客户 B', async () => {
  let release!: (value: typeof context) => void
  const readContext = vi.fn().mockImplementationOnce(() => new Promise(resolve => release = resolve)).mockResolvedValue(context)
  const loadForm = vi.fn(async (id: string) => ({ ...form, draft: { ...form.draft, id, name: id } }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { customerCommands: { context: readContext, loadForm }, customerProduction: { resolve: vi.fn() } } }))
  const store = useCustomerCommandStore()
  const session = store.createSession()
  const first = store.hydrate(session, 'customer-a')
  const rejected = expect(first).rejects.toThrow('当前客户页面')
  const second = await store.hydrate(session, 'customer-b')
  release(context)
  await rejected
  expect(second.draft?.id).toBe('customer-b')
  expect(session.targetCustomerId).toBe('customer-b')
  expect(session.persistent.targetId).toBe('customer-b')
  expect(loadForm.mock.calls.map(([id]) => id)).toEqual(['customer-b'])
})
