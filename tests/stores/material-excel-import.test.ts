import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMaterialExcelImportStore } from '../../app/stores/material-excel-import'

const context = { workspaceId: 'material-test', actorId: 'synthetic-actor', capabilities: ['material-contract:read', 'material-contract:write', 'material-contract:sensitive:read', 'project:list:read', 'supplier:list:read', 'construction-contract:read', 'construction-scope:read', 'our-signatory:read'] }
const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
  })
})
afterEach(() => vi.unstubAllGlobals())

it('整批响应丢失只保匿名原编号，身份不一致或后读失败不能清除，原目标读回后恢复', async () => {
  const forms = vi.fn(async (id: string) => ({ draft: { id }, version: '2' }))
  let wrongTarget = true
  const resolve = vi.fn(async (id: string) => ({ outcome: 'applied', result: { commandId: id, id: id.endsWith('-0') ? wrongTarget ? 'wrong-target' : 'material-existing' : 'material-new', version: '1', updatedAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] } }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractCommands: { context: async () => context, resolve, loadForm: forms } } }))
  vi.stubGlobal('$fetch', vi.fn(async () => {
    throw new Error('响应丢失')
  }))
  const decisions = [{ key: 'private-group', fingerprint: 'a'.repeat(64), kind: 'replace' as const, id: 'material-existing', version: '1' }, { key: 'private-group-2', fingerprint: 'b'.repeat(64), kind: 'create' as const }]
  const store = useMaterialExcelImportStore()
  await expect(store.importBatch({ fileName: '私人.xlsx', fileSize: 1, payloadBase64: 'AA==' }, 'c'.repeat(64), decisions)).rejects.toThrow('响应丢失')
  expect(JSON.stringify([...storage])).not.toContain('私人.xlsx')
  expect(JSON.stringify([...storage])).not.toContain('private-group')
  setActivePinia(createPinia())
  const recovered = useMaterialExcelImportStore()
  await expect(recovered.recoverPending()).rejects.toThrow('目标')
  expect(storage.size).toBe(1)
  wrongTarget = false
  forms.mockRejectedValueOnce(new Error('读取失败'))
  await expect(recovered.recoverPending()).rejects.toThrow('读取失败')
  expect(storage.size).toBe(1)
  await expect(recovered.recoverPending()).resolves.toEqual({ applied: 2, notApplied: 0 })
  expect(storage.size).toBe(0)
})

it('混合已应用和未应用不能冒充成功或清除原批次', async () => {
  const resolve = vi.fn(async (id: string) => id.endsWith('-0') ? { outcome: 'applied', result: { commandId: id, id: 'material-first', version: '1', updatedAt: '2026-01-01T00:00:00.000Z', attachmentIds: [] } } : { outcome: 'not-applied', commandId: id })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractCommands: { context: async () => context, resolve, loadForm: vi.fn() } } }))
  vi.stubGlobal('$fetch', vi.fn(async () => {
    throw new Error('响应丢失')
  }))
  const decisions = [{ key: 'G1', fingerprint: 'a'.repeat(64), kind: 'create' as const }, { key: 'G2', fingerprint: 'b'.repeat(64), kind: 'create' as const }]
  const store = useMaterialExcelImportStore()
  await expect(store.importBatch({ fileName: '合成.xlsx', fileSize: 1, payloadBase64: 'AA==' }, 'c'.repeat(64), decisions)).rejects.toThrow('响应丢失')
  await expect(store.recoverPending()).rejects.toThrow('回执不一致')
  expect(storage.size).toBe(1)
})
