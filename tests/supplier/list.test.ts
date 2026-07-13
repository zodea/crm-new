import { describe, expect, it } from 'vitest'
import { filterSuppliers } from '~/lib/supplier/list'

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

  it('关键词覆盖公司名、简称、信用代码、税号、联系人与电话', () => {
    expect(filterSuppliers(rows, { search: '大板东', category: 'all', credentialStatus: 'all' })).toEqual([rows[0]])
    expect(filterSuppliers(rows, { search: 'PQR1122', category: 'all', credentialStatus: 'all' })).toEqual([rows[1]])
    expect(filterSuppliers(rows, { search: '陈志强', category: 'all', credentialStatus: 'all' })).toEqual([rows[0]])
    expect(filterSuppliers(rows, { search: '9988', category: 'all', credentialStatus: 'all' })).toEqual([rows[1]])
  })
})
