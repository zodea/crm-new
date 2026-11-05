import { expect, it, vi } from 'vitest'
import { ImportRowRejected, useImportRunner } from '~/composables/useImportRunner'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('最后一行已发送后取消：允许当前写入完成，但不能返回可发布的完成结果', async () => {
  const gate = deferred()
  const started = deferred()
  const writes: string[] = []
  const sink = vi.fn(async (row: Record<string, unknown>) => {
    started.resolve()
    await gate.promise
    writes.push(String(row.name))
  })
  const runner = useImportRunner({ yieldToView: async () => {} })
  const running = runner.start([{ name: '合成末行' }], sink)
  await started.promise
  runner.cancel()
  gate.resolve()
  const result = await running
  expect(writes).toEqual(['合成末行'])
  expect(sink).toHaveBeenCalledOnce()
  expect(runner.done.value).toBe(1)
  expect(result).toEqual({ status: 'cancelled' })
})

it('末行返回业务拒绝前取消：保留拒绝记录，不发布完成结果', async () => {
  const gate = deferred()
  const started = deferred()
  const sink = vi.fn(async () => {
    started.resolve()
    await gate.promise
    throw new ImportRowRejected('合成行缺少归属')
  })
  const runner = useImportRunner({ yieldToView: async () => {} })
  const running = runner.start([{ name: '合成拒绝行' }], sink)
  await started.promise
  runner.cancel()
  gate.resolve()
  const result = await running
  expect(sink).toHaveBeenCalledOnce()
  expect(runner.rejected.value).toEqual([{ index: 0, row: { name: '合成拒绝行' }, reason: '合成行缺少归属' }])
  expect(result).toEqual({ status: 'cancelled' })
})

it('末行异常返回前取消：保留原始错误，不推断在途写入结果', async () => {
  const gate = deferred()
  const started = deferred()
  const cause = new Error('合成响应中断')
  const sink = vi.fn(async () => {
    started.resolve()
    await gate.promise
    throw cause
  })
  const runner = useImportRunner({ yieldToView: async () => {} })
  const running = runner.start([{ name: '合成未知结果行' }], sink)
  await started.promise
  runner.cancel()
  gate.resolve()
  const result = await running
  expect(sink).toHaveBeenCalledOnce()
  expect(result).toEqual({ status: 'failed', error: cause })
  expect(runner.error.value).toBe('合成响应中断')
})

it('末行异步校验尚未完成时取消，不再发起尚未开始的写入', async () => {
  const gate = deferred()
  const started = deferred()
  const validator = vi.fn(async () => {
    started.resolve()
    await gate.promise
    return null
  })
  const sink = vi.fn(async () => {})
  const runner = useImportRunner({ yieldToView: async () => {} })
  const running = runner.start([{ name: '合成待校验行' }], sink, validator)
  await started.promise
  runner.cancel()
  gate.resolve()
  const result = await running
  expect(sink).not.toHaveBeenCalled()
  expect(result).toEqual({ status: 'cancelled' })
})

it('空列表与同步校验保持正常完成', async () => {
  const runner = useImportRunner({ yieldToView: async () => {} })
  const sink = vi.fn(async () => {})
  expect(await runner.start([], sink)).toEqual({ status: 'completed' })
  expect(sink).not.toHaveBeenCalled()
  expect(await runner.start([{ name: '合成行' }], sink, () => null)).toEqual({ status: 'completed' })
  expect(runner.done.value).toBe(1)
  expect(sink).toHaveBeenCalledOnce()
})
