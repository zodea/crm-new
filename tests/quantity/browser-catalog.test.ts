import { describe, expect, it, vi } from 'vitest'
import { loadQuantityBrowserCatalog } from '~/lib/quantity/browser-catalog'

const row = (id: string) => ({ dataOrigin: 'real' as const, project: { id, label: `项目${id}` }, code: id })
const page = (ids: string[], current: number, total: number, sourceVersion = 'v1') => ({ items: ids.map(row), pagination: { page: current, pageSize: 100, total }, sourceVersion })

describe('工程量正式项目候选', () => {
  it('读取全部页并保留未知工程量状态，演示同ID独立且只有授权后才读本地', async () => {
    const firstPage = ['same', ...Array.from({ length: 99 }, (_, i) => `project-${i}`)]
    const list = vi.fn().mockResolvedValueOnce(page(firstPage, 1, 101)).mockResolvedValueOnce(page(['last'], 2, 101))
    const demo = vi.fn().mockResolvedValue([{ id: 'same', code: 'D', name: '演示', hasQuantityData: true }])
    const result = await loadQuantityBrowserCatalog({ list, demo }, { includeDemo: true, capabilities: ['demo:read'] })
    expect(list.mock.calls.map(call => call[0].page)).toEqual([1, 2])
    expect(list.mock.calls.every(call => call[0].includeDemo === false)).toBe(true)
    expect(result).toHaveLength(102)
    expect([result[0], ...result.slice(-2)].map(item => [item!.id, item!.dataOrigin, item!.hasQuantityData])).toEqual([['same', 'real', null], ['last', 'real', null], ['same', 'demo', true]])
    expect(demo).toHaveBeenCalledOnce()
  })

  it('读取失败或分页来源变化显式失败，不从演示替补；撤权后不触本地', async () => {
    const demo = vi.fn()
    const list = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => `project-${i}`), 1, 101)).mockResolvedValueOnce(page(['last'], 2, 101, 'v2'))
    await expect(loadQuantityBrowserCatalog({ list, demo }, { includeDemo: true, capabilities: ['demo:read'] })).rejects.toThrow('变化')
    expect(demo).not.toHaveBeenCalled()
    await expect(loadQuantityBrowserCatalog({ list: async () => page(['only'], 1, 1), demo }, { includeDemo: true, capabilities: [] })).resolves.toHaveLength(1)
    expect(demo).not.toHaveBeenCalled()
  })

  it('非末页被截短、末页缺项或同版本总数变化均不显示为完整候选', async () => {
    const demo = vi.fn().mockResolvedValue([])
    for (const pages of [
      [page(['truncated'], 1, 101), page(['last'], 2, 101)],
      [page(['only'], 1, 2)],
      [page(Array.from({ length: 100 }, (_, i) => `project-${i}`), 1, 101), page(['last'], 2, 100)],
    ]) {
      const list = vi.fn()
      for (const value of pages)
        list.mockResolvedValueOnce(value)
      await expect(loadQuantityBrowserCatalog({ list, demo }, { includeDemo: true, capabilities: ['demo:read'] })).rejects.toThrow()
    }
    expect(demo).not.toHaveBeenCalled()
  })
})
