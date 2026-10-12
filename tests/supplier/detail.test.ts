import { describe, expect, it } from 'vitest'
import credentialsSeed from '~/lib/db/seed/supplier_credentials.json'
import suppliersSeed from '~/lib/db/seed/suppliers.json'
import {
  resolveCredentialStatus,
} from '~/lib/supplier/detail'

describe('分供方详情纯聚合', () => {
  it.each([
    { case: '[\'营业执照\', \'法人身份证\']', input: ['营业执照', '法人身份证'], expected: 'incomplete' },
    { case: '[\'营业执照\', \'法人身份证\', \'银行开户许可证\', \'其他\']', input: ['营业执照', '法人身份证', '银行开户许可证', '其他'], expected: 'reviewing' },
  ])('资料齐全只进入待核验，绝不自动产生人工合格 / resolveCredentialStatus：$case', ({ input, expected }) => {
    expect(resolveCredentialStatus(input)).toBe(expected)
  })

  it.each((suppliersSeed).map(input => ({ input })))('旧演示种子的自动合格只可重算成自动态：输入案例 %#', ({ input: supplier }) => {
    const categories = credentialsSeed
      .filter(credential => credential.supplier_id === supplier.id)
      .map(credential => credential.category)
    expect(['incomplete', 'reviewing']).toContain(resolveCredentialStatus(categories))
  })
})
