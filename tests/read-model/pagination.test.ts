import { describe, expect, it } from 'vitest'
import { parseConstructionContractListQuery } from '~/lib/construction-contract/repository'
import { parseCrewListQuery, parseWorkerListQuery } from '~/lib/crew-worker/repository'
import { parseCustomerListQuery } from '~/lib/customer/repository'
import { parseMaterialContractListQuery } from '~/lib/material-contract/repository'
import { parseOwnerCommercialDocumentListQuery } from '~/lib/owner-document/central-repository'
import { parseProjectListQuery } from '~/lib/project/repository'
import { isPaginationDTO, parsePageQuery, resolvePagination } from '~/lib/read-model/pagination'
import { parseSubcontractContractListQuery } from '~/lib/subcontract-contract/repository'
import { parseSupplierListQuery } from '~/lib/supplier/repository'

describe('公共分页协议', () => {
  it.each([
    { request: 999, size: 10, total: 12, page: 2, rows: 2 },
    { request: 999, size: 20, total: 0, page: 1, rows: 0 },
    { request: 2, size: 10, total: 20, page: 2, rows: 10 },
  ])('合法请求 $request 返回实际 $page 并证明页面完整行数', ({ request, size, total, page, rows }) => {
    const expected = { requestedPage: request, page, pageSize: size, total }
    expect(resolvePagination(request, size, total)).toEqual(expected)
    expect(isPaginationDTO(expected, rows)).toBe(true)
    expect(isPaginationDTO({ ...expected, page: page + 1 }, rows)).toBe(false)
    expect(isPaginationDTO(expected, rows + 1)).toBe(false)
    expect(isPaginationDTO({ page, pageSize: size, total }, rows)).toBe(false)
  })

  const parsers = [
    ['customer', parseCustomerListQuery],
    ['supplier', parseSupplierListQuery],
    ['crew', parseCrewListQuery],
    ['worker', parseWorkerListQuery],
    ['construction', parseConstructionContractListQuery],
    ['subcontract', parseSubcontractContractListQuery],
    ['material', parseMaterialContractListQuery],
    ['project', parseProjectListQuery],
    ['owner', (query: Record<string, unknown>) => parseOwnerCommercialDocumentListQuery('owner_change', query)],
  ] as const
  it.each(parsers)('%s API 拒绝非法页与大小，缺省值有明确含义', (_name, parse) => {
    for (const page of [0, -1, 1.5, '', '0', 'NaN', ['1', '2'], Number.MAX_SAFE_INTEGER + 1])
      expect(() => parse({ page })).toThrow()
    for (const pageSize of [0, 3, 1.5, '', 'garbage', ['10']])
      expect(() => parse({ pageSize })).toThrow()
    expect(parse({ page: '999', pageSize: '20' })).toMatchObject({ page: 999, pageSize: 20 })
    expect(parse({}).page).toBe(1)
  })
  it('辅助合同、结算与收款共享边界不把非法输入归一为成功', () => {
    const invalid = () => {
      throw new Error('invalid-query')
    }
    expect(parsePageQuery({}, invalid)).toEqual({ requestedPage: 1, pageSize: 20 })
    expect(() => parsePageQuery({ page: null }, invalid)).toThrow('invalid-query')
    expect(() => parsePageQuery({ pageSize: 7 }, invalid)).toThrow('invalid-query')
  })
})
