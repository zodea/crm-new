import { describe, expect, it } from 'vitest'
import { filterSuppliers, sortSuppliers } from '~/lib/supplier/list'

const rows = [
  {
    name: '广州市大板东建材有限公司',
    aliases: ['大板东'],
    uniqueCode: '91440101MA5CBX1234',
    taxNo: '91440101MA5CBX1234',
    supplierCategory: '材料供应商',
    contact: '陈志强',
    contactPhone: '13802201234',
    credentialStatus: 'qualified',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  {
    name: '陈家泥水班组',
    aliases: ['陈家班'],
    uniqueCode: '92440101MA5PQR1122',
    taxNo: '92440101MA5PQR1122',
    supplierCategory: '劳务分包商',
    contact: '陈家旺',
    contactPhone: '13802209988',
    credentialStatus: 'incomplete',
    updatedAt: '2026-07-20T10:00:00.000Z',
  },
]

describe('分供方列表筛选', () => {
  it('类别与资料状态组合过滤', () => {
    expect(filterSuppliers(rows, {
      search: '',
      category: '劳务分包商',
      credentialStatus: 'incomplete',
    })).toEqual([rows[1]])
  })

  it.each([
    { case: 'rows / { search: \'大板东\', category: \'all\', credentialStatus: \'all\' }', input: rows, argument2: { search: '大板东', category: 'all', credentialStatus: 'all' }, expected: [rows[0]] },
    { case: 'rows / { search: \'PQR1122\', category: \'all\', credentialStatus: \'all\' }', input: rows, argument2: { search: 'PQR1122', category: 'all', credentialStatus: 'all' }, expected: [rows[1]] },
    { case: 'rows / { search: \'材料供应商\', category: \'all\', credentialStatus: \'all\' }', input: rows, argument2: { search: '材料供应商', category: 'all', credentialStatus: 'all' }, expected: [rows[0]] },
    { case: 'rows / { search: \'陈志强\', category: \'all\', credentialStatus: \'all\' }', input: rows, argument2: { search: '陈志强', category: 'all', credentialStatus: 'all' }, expected: [rows[0]] },
    { case: 'rows / { search: \'9988\', category: \'all\', credentialStatus: \'all\' }', input: rows, argument2: { search: '9988', category: 'all', credentialStatus: 'all' }, expected: [rows[1]] },
  ])('关键词覆盖公司名、简称、信用代码、税号、类别、联系人与电话 / filterSuppliers：$case', ({ input, argument2, expected }) => {
    expect(filterSuppliers(input, argument2)).toEqual(expected)
  })

  it('按名称、类别或更新时间产生稳定只读排序，不改写原数组', () => {
    expect(sortSuppliers(rows, 'name-desc').map(row => row.name)).toEqual([
      '广州市大板东建材有限公司',
      '陈家泥水班组',
    ])
    expect(sortSuppliers(rows, 'category-asc').map(row => row.supplierCategory)).toEqual([
      '材料供应商',
      '劳务分包商',
    ])
    expect(sortSuppliers(rows, 'updated-desc')).toEqual([rows[1], rows[0]])
    expect(rows[0]?.name).toBe('广州市大板东建材有限公司')
  })
})
