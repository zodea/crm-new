import type { FinancePageDraft } from '~/lib/finance/page'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import * as Vue from 'vue'
import FinancePaymentFormFields from '~/components/finance/FinancePaymentFormFields.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'

afterEach(() => vi.unstubAllGlobals())

it('付款合同同号跨域可区分，键盘选择保留完整身份并随收款方变化清除', async () => {
  for (const [name, api] of Object.entries({ computed: Vue.computed, nextTick: Vue.nextTick, onMounted: Vue.onMounted, useTemplateRef: Vue.useTemplateRef, watch: Vue.watch })) vi.stubGlobal(name, api)
  const draft = Vue.ref({ bizType: '预付款', projectId: 'project-one', supplierId: 'supplier-one', invoiceState: '无需发票', contractId: 'legacy-contract', contractReference: null } as FinancePageDraft)
  const contracts = [
    { id: 'subcontract_same-id', label: '同号分包合同', paymentContract: { domain: 'subcontract', id: 'same-id', version: '1' } },
    { id: 'auxiliary_same-id', label: '同号其他支出合同', paymentContract: { domain: 'auxiliary', id: 'same-id', version: '2' } },
  ]
  const empty = async () => []
  await render(Vue.defineComponent({ setup: () => () => Vue.h('main', { style: { padding: '12px', minWidth: '0' } }, Vue.h(FinancePaymentFormFields, {
    kind: 'payment_application',
    draft: draft.value,
    fetchProjects: empty,
    fetchSuppliers: async () => [{ id: 'supplier-two', label: '另一分供方' }],
    fetchWorkers: empty,
    fetchExpenseContracts: async () => contracts,
    fetchSettlements: empty,
    fetchInvoices: empty,
    fetchPaymentApplications: empty,
    onPatch: patch => draft.value = { ...draft.value, ...patch },
  })) }), { global: { plugins: [createPinia()], components: { LookupSelect, SelectFilter, SectionHeader, FinanceLineGrid: Vue.defineComponent({ render: () => null }) } } })
  await expect.element(page.getByText('原合同领域待核实，请重新选择真实合同。')).toBeVisible()
  const input = page.getByPlaceholder('检索支出合同')
  await input.click()
  await expect.element(page.getByRole('option', { name: '同号分包合同' })).toBeVisible()
  await expect.element(page.getByRole('option', { name: '同号其他支出合同' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await expect.poll(() => draft.value.contractReference).toEqual({ domain: 'auxiliary', id: 'same-id', version: '2' })
  expect(draft.value.contractId).toBe('same-id')
  await expect.element(input).toHaveFocus()
  const supplier = page.getByPlaceholder('检索分供方')
  await supplier.click()
  await page.getByRole('option', { name: '另一分供方' }).click()
  await expect.poll(() => draft.value.contractReference).toBeNull()
  expect(draft.value.contractId).toBeNull()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
