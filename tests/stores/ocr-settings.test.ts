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
