import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
