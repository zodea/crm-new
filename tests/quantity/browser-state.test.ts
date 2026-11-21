import type { TestDb } from '../helpers/memory-db'
import type { QuantityReadResult } from '~/lib/quantity/central-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQuantityBrowserState } from '~/lib/quantity/browser-state'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { loadQuantityCentralWorkspace } from '~/lib/quantity/central-workspace'
import { createQuantityReadAdapter } from '~/lib/quantity/read-adapter'
import { loadQuantityTemplateWorkspace } from '~/lib/quantity/template'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb
const context = async () => ({ workspaceId: 'w', actorId: 'a', capabilities: ['quantity:read', 'quantity:write'] })
const envelope = <T>(data: T, sourceVersion: string): QuantityReadResult<T> => ({ data, sourceVersion, dataOrigin: 'real', asOf: '2026-09-11T00:00:00Z', capabilities: ['quantity:read', 'quantity:write'] })
beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO projects(id,code,name) VALUES (\'p\',\'P\',\'正式项目\')')
})
afterEach(() => db.close())

describe('工程量浏览器中央工作面', () => {
  it('模板保存使用打开模板的版本；网络失败重试同命令，矩阵刷新不替换编辑基线', async () => {
    const repository = createQuantityRepository(vi.fn())
    const reads = createQuantityReadAdapter(repository, { db, includeDemo: () => false, context })
    vi.spyOn(reads, 'workspace').mockResolvedValue(envelope(await loadQuantityCentralWorkspace(db, 'p'), 'matrix-v9'))
    vi.spyOn(reads, 'templates').mockResolvedValue(envelope(await loadQuantityTemplateWorkspace(db, 'p'), 'template-v3'))
    const execute = vi.fn().mockRejectedValueOnce(quantityProblem('unavailable', '连接中断')).mockResolvedValue({ commandId: 'saved', id: 'new-template', logIds: ['log'], sourceVersion: 'v10' })
    const state = createQuantityBrowserState({ reads, context, execute, catalog: async () => [], includeDemo: () => false })
    await state.loadTemplates('p')
    await state.loadProject('p')
    const draft = { id: null, projectId: 'p', code: 'A', name: 'A户型', copiedFromTemplateId: null, sortOrder: 0, expectedUpdatedAt: null, rooms: [], newItems: [], lines: [] }
    await expect(state.saveTemplate(draft)).rejects.toThrow('连接中断')
    expect(state.templateWorkspace.value?.projectId).toBe('p')
    await expect(state.saveTemplate(draft)).resolves.toMatchObject({ templateId: 'new-template', logIds: ['log'] })
    expect(execute.mock.calls.map(call => call[0].baseVersion)).toEqual(['template-v3', 'template-v3'])
    expect(execute.mock.calls[0]![0].commandId).toBe(execute.mock.calls[1]![0].commandId)
    expect(await db.select('SELECT id FROM house_type_templates')).toEqual([])
  })

  it('同项目切演示立即撤销正式金额和操作，正式读取故障不恢复旧矩阵', async () => {
    const repository = createQuantityRepository(vi.fn())
    const reads = createQuantityReadAdapter(repository, { db, includeDemo: () => true, context })
    const workspace = await loadQuantityCentralWorkspace(db, 'p')
    vi.spyOn(reads, 'workspace').mockResolvedValueOnce(envelope(workspace, 'v1')).mockResolvedValueOnce({ ...envelope({ ...workspace, snapshot: { ...workspace.snapshot, matrixArchivedAt: '2026-09-11' } }, 'demo'), dataOrigin: 'demo', capabilities: ['quantity:read'] }).mockRejectedValue(quantityProblem('unavailable', '断网'))
    const execute = vi.fn()
    const state = createQuantityBrowserState({ reads, context, execute, catalog: async () => [], includeDemo: () => true })
    await state.loadProject('p')
    expect(state.canWrite.value).toBe(true)
    const pending = state.loadProject('p', 'demo')
    expect(state.snapshot.value).toBeNull()
    expect(state.canWrite.value).toBe(false)
    await pending
    expect(state.snapshot.value?.matrixArchivedAt).toBe('2026-09-11')
    await expect(state.archiveMatrix('p')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await state.loadProject('p', 'real')
    expect(state.snapshot.value).toBeNull()
    expect(state.error.value).toContain('断网')
    expect(execute).not.toHaveBeenCalled()
  })

  it('导出前重新校验当前正式事实，撤权时不导出或保留旧矩阵', async () => {
    const repository = createQuantityRepository(vi.fn())
    const reads = createQuantityReadAdapter(repository, { db, includeDemo: () => false, context })
    const read = vi.spyOn(reads, 'workspace').mockResolvedValueOnce(envelope(await loadQuantityCentralWorkspace(db, 'p'), 'v1')).mockRejectedValue(quantityProblem('forbidden', '读取权限已撤销'))
    const state = createQuantityBrowserState({ reads, context, execute: vi.fn(), catalog: async () => [], includeDemo: () => false })
    await state.loadProject('p')
    await expect(state.readExportWorkspace('p')).rejects.toThrow('读取权限已撤销')
    expect(read).toHaveBeenCalledTimes(2)
    expect(state.snapshot.value).toBeNull()
    expect(state.canWrite.value).toBe(false)
  })
})
