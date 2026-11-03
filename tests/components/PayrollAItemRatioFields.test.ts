import type { PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PayrollAItemRatioFields from '~/components/payroll/PayrollAItemRatioFields.vue'

it('填写分项比例、费用覆盖及恢复默认，尾款不可编辑', async () => {
  const read = { draft: { periodKind: 'monthly' }, lines: [{ itemId: 'wall', itemName: '墙砖' }], book: { bookPurpose: 'ordinary', managementBookId: null }, bookProof: { state: 'proven' }, fees: { lines: [{ feeId: 'housing', name: '房补' }], negativeLines: [] } } as unknown as PayrollAFormRead
  const plan = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'wall', ratio: null }], feeRatios: [] }
  const wrapper = mount(PayrollAItemRatioFields, { props: { read, plan, disabled: false }, global: { stubs: { SectionHeader: true } } })
  await wrapper.get('[aria-label="墙砖支付比例"]').setValue('50')
  expect(wrapper.emitted('change')!.at(-1)![0]).toMatchObject({ itemRatios: [{ itemId: 'wall', ratio: 0.5 }] })
  await wrapper.get('[aria-label="房补单独比例"]').setValue('0')
  expect(wrapper.emitted('change')!.at(-1)![0]).toMatchObject({ feeRatios: [{ kind: 'fee', id: 'housing', ratio: 0 }] })
  await wrapper.setProps({ plan: { ...plan, feeRatios: [{ kind: 'fee', id: 'housing', ratio: 0 }] } })
  await wrapper.get('[aria-label="房补单独比例"]').setValue('')
  expect(wrapper.emitted('change')!.at(-1)![0]).toMatchObject({ feeRatios: [] })
  await wrapper.setProps({ read: { ...read, draft: { ...read.draft, periodKind: 'retention' } } })
  expect(wrapper.get('[aria-label="墙砖支付比例"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[aria-label="房补单独比例"]').attributes('disabled')).toBeDefined()
})
