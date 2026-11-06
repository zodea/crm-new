import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { CentralInvoiceProblem } from '~/lib/invoice/central-contract'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import { problemFromHttpFailure } from '~/lib/read-model/problem'

const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
const granted = ['finance-invoice:read', 'finance-invoice:write']
const at = '2026-01-01T00:00:00.000Z'
type Actor = typeof identity & { capabilities: string[] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function invoice(): CentralInvoiceRecord {
  return { id: 'invoice-001', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '合成购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: at, updatedAt: at, deletedAt: null }
}
function listRead() {
  const sourceVersion = 'read-synthetic-1'
  const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion, sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:1', asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: 'scope-list-synthetic' }, capabilities: [...granted] }
  return { dataOrigin: 'real', asOf: at, sourceVersion, capabilities: [...granted], meta, items: [invoice()], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
}
function fixture() {
  const actor: Actor = { ...identity, capabilities: [...granted] }
  const contextActions: Array<() => Promise<Actor>> = []
  const listActions: Array<() => Promise<unknown>> = []
  let resolutionApplied = false
  const values = new Map<string, string>()
  const storage = () => ({
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url, options) => {
    if (url === '/api/read/invoices')
      return listActions.length ? listActions.shift()!() : listRead()
    if (url === '/api/commands/invoices')
      throw new Error('合成提交结果未知')
    if (url === '/api/commands/invoices/resolve') {
      const commandId = (options?.body as { commandId: string }).commandId
      return resolutionApplied
        ? { outcome: 'applied', result: { commandId, invoiceId: 'invoice-001', version: '1', originalId: null, updatedAt: at } }
        : { outcome: 'not-applied', commandId }
    }
    if (url === '/api/read/invoices/invoice-001') {
      const { items: _items, pagination: _pagination, ...read } = listRead()
      return { ...read, meta: { ...read.meta, authorizedScope: { coverage: 'complete', fingerprint: 'scope-detail-synthetic' } }, record: invoice() }
    }
    throw new Error(`拒绝未知合成请求 ${url}`)
  })
  const workspace = createCentralInvoiceWorkspace({ identity, client: createCentralInvoiceHttp(fetcher, identity), context: async () => contextActions.length ? contextActions.shift()!() : structuredClone(actor), storage, commandId: () => 'synthetic-command', recognizeLocal: async () => {
    throw new Error('未使用识别')
  } })
  function holdList() {
    const entered = deferred<void>()
    const gate = deferred<unknown>()
    listActions.push(async () => {
      entered.resolve()
      return gate.promise
    })
    return { entered, gate }
  }
  function holdContext() {
    const entered = deferred<void>()
    const gate = deferred<Actor>()
    contextActions.push(async () => {
      entered.resolve()
      return gate.promise
    })
    return { entered, gate }
  }
  return { workspace, fetcher, holdList, holdContext, setApplied: () => {
    resolutionApplied = true
  } }
}
function settled<T>(promise: Promise<T>) {
  return promise.then(() => null, error => error)
}
function denied(code: 'unauthenticated' | 'forbidden') {
  return new CentralInvoiceProblem(code, `合成${code}`)
}
function expectHidden(f: ReturnType<typeof fixture>) {
  expect(f.workspace.readState.value).toBe('unavailable')
  expect(f.workspace.loading.value).toBe(false)
  expect(f.workspace.records.value).toEqual([])
  expect(f.workspace.sourceVersion.value).toBeNull()
}

it.each(['missing-read', 'other-actor'] as const)('旧 context %s 迟到时先遮蔽，事件后新读取才可恢复', async (kind) => {
  const f = fixture()
  const oldContext = f.holdContext()
  const old = settled(f.workspace.load())
  await oldContext.entered.promise
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
  expect(f.workspace.records.value[0]?.id).toBe('invoice-001')
  oldContext.gate.resolve(kind === 'missing-read' ? { ...identity, capabilities: ['finance-invoice:write'] } : { ...identity, actorId: 'other-actor', capabilities: [...granted] })
  expect(await old).toBeInstanceOf(Error)
  expectHidden(f)
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
  expect(f.workspace.records.value[0]?.id).toBe('invoice-001')
})

it('旧 context 授权失败发生在新列表读取中，该新列表不能在失效事件后发布', async () => {
  const f = fixture()
  const oldContext = f.holdContext()
  const old = settled(f.workspace.load())
  await oldContext.entered.promise
  const newerList = f.holdList()
  const newer = settled(f.workspace.load())
  await newerList.entered.promise
  oldContext.gate.resolve({ ...identity, capabilities: ['finance-invoice:write'] })
  expect(await old).toBeInstanceOf(Error)
  expectHidden(f)
  newerList.gate.resolve(listRead())
  expect(await newer).toBeInstanceOf(Error)
  expectHidden(f)
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
})

it('旧 context 暂时不可核验时保守隐藏，不误判为已确认撤权', async () => {
  const f = fixture()
  const oldContext = f.holdContext()
  const old = settled(f.workspace.load())
  await oldContext.entered.promise
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
  const failure = new Error('合成会话服务暂不可用')
  oldContext.gate.reject(failure)
  expect(await old).toBe(failure)
  expect(problemFromHttpFailure(failure)).toBeNull()
  expectHidden(f)
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
})

it.each(['unauthenticated', 'forbidden'] as const)('context 的 %s 只失效一次，不取消失效事件后同步启动的重验', async (code) => {
  const f = fixture()
  await f.workspace.load()
  const context = f.holdContext()
  const previous = settled(f.workspace.load())
  await context.entered.promise
  const retryList = f.holdList()
  let retry: Promise<unknown> | undefined
  const stop = watch(f.workspace.readState, (state) => {
    if (state === 'unavailable' && !retry)
      retry = settled(f.workspace.load())
  }, { flush: 'sync' })
  context.gate.reject(denied(code))
  expect(problemFromHttpFailure(await previous)?.code).toBe(code)
  expect(retry).toBeDefined()
  retryList.gate.resolve(listRead())
  expect(await retry).toBeNull()
  expect(f.workspace.readState.value).toBe('ready')
  expect(f.workspace.records.value[0]?.id).toBe('invoice-001')
  stop()
})

it.each(['unauthenticated', 'forbidden'] as const)('旧列表返回 %s，哪怕新读取已完成也必须遮蔽并可重新验证', async (code) => {
  const f = fixture()
  const oldList = f.holdList()
  const old = settled(f.workspace.load())
  await oldList.entered.promise
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
  oldList.gate.reject(denied(code))
  expect(problemFromHttpFailure(await old)?.code).toBe(code)
  expectHidden(f)
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
})

it.each([401, 403] as const)('旧列表原始 HTTP %i 且响应体损坏时仍按授权失败遮蔽', async (status) => {
  const f = fixture()
  const oldList = f.holdList()
  const old = settled(f.workspace.load())
  await oldList.entered.promise
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
  oldList.gate.reject(Object.assign(new Error('合成损坏错误体'), { statusCode: status, data: {} }))
  expect(problemFromHttpFailure(await old)?.code).toBe(status === 401 ? 'unauthenticated' : 'forbidden')
  expectHidden(f)
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
})

it.each(['unauthenticated', 'forbidden'] as const)('旧列表 %s 到达新列表仍在途时，旧授权失败撤销新列表发布资格', async (code) => {
  const f = fixture()
  const oldList = f.holdList()
  const old = settled(f.workspace.load())
  await oldList.entered.promise
  const newerList = f.holdList()
  const newer = settled(f.workspace.load())
  await newerList.entered.promise
  oldList.gate.reject(denied(code))
  expect(problemFromHttpFailure(await old)?.code).toBe(code)
  expectHidden(f)
  newerList.gate.resolve(listRead())
  expect(await newer).toBeInstanceOf(Error)
  expectHidden(f)
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
})

it('第二个旧授权失败在重验期间到达，首次重验不得发布，下一次重验才可恢复', async () => {
  const f = fixture()
  const firstList = f.holdList()
  const first = settled(f.workspace.load())
  await firstList.entered.promise
  const secondList = f.holdList()
  const second = settled(f.workspace.load())
  await secondList.entered.promise
  firstList.gate.reject(denied('unauthenticated'))
  expect(problemFromHttpFailure(await first)?.code).toBe('unauthenticated')
  expectHidden(f)
  const checkingList = f.holdList()
  const checking = settled(f.workspace.load())
  await checkingList.entered.promise
  expect(f.workspace.loading.value).toBe(true)
  secondList.gate.reject(denied('forbidden'))
  expect(problemFromHttpFailure(await second)?.code).toBe('forbidden')
  expectHidden(f)
  checkingList.gate.resolve(listRead())
  expect(await checking).toBeInstanceOf(Error)
  expectHidden(f)
  await f.workspace.load()
  expect(f.workspace.readState.value).toBe('ready')
  expect(f.workspace.loading.value).toBe(false)
})

it('两个独立请求即使复用同一错误对象也必须各自撤销当前读取', async () => {
  const f = fixture()
  const firstList = f.holdList()
  const first = settled(f.workspace.load())
  await firstList.entered.promise
  const secondList = f.holdList()
  const second = settled(f.workspace.load())
  await secondList.entered.promise
  const sameFailure = denied('forbidden')
  firstList.gate.reject(sameFailure)
  expect(await first).toBe(sameFailure)
  expectHidden(f)
  const retryList = f.holdList()
  const retry = settled(f.workspace.load())
  await retryList.entered.promise
  secondList.gate.reject(sameFailure)
  expect(await second).toBe(sameFailure)
  expectHidden(f)
  retryList.gate.resolve(listRead())
  expect(await retry).toBeInstanceOf(Error)
  expectHidden(f)
})

it('原编号已应用后的内部重读拒绝只失效一次，事件后同步重验可完成', async () => {
  const f = fixture()
  await f.workspace.load()
  const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
  await expect(f.workspace.edit(original, original.fields, original.items)).rejects.toThrow('合成提交结果未知')
  const deniedList = f.holdList()
  const read = settled(f.workspace.load())
  await deniedList.entered.promise
  deniedList.gate.reject(denied('forbidden'))
  expect(await read).toBeInstanceOf(Error)
  expectHidden(f)
  f.setApplied()
  const recoveryList = f.holdList()
  const recovery = settled(f.workspace.recover(original.id))
  await recoveryList.entered.promise
  const retryList = f.holdList()
  let retry: Promise<unknown> | undefined
  const stop = watch(f.workspace.readState, (state) => {
    if (state === 'unavailable' && !retry)
      retry = settled(f.workspace.load())
  }, { flush: 'sync' })
  recoveryList.gate.reject(denied('forbidden'))
  expect(problemFromHttpFailure(await recovery)?.code).toBe('forbidden')
  expect(retry).toBeDefined()
  retryList.gate.resolve(listRead())
  expect(await retry).toBeNull()
  expect(f.workspace.readState.value).toBe('ready')
  expect(f.workspace.pending(original.id)).toBeNull()
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  stop()
})

it('当前代网络失败仍返回原错误并隐藏数据', async () => {
  const f = fixture()
  const list = f.holdList()
  const pending = settled(f.workspace.load())
  await list.entered.promise
  const failure = new Error('合成当前网络失败')
  list.gate.reject(failure)
  expect(await pending).toBe(failure)
  expectHidden(f)
})

it('提交会话中的权限上下文不可核验时隐藏现有票面且未发送命令', async () => {
  const f = fixture()
  await f.workspace.load()
  const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
  const firstContext = f.holdContext()
  const sessionContext = f.holdContext()
  const operation = settled(f.workspace.edit(original, original.fields, original.items))
  await firstContext.entered.promise
  firstContext.gate.resolve({ ...identity, capabilities: [...granted] })
  await sessionContext.entered.promise
  const failure = new Error('合成会话不可核验')
  sessionContext.gate.reject(failure)
  expect(await operation).toBe(failure)
  expectHidden(f)
  expect(f.workspace.pending(original.id)).toBeNull()
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(0)
})

it.each([null, undefined])('提交会话上下文以 %s 拒绝时也要遮蔽', async (failure) => {
  const f = fixture()
  await f.workspace.load()
  const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
  const firstContext = f.holdContext()
  const sessionContext = f.holdContext()
  const operation = f.workspace.edit(original, original.fields, original.items).then(
    () => ({ rejected: false }),
    reason => ({ rejected: true, reason }),
  )
  await firstContext.entered.promise
  firstContext.gate.resolve({ ...identity, capabilities: [...granted] })
  await sessionContext.entered.promise
  sessionContext.gate.reject(failure)
  expect(await operation).toEqual({ rejected: true, reason: failure })
  expectHidden(f)
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(0)
})

it('旧普通网络错误不能结束后继读取的 loading 或隐藏其最终结果', async () => {
  const f = fixture()
  const oldList = f.holdList()
  const old = settled(f.workspace.load())
  await oldList.entered.promise
  const newerList = f.holdList()
  const newer = f.workspace.load()
  await newerList.entered.promise
  oldList.gate.reject(new Error('合成旧网络失败'))
  expect(await old).toBeInstanceOf(Error)
  expect(f.workspace.loading.value).toBe(true)
  expect(f.workspace.readState.value).toBe('loading')
  newerList.gate.resolve(listRead())
  await newer
  expect(f.workspace.loading.value).toBe(false)
  expect(f.workspace.readState.value).toBe('ready')
  expect(f.workspace.records.value[0]?.id).toBe('invoice-001')
})

it('旧 403 不得清结果未知原编号，恢复权限后只核对原号并且不重复写入', async () => {
  const f = fixture()
  await f.workspace.load()
  const original = JSON.parse(JSON.stringify(f.workspace.records.value[0])) as CentralInvoiceRecord
  await expect(f.workspace.edit(original, original.fields, original.items)).rejects.toThrow('合成提交结果未知')
  expect(f.workspace.pending(original.id)?.commandId).toBe('synthetic-command')
  const oldList = f.holdList()
  const old = settled(f.workspace.load())
  await oldList.entered.promise
  await f.workspace.load()
  oldList.gate.reject(denied('forbidden'))
  expect(problemFromHttpFailure(await old)?.code).toBe('forbidden')
  expectHidden(f)
  expect(f.workspace.pending(original.id)?.commandId).toBe('synthetic-command')
  await f.workspace.load()
  expect(await f.workspace.recover(original.id)).toEqual({ outcome: 'not-applied' })
  expect(f.workspace.pending(original.id)).toBeNull()
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  const resolve = f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/resolve')
  expect(resolve).toHaveLength(1)
  expect(resolve[0]![1]?.body).toEqual({ commandId: 'synthetic-command' })
})
