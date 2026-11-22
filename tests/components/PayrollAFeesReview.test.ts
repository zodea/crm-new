import type { PayrollAFeeAdjustmentBasis } from '~/lib/payroll/central-a-fees-contract'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import PayrollAFeeAdjustmentFields from '~/components/payroll/PayrollAFeeAdjustmentFields.vue'
import PayrollAFeesReview from '~/components/payroll/PayrollAFeesReview.vue'
import { feeAmount, feeFormRead, feeManagementBook, feesSnapshot, negativeDraft } from '../helpers/payroll-fees-ui-fixture'

vi.stubGlobal('useRoute', () => ({ query: {}, fullPath: '/subcontract/payroll/wage-a?origin=real' }))
const global = { stubs: { SectionHeader: { props: ['title'], template: '<h2>{{ title }}</h2>' }, NuxtLink: { template: '<a><slot /></a>' } } }
it('普通工资明确分开3600工作与130房补，不将缺费用读当无补贴', async () => {
  const read = feeFormRead()
  const view = render(PayrollAFeesReview, { props: { read, returnTo: '/subcontract/payroll/wage-a?origin=real' }, global })
  const summary = screen.getByRole('region', { name: '工资费用组成' })
  expect(within(summary).getByText(/3,600\.00/)).toBeTruthy()
  expect(within(summary).getAllByText(/130\.00/).length).toBeGreaterThan(0)
  expect(within(summary).getAllByText(/3,730\.00/).length).toBeGreaterThan(0)
  await view.rerender({ read: { ...read, fees: null } })
  expect(screen.getByText('费用依据未能完整读取，不能按无费用核算。')).toBeTruthy()
  expect(screen.queryByText(/3,730\.00/)).toBeNull()
})
it('管理簿单独显示同簿已领200和520，负价保-600及原因', () => {
  const read = feeFormRead()
  const entry = feeManagementBook()
  read.book = { bookPurpose: 'management', managementBookId: entry.book.id }
  read.bookProof = { state: 'proven', book: read.book, sourceVersion: 'book-v1' }
  read.fees!.management = { book: entry.book, revision: entry.revision! }
  read.fees!.lines = []
  read.fees!.negativeLines = [{ ...negativeDraft(), id: 'negative-revision', lineId: 'negative-line', statementId: 'wage-a', projectId: 'project', managementBookId: entry.book.id, managementRevisionId: entry.revision!.id, revision: 1, signedAmountFen: -60000, removed: false, operatorId: 'actor', createdAt: '2026-09-14' }]
  read.totals = { workAmount: feeAmount(0), subsidyAmount: feeAmount(0), managementAmount: feeAmount(1500), negativeAmount: feeAmount(-600), listAmount: feeAmount(900), cumulativeAmount: feeAmount(720), previouslyPaid: feeAmount(200), grossAmount: feeAmount(520) }
  read.fees!.totals = read.totals
  read.previousBookPayments = [{ statementId: 'management-prior', month: '2026-08', book: read.book, actualRefs: [{ kind: 'released-statement', statementId: 'management-prior' }], amount: feeAmount(200), sourceVersion: 'paid-1' }]
  render(PayrollAFeesReview, { props: { read, returnTo: '/subcontract/payroll/wage-a?origin=real' }, global })
  expect(screen.getByText('管理费进度款 · 独立管理簿')).toBeTruthy()
  expect(screen.getAllByText(/-600\.00/).length).toBeGreaterThan(0)
  expect(screen.getByText('未收尾代付依据')).toBeTruthy()
  expect(screen.getByText(/520\.00/)).toBeTruthy()
  expect(screen.getByRole('region', { name: '本簿此前实际已领' }).textContent).toContain('200.00')
})

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
