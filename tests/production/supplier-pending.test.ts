import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setSupplierImportSource } from '../../app/lib/supplier/import-command'
import { supplierPendingKey } from '../../app/lib/supplier/pending'
import { useSupplierCommandStore } from '../../app/stores/supplier-command'

const context = { workspaceId: 'supplier-workspace', actorId: 'supplier-owner', capabilities: ['supplier:write', 'supplier:persistent:write'] }
const form = { draft: { id: 'saved-supplier', name: '原分供方', supplierCategory: '材料供货', taxNo: 'SYNTHETIC-453' }, attachments: [], version: '1', updatedAt: '2026-09-22T00:00:00.000Z' }
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

it('表格导入失响应只保存原编号，冷恢复回读同一分供方并要求重新预览', async () => {
  let commandId = ''
  const importRow = vi.fn(async (request) => {
    commandId = request.commandId
    throw new Error('lost import response')
  })
  const loadForm = vi.fn().mockResolvedValue(form)
  const resolve = vi.fn(async () => ({ outcome: 'applied', result: { id: form.draft.id, commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: [] } }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: async () => context, loadForm, importRow }, supplierProduction: { resolve } } }))
  const row = { name: '原分供方', bankAccount: 'secret-bank-value' }
  setSupplierImportSource(row, `import:${'a'.repeat(64)}`)
  await expect(useSupplierCommandStore().importRow(row)).rejects.toThrow('lost import response')
  expect([...values.values()]).toEqual([commandId])
  expect(JSON.stringify([...values])).not.toContain('secret-bank-value')
  setActivePinia(createPinia())
  const recovered = useSupplierCommandStore()
  loadForm.mockRejectedValueOnce(new Error('read unavailable'))
  await expect(recovered.recoverPendingImports()).rejects.toThrow('read unavailable')
  expect([...values.values()]).toEqual([commandId])
  expect(await recovered.recoverPendingImports()).toEqual({ applied: 1, notApplied: 0 })
  expect(recovered.latestWrite).toEqual({ id: form.draft.id, version: form.version })
  expect(values.size).toBe(0)
  expect(importRow).toHaveBeenCalledTimes(1)
})

it('导入进行中不能从另一实例封存原命令，未保存结果可安全核对', async () => {
  let finish!: (value: unknown) => void
  const write = new Promise(resolve => finish = resolve)
  const importRow = vi.fn(() => write)
  const resolve = vi.fn(async (commandId: string) => ({ outcome: 'not-applied', commandId, result: null }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: async () => context, loadForm: async () => form, importRow }, supplierProduction: { resolve } } }))
  const store = useSupplierCommandStore()
  const row = { name: '合成导入' }
  setSupplierImportSource(row, `import:${'b'.repeat(64)}`)
  const pending = store.importRow(row)
  await vi.waitFor(() => expect(importRow).toHaveBeenCalledOnce())
  await expect(store.recoverPendingImports()).rejects.toThrow('正在保存')
  expect(resolve).not.toHaveBeenCalled()
  finish(Promise.reject(new Error('结果未知')))
  await expect(pending).rejects.toThrow('结果未知')
  expect(await store.recoverPendingImports()).toEqual({ applied: 0, notApplied: 1 })
  expect(values.size).toBe(0)
})

it('准备导入期间阻止重复提交及恢复，准备失败后可以重试', async () => {
  let finishContext!: (value: typeof context) => void
  const waiting = new Promise<typeof context>(resolve => finishContext = resolve)
  const getContext = vi.fn().mockReturnValueOnce(waiting).mockResolvedValue(context)
  const importRow = vi.fn(async () => {
    throw new Error('write reached')
  })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: getContext, loadForm: async () => form, importRow }, supplierProduction: { resolve: vi.fn() } } }))
  const store = useSupplierCommandStore()
  const row = { name: '合成导入' }
  const first = store.importRow(row)
  await expect(store.importRow(row)).rejects.toThrow('正在保存')
  await expect(store.recoverPendingImports()).rejects.toThrow('正在保存')
  finishContext(context)
  await expect(first).rejects.toThrow('缺少导入来源')
  setSupplierImportSource(row, `import:${'c'.repeat(64)}`)
  await expect(store.importRow(row)).rejects.toThrow('write reached')
  expect(importRow).toHaveBeenCalledOnce()
})

it('核对原命令期间不能开始新导入', async () => {
  let finishContext!: (value: typeof context) => void
  const waiting = new Promise<typeof context>(resolve => finishContext = resolve)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: () => waiting }, supplierProduction: { resolve: vi.fn() } } }))
  const store = useSupplierCommandStore()
  const recovery = store.recoverPendingImports()
  await expect(store.importRow({ name: '合成导入' })).rejects.toThrow('正在保存')
  finishContext(context)
  await expect(recovery).resolves.toEqual({ applied: 0, notApplied: 0 })
})

it('主档丢响应后只存原键，冷恢复先读原分供方，不重复创建', async () => {
  let commandId = ''
  const execute = vi.fn(async (request) => {
    commandId = request.commandId
    throw new Error('lost response')
  })
  const loadForm = vi.fn().mockResolvedValue(form)
  const resolve = vi.fn(async () => ({ outcome: 'applied', result: { id: form.draft.id, commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: [] } }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: async () => context, loadForm, execute }, supplierProduction: { resolve } } }))
  const store = useSupplierCommandStore()
  const original = store.createSession()
  await store.hydrate(original, null)
  await expect(store.saveForm(original, { name: '原分供方', bankAccount: 'secret-bank-value' }, 'save')).rejects.toThrow()
  expect([...values.values()]).toEqual([commandId])
  const recovered = await store.hydrate(store.createSession(), null)
  expect(recovered.draft?.id).toBe(form.draft.id)
  expect(values.size).toBe(0)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('未知提交拒绝换正文，原回执及同目标读取可靠后显式采用更新版本再提交', async () => {
  let commandId = ''
  const execute = vi.fn(async (request) => {
    commandId = request.commandId
    throw new Error('lost response')
  })
  const loadForm = vi.fn().mockResolvedValue(form)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: async () => context, loadForm, execute }, supplierProduction: { resolve: async () => ({ outcome: 'applied', result: { id: form.draft.id, commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: [] } }) } } }))
  const store = useSupplierCommandStore()
  const session = store.createSession()
  await store.hydrate(session, null)
  await expect(store.saveForm(session, { name: '原分供方' }, 'save')).rejects.toThrow()
  loadForm.mockRejectedValueOnce(new Error('read unavailable'))
  await expect(store.hydrate(store.createSession(), null)).rejects.toThrow('read unavailable')
  expect([...values.values()]).toEqual([commandId])
  const laterDraft = { name: '新的人工稿' }
  await expect(store.saveForm(session, laterDraft, 'save')).rejects.toThrow('原提交结果未知')
  expect([...values.values()]).toEqual([commandId])
  expect(() => store.acceptLatest(session, form)).toThrow('核对原提交')
  expect(execute).toHaveBeenCalledTimes(1)
  const originalCommandId = commandId
  const latest = { ...form, draft: { ...form.draft, name: '别人更正的主档' }, version: '3' }
  loadForm.mockResolvedValue(latest)
  const recovered = await store.recover(session)
  expect(recovered.outcome).toBe('applied')
  expect(recovered.form).toEqual(latest)
  expect(laterDraft).toEqual({ name: '新的人工稿' })
  expect(values.size).toBe(0)
  store.acceptLatest(session, latest)
  const saved = { ...latest, draft: { ...latest.draft, ...laterDraft }, version: '4' }
  loadForm.mockResolvedValue(saved)
  execute.mockImplementation(async request => ({ id: form.draft.id, commandId: request.commandId, version: '4', updatedAt: form.updatedAt, attachmentIds: [] }))
  await store.saveForm(session, laterDraft, 'save')
  expect(execute).toHaveBeenCalledTimes(2)
  expect(execute.mock.calls[1]![0]).toMatchObject({ id: form.draft.id, baseVersion: '3', draft: { id: form.draft.id, name: '新的人工稿' } })
  expect(execute.mock.calls[1]![0].commandId).not.toBe(originalCommandId)
  expect(values.size).toBe(0)
})

it('税务失响应后的冷恢复读原主档，原核验备注不会进入浏览器持久层', async () => {
  let commandId = ''
  const recordTaxpayerVerification = vi.fn(async (request) => {
    commandId = request.commandId
    throw new Error('taxpayer response lost')
  })
  const verification = { taxpayerType: '一般纳税人', taxpayerVerificationStatus: 'confirmed_general', taxpayerVerificationSource: '官方查询', taxpayerVerifiedAt: form.updatedAt, taxpayerVerificationNote: 'private-note-453' }
  const resolve = vi.fn(async () => ({ outcome: 'applied', result: { supplierId: form.draft.id, commandId, supplierVersion: '2', credentialVersion: '2', credentialId: null, auditId: 'tax-audit', deletionToken: null, verification } }))
  const loadForm = vi.fn().mockResolvedValue(form)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: async () => context, loadForm, recordTaxpayerVerification }, supplierProduction: { resolve } } }))
  const store = useSupplierCommandStore()
  const session = store.createSession()
  await store.hydrate(session, form.draft.id)
  await expect(store.recordTaxpayerVerification(session, { supplierId: form.draft.id, origin: 'real', expectedTaxNo: form.draft.taxNo, baseSupplierVersion: '1', draft: { status: 'confirmed_general', taxpayerType: '一般纳税人', note: 'private-note-453' } })).rejects.toThrow()
  expect([...values.values()]).toEqual([commandId])
  loadForm.mockResolvedValue({ ...form, draft: { ...form.draft, ...verification }, version: '2' })
  const recovered = await store.hydrate(store.createSession(), form.draft.id)
  expect(recovered.draft?.taxpayerVerificationNote).toBe('private-note-453')
  expect(values.size).toBe(0)
  expect(recordTaxpayerVerification).toHaveBeenCalledTimes(1)
})

it('浏览器无法保存原键时不能发送，未应用证明清理后换新键', async () => {
  const execute = vi.fn()
  const resolve = vi.fn(async commandId => ({ outcome: 'not-applied', commandId, result: null }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: { context: async () => context, execute, loadForm: async () => form }, supplierProduction: { resolve } } }))
  const store = useSupplierCommandStore()
  const session = store.createSession()
  await store.hydrate(session, null)
  const write = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {})
  await expect(store.saveForm(session, { name: '尚未发送' }, 'save')).rejects.toThrow('原提交编号')
  expect(execute).not.toHaveBeenCalled()
  write.mockRestore()
  values.set(supplierPendingKey(context, 'form:new'), 'sealed-original-command')
  await expect(store.saveForm(session, { name: '不能替换未核对编号' }, 'save')).rejects.toThrow('请先核对')
  expect(execute).not.toHaveBeenCalled()
  expect(values.get(supplierPendingKey(context, 'form:new'))).toBe('sealed-original-command')
  const restored = store.createSession()
  const read = await store.hydrate(restored, null)
  expect(read.productionNotice).toContain('迟到请求已封存')
  expect(resolve).toHaveBeenCalledWith('sealed-original-command')
  expect(values.size).toBe(0)
  execute.mockImplementation(async request => ({ id: form.draft.id, commandId: request.commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: [] }))
  await store.saveForm(restored, { name: '确认没有保存后再提交' }, 'save')
  expect(execute.mock.calls[0]![0].commandId).not.toBe('sealed-original-command')
  expect(values.size).toBe(0)
})
