import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { createDefaultOcrRecognitionSettings } from '~/lib/ocr/settings'
import { useOcrSettingsStore } from '~/stores/ocr-settings'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())
})

afterEach(() => {
  mem.close()
})

describe('ocr 设置 store', () => {
  it.each([false, true])('并发读取复用同一结果，在途禁止写入，失败=%s', async (fail) => {
    let resolveRead!: (value: { settings_json: string }[]) => void
    let rejectRead!: (cause: Error) => void
    const read = new Promise<{ settings_json: string }[]>((resolve, reject) => {
      resolveRead = resolve
      rejectRead = reject
    })
    const select = vi.fn(async <T>() => await read as T[])
    const database = { select, execute: vi.fn(async () => {}) }
    const store = useOcrSettingsStore()
    const first = store.load(database)
    const second = store.load(database)
    const results = Promise.allSettled([first, second])
    expect(select).toHaveBeenCalledTimes(1)
    expect(store.loading).toBe(true)
    await expect(store.save(createDefaultOcrRecognitionSettings(), database)).rejects.toThrow('请先成功读取')
    if (fail)
      rejectRead(new Error('并发读取失败'))
    else
      resolveRead([{ settings_json: JSON.stringify({ useChartRecognition: true }) }])
    expect((await results).map(result => result.status)).toEqual(fail ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled'])
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(!fail)
    if (fail)
      await expect(store.save(createDefaultOcrRecognitionSettings(), database)).rejects.toThrow('请先成功读取')
    else
      expect(store.settings.useChartRecognition).toBe(true)
    expect(database.execute).not.toHaveBeenCalled()
  })

  it('未读成功前拒绝保存；后续重读失败也不能覆盖原设置', async () => {
    const store = useOcrSettingsStore()
    await expect(store.save(createDefaultOcrRecognitionSettings(), mem)).rejects.toThrow('请先成功读取 OCR 设置')
    expect(await mem.select('SELECT * FROM ocr_settings')).toEqual([])
    await store.load(mem)
    await expect(store.load({
      ...mem,
      select: async () => {
        throw new Error('暂时无法读取')
      },
    })).rejects.toThrow('暂时无法读取')
    expect(store.loaded).toBe(false)
    await expect(store.save(createDefaultOcrRecognitionSettings(), mem)).rejects.toThrow('请先成功读取 OCR 设置')
  })

  it('通过 action 保存 SQLite，并在新 store 中恢复', async () => {
    const store = useOcrSettingsStore()
    await store.load(mem)
    const next = {
      ...createDefaultOcrRecognitionSettings(),
      useChartRecognition: true,
      requestTimeoutMs: 45_000,
    }
    await store.save(next, mem)

    setActivePinia(createPinia())
    const reloaded = useOcrSettingsStore()
    await reloaded.load(mem)

    expect(reloaded.settings).toEqual(next)
    expect(reloaded.recognitionOptions).not.toHaveProperty('passThreshold')
    expect(reloaded.recognitionOptions.requestTimeoutMs).toBe(45_000)
  })
})
