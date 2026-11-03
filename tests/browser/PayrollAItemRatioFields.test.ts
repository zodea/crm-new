import type { PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import type { PayrollARatioPlan } from '~/lib/payroll/central-a-item-ratio'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'
import PayrollAItemRatioFields from '~/components/payroll/PayrollAItemRatioFields.vue'

it('分项与费用比例可键盘填写、清空恢复默认，尾款保持只读且页面不横向溢出', async () => {
  const read = ref({ draft: { periodKind: 'monthly' }, lines: [{ itemId: 'wall', itemName: '墙砖' }], bookProof: { state: 'proven' }, fees: { lines: [{ feeId: 'housing', name: '房补' }], negativeLines: [] } } as unknown as PayrollAFormRead)
  const plan = ref<PayrollARatioPlan>({ schemaVersion: 1, itemRatios: [{ itemId: 'wall', ratio: null }], feeRatios: [] })
  const Harness = defineComponent({ setup: () => () => h(PayrollAItemRatioFields, { read: read.value, plan: plan.value, disabled: false, onChange: (next: PayrollARatioPlan) => plan.value = next }) })
  await render(Harness, { global: { stubs: { SectionHeader: true } } })
  const item = page.getByLabelText('墙砖支付比例')
  ;(item.element() as HTMLElement).focus()
  await expect.element(item).toHaveFocus()
  await userEvent.keyboard('50')
  expect(plan.value.itemRatios[0]?.ratio).toBe(0.5)
  await userEvent.keyboard('{Tab}')
  const fee = page.getByLabelText('房补单独比例')
  await expect.element(fee).toHaveFocus()
  await userEvent.keyboard('0')
  expect(plan.value.feeRatios).toEqual([{ kind: 'fee', id: 'housing', ratio: 0 }])
  await userEvent.keyboard('{Backspace}')
  expect(plan.value.feeRatios).toEqual([])
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  read.value = { ...read.value, draft: { ...read.value.draft, periodKind: 'retention' } }
  await expect.element(item).toBeDisabled()
  await expect.element(fee).toBeDisabled()
})
