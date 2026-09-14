import type { PayrollActualFact, PayrollActualRef } from '~/lib/payroll/central-actual-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import PayrollActualReferencePicker from '~/components/payroll/PayrollActualReferencePicker.vue'
import { payrollListFixture } from '../helpers/payroll-central-read-fixture'

it('只从已读真实收付选择引用，显示日期类别金额和原单主体；选择不创建现金', async () => {
  const statement = payrollListFixture().rows[0]!
  const fact: PayrollActualFact = { identity: 'actual:one', ref: { kind: 'actual-event', eventId: 'actual-one' }, kind: 'supplement', projectId: 'project', originalStatementIds: [statement.id], adjustmentIds: [], applicationIds: [], reverses: null, occurredOn: '2026-09-10', recordedAt: '2026-09-10', signedAmount: { state: 'known', value: 600, knownValue: 600, reasons: [] }, allocations: [], allocationState: 'complete', historicalMembers: [], qualification: 'proven', sourceVersion: 'proven-version', diagnostics: [] }
  const value = shallowRef<PayrollActualRef | null>(null)
  render(defineComponent({ setup: () => () => h(PayrollActualReferencePicker, { value: value.value, facts: [fact], statements: [statement], disabled: false, ready: true, onChange: next => value.value = next }) }))
  const option = screen.getByRole('option', { name: new RegExp(`2026-09-10.*实际补发.*600.00.*${statement.leaderName}`) })
  await fireEvent.update(screen.getByRole('combobox', { name: '关联已有实际收付' }), (option as HTMLOptionElement).value)
  expect(value.value).toEqual(fact.ref)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText(/仅保存原事实引用/)).toBeTruthy()
  await fireEvent.update(screen.getByRole('combobox', { name: '关联已有实际收付' }), '')
  expect(value.value).toBeNull()
})
