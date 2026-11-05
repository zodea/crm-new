import type { SupplierCommandRequestDTO, SupplierCommandResultDTO } from '~/lib/supplier/command-contract'
import type { SupplierTaxpayerCommand } from '~/lib/supplier/taxpayer-verification'
// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { SUPPLIER_PERSISTENT_CAPABILITY, supplierPendingKey } from '~/lib/supplier/pending'
import { useSupplierCommandStore } from '~/stores/supplier-command'

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

function fixture() {
  const context = { workspaceId: 'workspace-supplier', actorId: 'actor-supplier', capabilities: ['supplier:write', SUPPLIER_PERSISTENT_CAPABILITY] }
  const at = '2026-10-04T08:00:00.000Z'
  let form = { draft: { id: 'supplier-a', name: '原公司', supplierCategory: '其他', contact: '合成人' }, attachments: [] as [], version: '1', updatedAt: at }
  const receipts = new Map<string, SupplierCommandResultDTO>()
  const loadForm = vi.fn(async (_id: string) => structuredClone(form))
  const execute = vi.fn(async (command: SupplierCommandRequestDTO) => {
    form = { ...form, draft: { ...form.draft, ...command.draft, id: command.id ?? 'supplier-a' }, version: '2' }
    const result = { id: form.draft.id, commandId: command.commandId, version: form.version, updatedAt: at, attachmentIds: [] }
    receipts.set(command.commandId, result)
    return structuredClone(result)
  })
  const resolve = vi.fn(async (commandId: string) => {
    const result = receipts.get(commandId)
    return result ? { commandId, outcome: 'applied', result: structuredClone(result) } : { commandId, outcome: 'not-applied', result: null }
  })
  const commands = { context: vi.fn(async () => structuredClone(context)), loadForm, execute, importRow: vi.fn(), recordTaxpayerVerification: vi.fn() }
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCommands: commands, supplierProduction: { resolve } } }))
  const store = useSupplierCommandStore()
  const session = store.createSession()
  return { store, session, context, commands, resolve, form: () => form, key: (id: string | null) => supplierPendingKey(context, `form:${id ?? 'new'}`) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('保留表单重新激活只复验同一身份和存在性，保留税务待提交和原保存基准', async () => {
  const f = fixture()
  await f.store.hydrate(f.session, 'supplier-a')
  f.session.pendingTaxpayerCommand = { commandId: 'taxpayer-kept', workspaceId: f.context.workspaceId, actorId: f.context.actorId, requiredCapability: 'supplier:write', supplierId: 'supplier-a', origin: 'real', baseSupplierVersion: '1', expectedTaxNo: 'SYNTHETIC-TAX', draft: { status: 'not_found', taxpayerType: '未核验', note: '保留人工输入' } }
  const taxpayer = f.session.pendingTaxpayerCommand
  f.commands.loadForm.mockResolvedValueOnce({ ...f.form(), version: '99', draft: { ...f.form().draft, name: '其他窗口更正' } })
  const read = await f.store.revalidate(f.session)
  expect(read.form?.version).toBe('99')
  expect(f.session.targetSupplierId).toBe('supplier-a')
  expect(f.session.baseVersion).toBe('1')
  expect(f.session.formal.baseVersion).toBe('1')
  expect(f.session.pendingTaxpayerCommand).toBe(taxpayer)
  expect(f.commands.execute).not.toHaveBeenCalled()
  expect(f.session.formal.authority).toEqual({ workspaceId: f.context.workspaceId, actorId: f.context.actorId })
})

it('开发固定owner重新激活保留旧base，撤权、串身份或改正式来源均停止采用', async () => {
  const f = fixture()
  f.context.capabilities = ['supplier:write']
  await f.store.hydrate(f.session, 'supplier-a')
  f.commands.loadForm.mockResolvedValueOnce({ ...f.form(), version: '99' })
  expect((await f.store.revalidate(f.session)).form?.version).toBe('99')
  expect(f.session.baseVersion).toBe('1')
  for (const context of [{ ...f.context, actorId: 'another-owner' }, { ...f.context, capabilities: [] }, { ...f.context, capabilities: ['supplier:write', SUPPLIER_PERSISTENT_CAPABILITY] }]) {
    f.commands.context.mockResolvedValueOnce(context)
    await expect(f.store.revalidate(f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(f.session.baseVersion).toBe('1')
    expect(f.session.persistent).toBe(false)
  }
})

it('停用页取消税务旧代忙态，保原号且不让迟到响应采用到新页面', async () => {
  const f = fixture()
  await f.store.hydrate(f.session, 'supplier-a')
  const first = deferred<never>()
  f.commands.recordTaxpayerVerification.mockImplementationOnce(() => first.promise)
  const old = f.store.recordTaxpayerVerification(f.session, { supplierId: 'supplier-a', origin: 'real', expectedTaxNo: 'SYNTHETIC-TAX', baseSupplierVersion: '1', draft: { status: 'not_found', taxpayerType: '未核验', note: '原输入' } })
  // eslint-disable-next-line test/valid-expect -- 先绑定断言，触发异步完成后再等待，避免未处理拒绝。
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(f.commands.recordTaxpayerVerification).toHaveBeenCalledOnce())
  const original = f.session.pendingTaxpayerCommand!
  f.store.deactivate(f.session)
  expect(f.session.taxpayerBusy).toBe(false)
  expect(f.session.pendingTaxpayerCommand).toBe(original)
  expect(f.session.baseVersion).toBe('1')
  first.resolve(undefined as never)
  await rejected
  expect(sessionStorage.getItem(supplierPendingKey(f.context, 'taxpayer:supplier-a'))).toBe(original.commandId)
})

it('外层身份读取先占代次，迟到的 A 不能重新 hydrate 或覆盖已读 B', async () => {
  const f = fixture()
  const first = deferred<typeof f.context>()
  f.commands.context.mockImplementationOnce(() => first.promise)
  f.commands.loadForm.mockImplementation(async (id: string) => ({ ...structuredClone(f.form()), draft: { ...f.form().draft, id } }))
  const old = f.store.hydrate(f.session, 'supplier-a')
  // eslint-disable-next-line test/valid-expect -- 先绑定断言，触发异步完成后再等待，避免未处理拒绝。
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  const newer = await f.store.hydrate(f.session, 'supplier-b')
  first.resolve(structuredClone(f.context))
  await rejected
  expect(newer.draft?.id).toBe('supplier-b')
  expect(f.session.targetSupplierId).toBe('supplier-b')
  expect(f.session.formal.targetId).toBe('supplier-b')
  expect(f.commands.loadForm).toHaveBeenCalledTimes(1)
})

it('税务冷恢复迟到不能清理 A 原编号、覆盖 B 或清 B 正在执行的标记', async () => {
  const f = fixture()
  const first = deferred<Awaited<ReturnType<typeof f.resolve>>>()
  const key = supplierPendingKey(f.context, 'taxpayer:supplier-a')
  sessionStorage.setItem(key, 'old-taxpayer-command')
  f.resolve.mockImplementationOnce(() => first.promise)
  f.commands.loadForm.mockImplementation(async (id: string) => ({ ...structuredClone(f.form()), draft: { ...f.form().draft, id } }))
  const old = f.store.hydrate(f.session, 'supplier-a')
  // eslint-disable-next-line test/valid-expect -- 先绑定断言，触发异步完成后再等待，避免未处理拒绝。
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(f.resolve).toHaveBeenCalledWith('old-taxpayer-command'))
  await f.store.hydrate(f.session, 'supplier-b')
  f.session.taxpayerBusy = true
  first.resolve({ commandId: 'old-taxpayer-command', outcome: 'not-applied', result: null })
  await rejected
  expect(sessionStorage.getItem(key)).toBe('old-taxpayer-command')
  expect(f.session.targetSupplierId).toBe('supplier-b')
  expect(f.session.taxpayerBusy).toBe(true)
})

it('税务写响应跨页面迟到仅保 A 原编号，不撤 B 正在执行的状态', async () => {
  const f = fixture()
  await f.store.hydrate(f.session, 'supplier-a')
  const first = deferred<never>()
  f.commands.recordTaxpayerVerification.mockImplementationOnce(() => first.promise)
  const old = f.store.recordTaxpayerVerification(f.session, { supplierId: 'supplier-a', origin: 'real', expectedTaxNo: 'SYNTHETIC-TAX', baseSupplierVersion: '1', draft: { status: 'not_found', taxpayerType: '未核验', note: '原核验输入' } })
  // eslint-disable-next-line test/valid-expect -- 先绑定断言，触发异步完成后再等待，避免未处理拒绝。
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(f.commands.recordTaxpayerVerification).toHaveBeenCalledTimes(1))
  const original = f.session.pendingTaxpayerCommand!
  f.commands.loadForm.mockImplementation(async (id: string) => ({ ...structuredClone(f.form()), draft: { ...f.form().draft, id } }))
  await f.store.hydrate(f.session, 'supplier-b')
  f.session.taxpayerBusy = true
  first.resolve({ commandId: original.commandId } as never)
  await rejected
  expect(sessionStorage.getItem(supplierPendingKey(f.context, 'taxpayer:supplier-a'))).toBe(original.commandId)
  expect(f.session.targetSupplierId).toBe('supplier-b')
  expect(f.session.taxpayerBusy).toBe(true)
})

it('正式成功回执后读失败保原编号和输入，仅恢复同目标读取后清理', async () => {
  const f = fixture()
  const formalVisible = computed(() => f.session.persistent ? f.session.formal : null)
  expect(formalVisible.value).toBeNull()
  const loaded = await f.store.hydrate(f.session, 'supplier-a')
  expect(formalVisible.value).toBe(f.session.formal)
  const draft = { ...loaded.draft!, name: '已送出稿' }
  f.commands.loadForm.mockRejectedValueOnce(new Error('合成保存后读取失败'))
  await expect(f.store.saveForm(f.session, draft, 'save')).rejects.toThrow('已保存待刷新')
  const original = f.commands.execute.mock.calls[0]![0].commandId
  expect(sessionStorage.getItem(f.key('supplier-a'))).toBe(original)
  expect(f.session.formal.pending?.result?.id).toBe('supplier-a')
  draft.name = '响应后来输入'
  await expect(f.store.saveForm(f.session, draft, 'save')).rejects.toThrow('只核对原提交')
  expect(f.commands.execute).toHaveBeenCalledTimes(1)
  const restored = await f.store.recover(f.session)
  expect(restored).toMatchObject({ outcome: 'applied', form: { draft: { name: '已送出稿' } } })
  expect(draft.name).toBe('响应后来输入')
  expect(f.resolve).not.toHaveBeenCalled()
  expect(f.session.formal.pending).toBeNull()
  expect(sessionStorage.getItem(f.key('supplier-a'))).toBeNull()
})

it('结果未知在新表单旧键中只存原编号，冷刷新恢复原命令不会再次创建', async () => {
  const f = fixture()
  await f.store.hydrate(f.session, null)
  const execute = f.commands.execute.getMockImplementation()!
  f.commands.execute.mockImplementationOnce(async (command) => {
    await execute(command)
    throw new Error('合成响应丢失')
  })
  await expect(f.store.saveForm(f.session, { name: '私人输入不要缓存', supplierCategory: '其他', contact: '私人联系人' }, 'save')).rejects.toThrow('分供方中央服务暂时不可用')
  const original = f.commands.execute.mock.calls[0]![0].commandId
  expect(sessionStorage.getItem(f.key(null))).toBe(original)
  expect(JSON.stringify(sessionStorage)).not.toContain('私人输入')
  setActivePinia(createPinia())
  const restarted = useSupplierCommandStore()
  const coldSession = restarted.createSession()
  const read = await restarted.hydrate(coldSession, null)
  expect(read).toMatchObject({ draft: { id: 'supplier-a', name: '私人输入不要缓存' }, productionNotice: expect.stringContaining('保存成功') })
  expect(f.resolve).toHaveBeenCalledWith(original)
  expect(f.commands.execute).toHaveBeenCalledTimes(1)
  expect(sessionStorage.getItem(f.key(null))).toBeNull()
})

it.each(['wrong-target', 'stale-version', 'actor-switch', 'persistent-withdrawn'] as const)('保存后 %s 不清原编号，不让新输入变为另一条提交', async (reason) => {
  const f = fixture()
  const loaded = await f.store.hydrate(f.session, 'supplier-a')
  const read = f.commands.loadForm.getMockImplementation()!
  f.commands.loadForm.mockImplementationOnce(async () => {
    const result = await read()
    if (reason === 'wrong-target')
      result.draft.id = 'another-supplier'
    if (reason === 'stale-version')
      result.version = '1'
    if (reason === 'actor-switch')
      f.context.actorId = 'other-actor'
    if (reason === 'persistent-withdrawn')
      f.context.capabilities = ['supplier:write']
    return result
  })
  await expect(f.store.saveForm(f.session, loaded.draft!, 'save')).rejects.toThrow('已保存待刷新')
  const command = f.commands.execute.mock.calls[0]![0]
  const originalKey = supplierPendingKey(command, 'form:supplier-a')
  expect(sessionStorage.getItem(originalKey)).toBe(command.commandId)
  const authorityLost = reason === 'actor-switch' || reason === 'persistent-withdrawn'
  await expect(f.store.saveForm(f.session, loaded.draft!, 'save')).rejects.toThrow(authorityLost ? '当前表单与写入目标不一致' : '只核对原提交')
  if (authorityLost)
    expect(f.session.formal.context).toBeNull()
  expect(f.commands.execute).toHaveBeenCalledTimes(1)
})

it('已知未保存封存只撤原编号，保当前输入和旧base，随后才允许新命令', async () => {
  const f = fixture()
  const loaded = await f.store.hydrate(f.session, 'supplier-a')
  f.commands.execute.mockRejectedValueOnce(new Error('合成结果未知'))
  const draft = { ...loaded.draft!, name: '当前输入保留' }
  await expect(f.store.saveForm(f.session, draft, 'save')).rejects.toThrow('分供方中央服务暂时不可用')
  const original = f.commands.execute.mock.calls[0]![0].commandId
  expect(await f.store.recover(f.session)).toMatchObject({ outcome: 'not-applied' })
  expect(f.resolve).toHaveBeenCalledWith(original)
  expect(draft.name).toBe('当前输入保留')
  expect(f.session.baseVersion).toBe('1')
  await f.store.saveForm(f.session, draft, 'save')
  expect(f.commands.execute.mock.calls[1]![0].commandId).not.toBe(original)
})

it('独立税务成功后读失败保税务旧键；恢复只采用原回执，不重写或接受另一版主档', async () => {
  const f = fixture()
  await f.store.hydrate(f.session, 'supplier-a')
  const input = { supplierId: 'supplier-a', origin: 'real' as const, expectedTaxNo: 'SYNTHETIC-TAX', baseSupplierVersion: '1', draft: { status: 'not_found' as const, taxpayerType: '未核验' as const, note: '原核验输入' } }
  const taxpayerResult = (command: SupplierTaxpayerCommand) => ({ commandId: command.commandId, supplierId: command.supplierId, supplierVersion: '2', credentialVersion: '1', credentialId: null, auditId: 'tax-audit', deletionToken: null, verification: { taxpayerType: '未核验', taxpayerVerificationStatus: 'not_found', taxpayerVerificationSource: '官网', taxpayerVerifiedAt: '2026-10-04T08:00:00.000Z', taxpayerVerificationNote: command.draft.note } })
  f.commands.recordTaxpayerVerification.mockImplementation(async (command: SupplierTaxpayerCommand) => {
    f.form().version = '2'
    return taxpayerResult(command)
  })
  f.commands.loadForm.mockRejectedValueOnce(new Error('合成核验后读取失败'))
  await expect(f.store.recordTaxpayerVerification(f.session, input)).rejects.toThrow('合成核验后读取失败')
  const original = f.session.pendingTaxpayerCommand!
  const key = supplierPendingKey(f.context, 'taxpayer:supplier-a')
  expect(sessionStorage.getItem(key)).toBe(original.commandId)
  expect(sessionStorage.getItem(f.key('supplier-a'))).toBeNull()
  f.resolve.mockResolvedValueOnce({ commandId: original.commandId, outcome: 'applied', result: taxpayerResult(original) } as never)
  f.form().version = '3'
  expect(await f.store.recordTaxpayerVerification(f.session, input)).toMatchObject({ commandId: original.commandId, supplierVersion: '2' })
  expect(f.commands.recordTaxpayerVerification).toHaveBeenCalledTimes(1)
  expect(f.session.baseVersion).toBe('2')
  expect(f.session.formal.baseVersion).toBe('2')
  expect(sessionStorage.getItem(key)).toBeNull()
})
