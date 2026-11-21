import { fireEvent, render, screen, within } from '@testing-library/vue'
import { expect, it } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import PayrollAManagementScopeEditor from '~/components/payroll/PayrollAManagementScopeEditor.vue'
import PayrollANegativeLineEditor from '~/components/payroll/PayrollANegativeLineEditor.vue'
import PayrollAFeeBasisEditor from '~/pages/subcontract/payroll/_components/PayrollAFeeBasisEditor.vue'
import PayrollAFeeEditor from '~/pages/subcontract/payroll/_components/PayrollAFeeEditor.vue'
import { feeConfigRead, feeDraft, negativeDraft } from '../helpers/payroll-fees-ui-fixture'

const global = { stubs: { KitButton: { template: '<button><slot /></button>' }, EntityLink: true, NuxtLink: true } }
it('没有工程量读取权限仍可选择工资基数，不能凭格子ID造原户链接', async () => {
  const read = feeConfigRead()
  read.context.capabilities = ['payroll:read', 'payroll:write']
  const basis = shallowRef({ kind: 'completed-field-quantity' as const, itemIds: ['wall'], scope: { kind: 'cells' as const, cells: [] as typeof read.responsibilityOptions[0]['cells'] } })
  render(defineComponent({ setup: () => () => h(PayrollAFeeBasisEditor, { basis: basis.value, read, returnTo: '/subcontract/payroll/config?origin=real', disabled: false, onChange: value => Object.assign(basis.value, value) }) }), { global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
  expect(screen.queryByRole('link', { name: '核对户内工程量' })).toBeNull()
  await fireEvent.click(screen.getByRole('checkbox', { name: '一栋 · 101 · 客厅 · 墙砖' }))
  expect(basis.value.scope.cells).toEqual(read.responsibilityOptions[0]!.cells)
})
it('费用原户入口只消费同责任已授权导航，并保留配置返回', () => {
  const read = feeConfigRead()
  read.context.capabilities = [...read.context.capabilities, 'quantity:read']
  read.responsibilityOptions[0]!.sources = [{ kind: 'entity-detail', subject: { state: 'resolved', entity: 'quantity-unit', id: 'unit', label: '已证原户', no: null }, variant: 'detail', view: null, filters: { dataOrigin: 'real', projectId: 'project' } }]
  const returnTo = '/subcontract/payroll/config?origin=real&project=project&month=2026-09&crew=crew&leader=worker'
  render(PayrollAFeeBasisEditor, { props: { basis: { kind: 'completed-field-quantity', itemIds: ['wall'], scope: { kind: 'cells', cells: [] } }, read, returnTo, disabled: false }, global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
  const url = new URL(screen.getByRole('link', { name: '核对户内工程量' }).getAttribute('href')!, 'https://local.invalid')
  expect(url.pathname).toBe('/subcontract/quantity/project/unit')
  expect(url.searchParams.get('payrollReturnTo')).toBe(returnTo)
})
it('班组明确关闭及零单价可读且采用后保留 false 和 0', async () => {
  const read = feeConfigRead()
  read.crewDefaults!.rentEnabled = { state: 'value', value: false }
  read.crewDefaults!.rentUnitPrice = { state: 'value', value: 0 }
  const draft = shallowRef(feeDraft())
  render(defineComponent({ setup: () => () => h(PayrollAFeeEditor, { draft: draft.value, read, disabled: false, onChange: value => draft.value = value }) }), { global })
  const facts = within(screen.getByRole('region', { name: '班组费用默认事实' }))
  expect(facts.getByText('开关：已关闭')).toBeTruthy()
  expect(facts.getByText('单价：明确 0.00 元')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '采用班组房补默认' }))
  expect(draft.value).toMatchObject({ enabled: false, unitPrice: 0 })
})
it('班组管理费 false/null 与从未记录默认分别显示', async () => {
  const read = feeConfigRead()
  read.crewDefaults!.managementEnabled = { state: 'value', value: false }
  read.crewDefaults!.managementUnitPrice = { state: 'null', value: null }
  const wrapper = render(PayrollAFeeEditor, { props: { draft: { ...feeDraft(), bookPurpose: 'management', managementBookId: 'management-book', kind: 'management' }, read, disabled: false }, global })
  let facts = within(screen.getByRole('region', { name: '班组费用默认事实' }))
  expect(facts.getByText('开关：已关闭')).toBeTruthy()
  expect(facts.getByText('单价：未填写')).toBeTruthy()
  await wrapper.rerender({ read: { ...read, crewDefaults: null } })
  facts = within(screen.getByRole('region', { name: '班组费用默认事实' }))
  expect(facts.getByText('开关：未记录')).toBeTruthy()
  expect(facts.getByText('单价：未记录')).toBeTruthy()
})
it('未导出的默认不被采用，同名不同ID分项逐项明确选择后才可采用房补建议', async () => {
  const draft = shallowRef(feeDraft())
  render(defineComponent({ setup: () => () => h(PayrollAFeeEditor, { draft: draft.value, read: feeConfigRead(), disabled: false, onChange: value => draft.value = value }) }), { global })
  expect(screen.getByRole('button', { name: '采用班组房补默认' }).hasAttribute('disabled')).toBe(true)
  await fireEvent.click(screen.getByRole('checkbox', { name: '同名分项 · ㎡ · 待确认分类' }))
  expect(draft.value.basis.itemIds).toEqual(['wall'])
  expect(draft.value.adoptedDefault).toBeNull()
  expect(draft.value.enabled).toBe(false)
  await fireEvent.update(screen.getByRole('textbox', { name: '房补分类确认依据' }), '现场确认所选项为墙砖')
  await fireEvent.click(screen.getByRole('button', { name: '确认所选房补分项并采用 1.30 元/㎡' }))
  expect(draft.value).toMatchObject({ enabled: true, unitPrice: 1.3, adoptedDefault: { kind: 'confirmed-housing-items', itemIds: ['wall'], evidenceNote: '现场确认所选项为墙砖' } })
  await fireEvent.update(screen.getByRole('spinbutton', { name: '费用单价' }), '0')
  expect(draft.value.unitPrice).toBe(0)
})
it('选择责任只传已选原assignment/scope/cells，取消后保显式空集合', async () => {
  const scope = shallowRef({ assignments: [] as ReturnType<typeof negativeDraft>['scope']['assignments'] })
  render(defineComponent({ setup: () => () => h(PayrollAManagementScopeEditor, { scope: scope.value, options: feeConfigRead().responsibilityOptions, disabled: false, onChange: value => scope.value = value }) }), { global })
  const option = screen.getByRole('checkbox', { name: '一栋 · 原施工人 · 墙砖' })
  await fireEvent.click(option)
  expect(scope.value).toEqual(negativeDraft().scope)
  await fireEvent.click(option)
  expect(scope.value).toEqual({ assignments: [] })
})
it('同一责任中可只选未收尾淋浴板细格，墙地不混入代付范围', async () => {
  const read = feeConfigRead()
  const shower = { unitId: 'unit', roomId: 'room', itemId: 'shower' }
  read.responsibilityOptions[0]!.cells.push(shower)
  read.cellOptions.push({ ...shower, locationLabel: '一栋 · 101 · 淋浴板 · 未收尾' })
  const scope = shallowRef({ assignments: [] as ReturnType<typeof negativeDraft>['scope']['assignments'] })
  render(defineComponent({ setup: () => () => h(PayrollAManagementScopeEditor, { scope: scope.value, options: read.responsibilityOptions, cellOptions: read.cellOptions, disabled: false, onChange: value => scope.value = value }) }), { global })
  await fireEvent.click(screen.getByRole('checkbox', { name: '一栋 · 101 · 淋浴板 · 未收尾' }))
  expect(scope.value.assignments).toEqual([{ assignmentId: 'assignment-original', scopeIds: ['scope-original'], cells: [shower] }])
  expect((screen.getByRole('checkbox', { name: '一栋 · 101 · 客厅 · 墙砖' }) as HTMLInputElement).checked).toBe(false)
})
it('负价行保数量单位原修订及未关联事实，不提供自由总额输入', async () => {
  const draft = shallowRef(negativeDraft())
  render(defineComponent({ setup: () => () => h(PayrollANegativeLineEditor, { draft: draft.value, options: feeConfigRead().responsibilityOptions, disabled: false, onChange: value => draft.value = value }) }), { global })
  expect(screen.getAllByText(/未关联实际收付/).length).toBeGreaterThan(0)
  expect(screen.queryByRole('spinbutton', { name: '金额' })).toBeNull()
  await fireEvent.update(screen.getByRole('spinbutton', { name: '代付负单价' }), '-30')
  expect(draft.value).toMatchObject({ lineId: 'negative-line', baseRevisionId: 'negative-revision', quantity: 30, unit: '套', unitPrice: -30, actualRef: null })
})
