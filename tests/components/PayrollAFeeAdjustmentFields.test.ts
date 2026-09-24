import type { PayrollAFeeAdjustmentBasis } from '~/lib/payroll/central-a-fees-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import PayrollAFeeAdjustmentFields from '~/components/payroll/PayrollAFeeAdjustmentFields.vue'
import { feesSnapshot, negativeDraft } from '../helpers/payroll-fees-ui-fixture'

it('费用更正保原费项/负价修订及范围，只提交本次量价和说明，原冻结不变', async () => {
  const source = feesSnapshot()
  const before = JSON.stringify(source)
  const { baseRevisionId, ...negative } = negativeDraft()
  const basis = shallowRef<PayrollAFeeAdjustmentBasis>({ schemaVersion: 1, book: { bookPurpose: 'management', managementBookId: 'management-book' }, components: source.lines.flatMap(line => line.components.map(({ componentKey, feeId, feeRevisionId, ownershipKey, quantity, unitPrice }) => ({ componentKey, feeId, feeRevisionId, ownershipKey, quantity, unitPrice }))), negativeLines: [{ ...negative, lineId: 'negative-line', originalNegativeRevisionId: baseRevisionId! }] })
  const disabled = shallowRef(false)
  render(defineComponent({ setup: () => () => h(PayrollAFeeAdjustmentFields, { basis: basis.value, source, disabled: disabled.value, onChange: value => basis.value = value }) }))
  expect(screen.getByText('房补 · 一栋 · 墙砖')).toBeTruthy()
  await fireEvent.update(screen.getByRole('spinbutton', { name: '第1项费用更正单价' }), '1.5')
  await fireEvent.update(screen.getByRole('spinbutton', { name: '第1条负价更正数量' }), '20')
  await fireEvent.update(screen.getByRole('textbox', { name: '第1条负价更正依据' }), '核实实际仅二十套')
  expect(basis.value.components[0]).toMatchObject({ feeId: 'housing', feeRevisionId: 'housing-1', unitPrice: 1.5 })
  expect(basis.value.negativeLines[0]).toMatchObject({ lineId: 'negative-line', originalNegativeRevisionId: 'negative-revision', quantity: 20, unit: '套', unitPrice: -20, scope: negative.scope, actualRef: null, evidenceNote: '核实实际仅二十套' })
  expect(JSON.stringify(source)).toBe(before)
  disabled.value = true
  await nextTick()
  await fireEvent.update(screen.getByRole('spinbutton', { name: '第1项费用更正单价' }), '9')
  expect(basis.value.components[0]!.unitPrice).toBe(1.5)
})
