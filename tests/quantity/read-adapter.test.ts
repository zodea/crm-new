import { describe, expect, it, vi } from 'vitest'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createQuantityReadAdapter } from '~/lib/quantity/read-adapter'

const query = { projectId: 'same', origin: 'real' as const, includeDemo: false }

describe('工程量浏览器读来源适配', () => {
  it('正式失败不会读取浏览器 SQLite；演示只有开关和服务端权限同时成立才读', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const select = vi.fn().mockResolvedValue([])
    const adapter = createQuantityReadAdapter(createQuantityRepository(fetcher), { db: { select, execute: vi.fn() }, includeDemo: () => true, context: async () => ({ workspaceId: 'w', actorId: 'a', capabilities: ['quantity:read'] }) })
    await expect(adapter.stages(query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(select).not.toHaveBeenCalled()
    await expect(adapter.stages({ ...query, origin: 'demo', includeDemo: true })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(select).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('演示读取只返回只读来源；同ID不会借用中央正式数据', async () => {
    const fetcher = vi.fn()
    const select = vi.fn().mockResolvedValueOnce([{ id: 'same', matrix_archived_at: null }]).mockResolvedValue([])
    const adapter = createQuantityReadAdapter(createQuantityRepository(fetcher), { db: { select, execute: vi.fn() }, includeDemo: () => true, context: async () => ({ workspaceId: 'w', actorId: 'a', capabilities: ['quantity:read', 'quantity:write', 'demo:read'] }) })
    const result = await adapter.stages({ ...query, origin: 'demo', includeDemo: true })
    expect(result).toMatchObject({ dataOrigin: 'demo', capabilities: ['quantity:read'], data: { projectId: 'same', stages: [] } })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
