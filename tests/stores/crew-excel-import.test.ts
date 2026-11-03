import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bindCrewExcelRow, useCrewExcelImportStore } from '../../app/stores/crew-excel-import'

const context = { workspaceId: 'crew-test', actorId: 'synthetic-actor', capabilities: ['crew:list:read', 'crew:write'] }
const form = { draft: { id: 'crew-saved', name: '合成班组' }, version: '2', updatedAt: '2026-09-22T00:00:00.000Z', attachments: [] }
const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  })
})
afterEach(() => vi.unstubAllGlobals())

it('写入失响应后只记原命令，冷恢复必须先读同一班组', async () => {
  let commandId = ''
  const importCrewExcel = vi.fn(async (request) => {
    commandId = request.commandId
    throw new Error('响应丢失')
  })
  const loadCrewForm = vi.fn().mockResolvedValue(form)
  const resolveCrew = vi.fn(async () => ({ outcome: 'applied', result: { id: form.draft.id, commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: [] } }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { crewWorkerCommands: { context: async () => context, importCrewExcel, loadCrewForm, resolveCrew } } }))
  const row = { name: '合成班组', note: 'private-note' }
  bindCrewExcelRow(row, { kind: 'create', fingerprint: 'a'.repeat(64) }, `import-${'a'.repeat(64)}`)
  await expect(useCrewExcelImportStore().importRow(row)).rejects.toThrow('响应丢失')
  expect(JSON.stringify([...values])).not.toContain('private-note')
  setActivePinia(createPinia())
  const store = useCrewExcelImportStore()
  loadCrewForm.mockRejectedValueOnce(new Error('读取失败'))
  await expect(store.recoverPending()).rejects.toThrow('读取失败')
  expect(values.size).toBe(1)
  await expect(store.recoverPending()).resolves.toEqual({ applied: 1, notApplied: 0 })
  expect(values.size).toBe(0)
  expect(importCrewExcel).toHaveBeenCalledOnce()
})

it('准备期间阻止重复提交与封存，权限变化保留原编号', async () => {
  let finish!: (value: typeof context) => void
  const waiting = new Promise<typeof context>(resolve => finish = resolve)
  let current = context
  const getContext = vi.fn().mockReturnValueOnce(waiting).mockImplementation(async () => current)
  const importCrewExcel = vi.fn(async (request) => {
    current = { ...context, capabilities: ['crew:list:read'] }
    return { id: 'crew-saved', commandId: request.commandId, version: '1', updatedAt: form.updatedAt, attachmentIds: [] }
  })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { crewWorkerCommands: { context: getContext, importCrewExcel, loadCrewForm: async () => form, resolveCrew: vi.fn() } } }))
  const row = { name: '合成班组' }
  bindCrewExcelRow(row, { kind: 'create', fingerprint: 'a'.repeat(64) }, `import-${'b'.repeat(64)}`)
  const store = useCrewExcelImportStore()
  const pending = store.importRow(row)
  await expect(store.importRow(row)).rejects.toThrow('正在处理')
  await expect(store.recoverPending()).rejects.toThrow('正在处理')
  finish(context)
  await expect(pending).rejects.toThrow('权限')
  expect(values.size).toBe(1)
})
