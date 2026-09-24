import type { MaterialContractListItemDTO, MaterialContractListPageDTO, MaterialContractReadRepository } from '~/lib/material-contract/read-contract'
import { describe, expect, it, vi } from 'vitest'
import { readDeliveryMaterialContracts } from '~/lib/delivery-record/material-contracts'

function row(id: string): MaterialContractListItemDTO {
  return { id, dataOrigin: 'real', name: id, no: `CG-${id}`, project: { state: 'resolved', entity: 'project', id: 'p', label: '项目', no: null }, supplier: { state: 'resolved', entity: 'supplier', id: 's', label: '厂家', no: null }, signDate: '2026-09-11', amounts: { contract: '12.35' } } as MaterialContractListItemDTO
}
function page(items: MaterialContractListItemDTO[], current: number, total = items.length, sourceVersion = 'v1'): MaterialContractListPageDTO {
  return { items, pagination: { page: current, pageSize: 100, total }, sourceVersion } as MaterialContractListPageDTO
}

describe('送货既有材采合同来源', () => {
  it('读完同来源全部分页，保留稳定身份、日期、合同原金额与来源', async () => {
    const list = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => row(String(index))), 1, 101)).mockResolvedValueOnce(page([row('last')], 2, 101))
    const result = await readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')
    expect(result).toHaveLength(101)
    expect(result.at(-1)).toMatchObject({ id: 'last', projectId: 'p', supplierId: 's', signDate: '2026-09-11', amount: 12.35, dataOrigin: 'real' })
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, origin: 'real', includeDemo: false }))
  })

  it('跨来源、受限关系、重复记录或读取中版本变化不发布部分合同', async () => {
    for (const changed of [
      { ...row('bad'), dataOrigin: 'demo' },
      { ...row('bad'), project: { state: 'forbidden', id: 'private-id' } },
    ]) {
      const list = vi.fn().mockResolvedValue(page([changed as MaterialContractListItemDTO], 1))
      await expect(readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')).rejects.toThrow()
    }
    const list = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => row(String(index))), 1, 101)).mockResolvedValueOnce(page([row('last')], 2, 101, 'v2'))
    await expect(readDeliveryMaterialContracts({ list } as unknown as MaterialContractReadRepository, 'real')).rejects.toThrow('变化')
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
