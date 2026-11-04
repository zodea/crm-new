import { expect, it } from 'vitest'
import { parsePaymentContractReference, paymentContractSelectionKey } from '../../app/lib/finance/payment-contract'

it('保留领域、编号和版本，跨领域相同编号拥有不同选择身份', () => {
  const material = { domain: 'material', id: 'contract-one', version: '1' } as const
  const subcontract = { domain: 'subcontract', id: 'contract-one', version: '2' } as const
  expect(parsePaymentContractReference(material)).toEqual(material)
  expect(parsePaymentContractReference(subcontract)).toEqual(subcontract)
  expect(paymentContractSelectionKey(material)).not.toBe(paymentContractSelectionKey(subcontract))
})

it('拒绝缺失领域、无效版本及不支持的身份字段', () => {
  for (const value of [
    { id: 'contract-one', version: '1' },
    { domain: 'unknown', id: 'contract-one', version: '1' },
    { domain: 'company', id: 'contract-one', version: '0' },
    { domain: 'material', id: 'contract-one', version: 1 },
    { domain: 'material', id: 'contract-one', version: '1', label: '合同' },
  ])
    expect(parsePaymentContractReference(value)).toBeNull()
})
