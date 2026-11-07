import { File } from 'node:buffer'
import { expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

it('原件字节读取期间观察到失权，恢复权限后迟到的读取不得开始原上传', async () => {
  const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
  const granted = ['finance-invoice:read', 'finance-invoice:write']
  let capabilities = [...granted]
  let releaseBytes!: () => void
  const bytesGate = new Promise<void>((resolve) => {
    releaseBytes = resolve
  })
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49])
  const file = new File([bytes], 'synthetic.pdf', { type: 'application/pdf' })
  const originalRead = file.arrayBuffer.bind(file)
  vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => {
    await bytesGate
    return originalRead()
  })
  let executionStarted!: () => void
  const started = new Promise<void>((resolve) => {
    executionStarted = resolve
  })
  const never = new Promise<never>(() => {})
  const execute = vi.fn(() => {
    executionStarted()
    return never
  })
  const at = '2026-01-01T00:00:00.000Z'
  const list = vi.fn(async () => ({
    items: [],
    pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 0 },
    sourceVersion: 'synthetic-source',
    capabilities: [...granted],
    meta: { sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:0', asOf: at }] },
  }))
  const values = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const workspace = createCentralInvoiceWorkspace({
    identity,
    client: { list, execute } as never,
    context: async () => ({ ...identity, capabilities: [...capabilities] }),
    recognizeLocal: async () => { throw new Error('未使用识别') },
    commandId: () => 'synthetic-upload',
    storage,
  })
  await workspace.load()
  expect(workspace.readState.value).toBe('ready')
  let observedGeneration = 0
  const stop = watch(workspace.readState, () => {
    observedGeneration++
  }, { flush: 'sync' })
  const startedAt = observedGeneration
  const isCurrent = () => observedGeneration === startedAt && workspace.readState.value === 'ready'
  const uploading = workspace.upload(file as unknown as globalThis.File, 'synthetic-project', isCurrent)
  void uploading.catch(() => {})
  expect(file.arrayBuffer).toHaveBeenCalledOnce()
  capabilities = []
  await expect(workspace.load()).rejects.toThrow('身份或权限已变化')
  expect(workspace.readState.value).toBe('unavailable')
  capabilities = [...granted]
  await workspace.load()
  expect(workspace.readState.value).toBe('ready')
  releaseBytes()
  const observed = await Promise.race([
    started.then(() => 'executed'),
    uploading.then(() => 'completed', () => 'rejected'),
    new Promise<'timeout'>(resolve => setTimeout(resolve, 1000, 'timeout')),
  ])
  expect(observed).toBe('rejected')
  expect(execute).not.toHaveBeenCalled()
  stop()
})

it('最后一次提交授权等待期间发生重读，发送前再次拒绝旧上传且不留下原编号', async () => {
  const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
  const capabilities = ['finance-invoice:read', 'finance-invoice:write']
  let unblock!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    entered = resolve
  })
  let calls = 0
  const context = async () => {
    if (++calls === 4) {
      entered()
      await gate
    }
    return { ...identity, capabilities: [...capabilities] }
  }
  const at = '2026-01-01T00:00:00.000Z'
  const list = vi.fn(async () => ({
    items: [],
    pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 0 },
    sourceVersion: 'synthetic-source',
    capabilities: [...capabilities],
    meta: { sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:0', asOf: at }] },
  }))
  const execute = vi.fn(async () => {
    throw new Error('不应发送合成命令')
  })
  const values = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const workspace = createCentralInvoiceWorkspace({ identity, client: { list, execute } as never, context, storage, commandId: () => 'synthetic-upload', recognizeLocal: async () => {
    throw new Error('未使用识别')
  } })
  await workspace.load()
  let generation = 0
  const stop = watch(workspace.readState, () => {
    generation++
  }, { flush: 'sync' })
  const start = generation
  const file = new File([new Uint8Array([37, 80, 68, 70, 45, 49])], 'synthetic.pdf', { type: 'application/pdf' })
  const upload = workspace.upload(file as unknown as globalThis.File, null, () => generation === start && workspace.readState.value === 'ready')
  const outcome = upload.then(() => null, error => error)
  await waiting
  await workspace.load()
  expect(workspace.readState.value).toBe('ready')
  unblock()
  expect((await outcome).message).toContain('原件未提交')
  expect(execute).not.toHaveBeenCalled()
  expect(values.size).toBe(0)
  stop()
})

it.each([true, false])('来源稳定时上传成功并清除原编号（传入守卫：%s）', async (withGuard) => {
  const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
  const capabilities = ['finance-invoice:read', 'finance-invoice:write']
  const at = '2026-01-01T00:00:00.000Z'
  const list = async () => ({ items: [], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 0 }, sourceVersion: 'synthetic-0', capabilities, meta: { sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:0', asOf: at }] } })
  const execute = vi.fn(async () => ({ commandId: 'synthetic-upload', invoiceId: 'synthetic-invoice', version: '1', originalId: null, updatedAt: at }))
  const get = vi.fn(async () => ({ record: { id: 'synthetic-invoice', version: '1', original: null, deletedAt: null }, sourceVersion: 'synthetic-1', capabilities, meta: { sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf: at }] } }))
  const values = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const workspace = createCentralInvoiceWorkspace({ identity, client: { list, execute, get } as never, context: async () => ({ ...identity, capabilities }), storage, commandId: () => 'synthetic-upload', recognizeLocal: async () => {
    throw new Error('未使用识别')
  } })
  await workspace.load()
  const check = vi.fn(() => true)
  const file = new File([new Uint8Array([37, 80, 68, 70, 45, 49])], 'synthetic.pdf', { type: 'application/pdf' })
  const result = await workspace.upload(file as unknown as globalThis.File, null, withGuard ? check : undefined)
  expect(result.id).toBe('synthetic-invoice')
  expect(execute).toHaveBeenCalledOnce()
  expect(get).toHaveBeenCalledOnce()
  expect(workspace.pending(null)).toBeNull()
  expect(values.size).toBe(0)
  expect(check).toHaveBeenCalledTimes(withGuard ? 2 : 0)
})
