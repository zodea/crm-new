import type { MaterialContractListItemDTO, MaterialContractListPageDTO, MaterialContractReadRepository } from '~/lib/material-contract/read-contract'
import { describe, expect, it, vi } from 'vitest'
import { readDeliveryMaterialContracts } from '~/lib/delivery-record/material-contracts'
import { materialOriginMeta } from '../helpers/material-read-meta'

function row(id: string): MaterialContractListItemDTO {
  return { id, dataOrigin: 'real', name: id, no: `CG-${id}`, project: { state: 'resolved', entity: 'project', id: 'p', label: '项目', no: null }, supplier: { state: 'resolved', entity: 'supplier', id: 's', label: '厂家', no: null }, signDate: '2026-09-11', amounts: { contract: '12.35' } } as MaterialContractListItemDTO
}
function page(items: MaterialContractListItemDTO[], current: number, total = items.length, sourceVersion = 'v1'): MaterialContractListPageDTO {
  const originMeta = materialOriginMeta(['material-contract:read'], sourceVersion)
  return { items, pagination: { requestedPage: current, page: current, pageSize: 100, total }, meta: originMeta.real, originMeta, asOf: originMeta.real.asOf, capabilities: originMeta.real.capabilities, sourceVersion: originMeta.real.sourceVersion } as MaterialContractListPageDTO
}

describe('送货既有材采合同来源', () => {
  it('读完同来源全部分页，保留稳定身份、日期、合同原金额与来源', async () => {
    const list = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => row(String(index))), 1, 101)).mockResolvedValueOnce(page([row('last')], 2, 101))
    const result = await readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')
    expect(result).toHaveLength(101)
    expect(result.at(-1)).toMatchObject({ id: 'last', projectId: 'p', supplierId: 's', signDate: '2026-09-11', amount: 12.35, dataOrigin: 'real' })
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, origin: 'real', includeDemo: false }))
  })

  it('真实零与未知头金额分别保留，不在价格和送货消费者中变成零', async () => {
    const zero = row('zero')
    zero.amounts.contract = '0.00'
    const unknown = row('unknown')
    unknown.amounts.contract = null
    const list = vi.fn().mockResolvedValue(page([zero, unknown], 1))
    expect(await readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')).toMatchObject([{ id: 'zero', amount: 0 }, { id: 'unknown', amount: null }])
  })

  it('读取中版本变化不发布部分合同', async () => {
    const list = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => row(String(index))), 1, 101)).mockResolvedValueOnce(page([row('last')], 2, 101, 'v2'))
    await expect(readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')).rejects.toThrow('变化')
  })

  it.each([
    { name: '来源不一致', changed: { ...row('bad'), dataOrigin: 'demo' }, error: '材采合同来源或身份不一致' },
    { name: '项目关系受限', changed: { ...row('bad'), project: { state: 'forbidden', id: 'private-id' } }, error: '部分材采合同关联受限' },
  ])('$name不发布合同', async ({ changed, error }) => {
    const list = vi.fn().mockResolvedValue(page([changed as MaterialContractListItemDTO], 1))
    await expect(readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')).rejects.toThrow(error)
  })

  it('跨分页重复身份不发布部分合同', async () => {
    const list = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => row(String(index))), 1, 101)).mockResolvedValueOnce(page([row('0')], 2, 101))
    await expect(readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')).rejects.toThrow('包含重复身份')
  })

  it('取消后到达的合同页不再发布', async () => {
    const controller = new AbortController()
    const list = vi.fn(async () => {
      controller.abort()
      return page([row('late')], 1)
    })
    await expect(readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real', controller.signal)).rejects.toThrow('取消')
  })
})
