import { describe, expect, it, vi } from 'vitest'
import { useImportRunner } from '~/composables/useImportRunner'

const rows = [
  { name: '华东建材' },
  { name: '南方设备' },
  { name: '北方钢构' },
]

function runnerEnvironment() {
  return { yieldToView: vi.fn().mockResolvedValue(undefined) }
}

describe('导入执行器', () => {
  it('逐行入库并推进进度，全部成功后完成', async () => {
    const importRow = vi.fn().mockResolvedValue(undefined)
    const runner = useImportRunner(runnerEnvironment())

    await expect(runner.start(rows, importRow)).resolves.toEqual({ status: 'completed' })

    expect(importRow).toHaveBeenCalledTimes(3)
    expect(importRow).toHaveBeenNthCalledWith(1, rows[0])
    expect(importRow).toHaveBeenNthCalledWith(2, rows[1])
    expect(importRow).toHaveBeenNthCalledWith(3, rows[2])
    expect(runner.phase.value).toBe('completed')
    expect(runner.done.value).toBe(3)
    expect(runner.total.value).toBe(3)
  })

  it('某行失败时停在该行，保留已完成计数', async () => {
    const writeError = new Error('演示写入失败：FAIL-1')
    const importRow = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(writeError)
    const runner = useImportRunner(runnerEnvironment())

    const result = await runner.start(rows, importRow)

    expect(result.status).toBe('failed')
    if (result.status !== 'failed')
      throw new Error('导入失败时未返回原始错误')
    expect(result.error).toBe(writeError)
    expect(runner.phase.value).toBe('failed')
    expect(runner.done.value).toBe(1)
    expect(runner.total.value).toBe(3)
    expect(runner.error.value).toBe('演示写入失败：FAIL-1')
    expect(importRow).toHaveBeenCalledTimes(2)
    expect(importRow).toHaveBeenNthCalledWith(2, rows[1])
    expect(importRow).not.toHaveBeenCalledWith(rows[2])
  })

  it('可预期的行级校验拒绝会继续导入并保留拒绝清单', async () => {
    const importRow = vi.fn().mockResolvedValue(undefined)
    const runner = useImportRunner(runnerEnvironment())

    await expect(runner.start(rows, importRow, async (row) => {
      return row.name === '南方设备' ? '缺归属项目' : null
    })).resolves.toMatchObject({
      status: 'completed',
      rejected: [{ index: 1, row: rows[1], reason: '缺归属项目' }],
    })

    expect(importRow).toHaveBeenCalledTimes(2)
    expect(importRow).not.toHaveBeenCalledWith(rows[1])
    expect(runner.done.value).toBe(3)
    expect(runner.rejected.value).toEqual([
      { index: 1, row: rows[1], reason: '缺归属项目' },
    ])
  })

  it('重试从失败行续导，不重复入库已成功行', async () => {
    const importRow = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('瞬时故障'))
      .mockResolvedValue(undefined)
    const runner = useImportRunner(runnerEnvironment())

    await runner.start(rows, importRow)
    await expect(runner.retry()).resolves.toEqual({ status: 'completed' })

    // 3 行共 4 次调用：第 2 行失败一次后重试成功，第 1 行不重复。
    expect(importRow).toHaveBeenCalledTimes(4)
    expect(importRow).toHaveBeenNthCalledWith(1, rows[0])
    expect(importRow).toHaveBeenNthCalledWith(2, rows[1])
    expect(importRow).toHaveBeenNthCalledWith(3, rows[1])
    expect(importRow).toHaveBeenNthCalledWith(4, rows[2])
    expect(runner.done.value).toBe(3)
  })

  it('运行中不允许重复启动，非失败态不允许重试', async () => {
    const runner = useImportRunner(runnerEnvironment())

    await expect(runner.retry()).rejects.toThrow('只有失败的导入可以重试')

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const importRow = vi.fn().mockImplementation(() => gate)
    const running = runner.start(rows, importRow)

    await expect(runner.start(rows, importRow)).rejects.toThrow('导入正在进行中')
    release()
    await expect(running).resolves.toEqual({ status: 'completed' })
  })

  it('取消后当前行完成即停止，剩余行不入库', async () => {
    const runner = useImportRunner(runnerEnvironment())
    const importRow = vi.fn().mockImplementation(async () => {
      if (importRow.mock.calls.length === 1)
        runner.cancel()
    })

    await expect(runner.start(rows, importRow)).resolves.toEqual({ status: 'cancelled' })

    expect(importRow).toHaveBeenCalledTimes(1)
    expect(runner.phase.value).toBe('idle')
    expect(runner.done.value).toBe(1)
  })

  it('reset 清空进度与错误回到初始态', async () => {
    const importRow = vi.fn().mockRejectedValue(new Error('失败'))
    const runner = useImportRunner(runnerEnvironment())

    await runner.start(rows, importRow)
    runner.reset()

    expect(runner.phase.value).toBe('idle')
    expect(runner.done.value).toBe(0)
    expect(runner.total.value).toBe(0)
    expect(runner.error.value).toBeNull()
  })
})
