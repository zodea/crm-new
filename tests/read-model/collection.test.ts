import { describe, expect, it, vi } from 'vitest'
import { collectReadPages } from '~/lib/read-model/collection'
import { createReadMeta, withOriginReadMeta } from '../../server/utils/read-meta'

const asOf = '2026-10-04T08:00:00.000Z'
const session = { workspaceId: 'collection-workspace', actorId: 'collection-actor', capabilities: ['customer:list:read'] }
const rows = Array.from({ length: 11 }, (_, index) => ({ id: `customer-${index}`, dataOrigin: 'real' as const }))
function page(number: number) {
  const base = { session, schemaVersion: 'customer-read-v2', operation: 'customer:list', asOf, scope: { search: '', status: null }, coverage: 'complete' as const }
  const real = createReadMeta({ ...base, dataOrigin: 'real', sources: [{ key: 'customers', state: 'readable', sourceVersion: 'customers:7', asOf }] })
  const demo = createReadMeta({ ...base, dataOrigin: 'demo', coverage: 'unknown', sources: [{ key: 'customers', state: 'not-requested', sourceVersion: null, asOf: null }] })
  return withOriginReadMeta({ items: rows.slice((number - 1) * 10, number * 10).map(row => ({ ...row })), pagination: { requestedPage: number, page: number, pageSize: 10, total: 11 } }, { real, demo })
}

describe('候选与导出完整集合', () => {
  it('完整读取后才给出所有稳定身份；普通读取时点改变不制造假版本冲突', async () => {
    const load = vi.fn(async (number: number) => {
      const result = page(number)
      if (number === 2) {
        result.asOf = '2026-10-04T08:00:01.000Z'
        result.meta.asOf = result.asOf
        result.originMeta.real.asOf = result.asOf
        result.originMeta.demo.asOf = result.asOf
      }
      return result
    })
    const result = await collectReadPages({ load, identity: row => `${row.dataOrigin}:${row.id}` })
    expect(result.items.map(row => row.id)).toEqual(rows.map(row => row.id))
    expect(load.mock.calls).toEqual([[1], [2]])
  })

  it.each(['version', 'scope', 'actor', 'capabilities', 'total', 'duplicate', 'page', 'missing', 'origin'] as const)('%s 变化或遗漏不得产生部分候选', async (attack) => {
    const load = async (number: number) => {
      const result = page(number)
      if (number !== 2)
        return result
      if (attack === 'version')
        result.originMeta.real.sourceVersion = 'changed-version'
      if (attack === 'scope')
        result.originMeta.real.authorizedScope.fingerprint = 'changed-range'
      if (attack === 'actor')
        result.originMeta.real.actorId = 'other-actor'
      if (attack === 'capabilities')
        result.originMeta.real.capabilities = []
      if (attack === 'total')
        result.pagination.total = 12
      if (attack === 'duplicate')
        result.items[0]!.id = 'customer-0'
      if (attack === 'page')
        result.pagination.page = 1
      if (attack === 'missing')
        result.items = []
      if (attack === 'origin')
        result.items[0] = { ...result.items[0]!, dataOrigin: 'demo' } as typeof result.items[number]
      return result
    }
    await expect(collectReadPages({ load, identity: row => `${row.dataOrigin}:${row.id}` })).rejects.toThrow('重新读取')
  })

  it('来源未知、范围未知和在途撤权分别停止；真实空集需有读取证明', async () => {
    const result = page(1)
    result.meta.sourceVersion = null
    result.meta.sources[0]!.sourceVersion = null
    await expect(collectReadPages({ load: async () => result, identity: row => row.id })).rejects.toThrow('完整')
    const unknownScope = page(1)
    unknownScope.meta.authorizedScope.coverage = 'unknown'
    unknownScope.originMeta.real.authorizedScope.coverage = 'unknown'
    await expect(collectReadPages({ load: async () => unknownScope, identity: row => row.id })).rejects.toThrow('完整')
    await expect(collectReadPages({ load: async number => page(number), identity: row => row.id, isCurrent: () => false })).rejects.toThrow('权限')
    const empty = page(1)
    empty.items = []
    empty.pagination.total = 0
    expect((await collectReadPages({ load: async () => empty, identity: row => row.id })).items).toEqual([])
  })
})
