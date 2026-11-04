import type { FinancePageDraft } from '~/lib/finance/page'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import * as Vue from 'vue'
import FinancePaymentFormFields from '~/components/finance/FinancePaymentFormFields.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'

vi.mock('~/components/finance/FinanceLineGrid.vue', () => ({ default: { template: '<div />' } }))

afterEach(() => vi.unstubAllGlobals())

it('合同变更后重新读取同一合同版本，并保留付款草稿和来源失权保护', async () => {
  for (const [name, api] of Object.entries({ computed: Vue.computed, nextTick: Vue.nextTick, onMounted: Vue.onMounted, useTemplateRef: Vue.useTemplateRef, watch: Vue.watch })) vi.stubGlobal(name, api)
  const allocations = [{ invoiceId: 'invoice-original', allocatedAmount: 42 }]
  const draft = Vue.ref({ bizType: '公司付款', supplierId: 'supplier-one', invoiceState: '先款后票', name: '保留的申请', applyAmount: 42, invoiceAllocations: allocations } as FinancePageDraft)
  let version = '1'
  let forbidden = false
  const fetchContracts = vi.fn(async () => {
    if (forbidden)
      throw new Error('合同来源不可读')
    return [{ id: 'company_same-contract', label: '同一公司合同', paymentContract: { domain: 'company', id: 'same-contract', version } }]
  })
  const empty = async () => []
  await render(Vue.defineComponent({ setup: () => () => Vue.h('main', { style: { padding: '12px', minWidth: '0' } }, Vue.h(FinancePaymentFormFields, {
    kind: 'payment_application',
    draft: draft.value,
    fetchProjects: empty,
    fetchSuppliers: empty,
    fetchWorkers: empty,
    fetchExpenseContracts: fetchContracts,
    fetchSettlements: empty,
    fetchInvoices: empty,
    fetchPaymentApplications: empty,
    onPatch: patch => draft.value = { ...draft.value, ...patch },
  })) }), { global: { plugins: [createPinia()], components: { LookupSelect, SelectFilter, SectionHeader, FinanceLineGrid: Vue.defineComponent({ render: () => null }) } } })
  const input = page.getByPlaceholder('检索支出合同')
  await input.click()
  await page.getByRole('option', { name: '同一公司合同' }).click()
  await expect.poll(() => draft.value.contractReference).toEqual({ domain: 'company', id: 'same-contract', version: '1' })
  draft.value = { ...draft.value, invoiceAllocations: allocations }
  version = '2'
  const refresh = page.getByRole('button', { name: '重新读取合同' })
  await expect.element(refresh).toBeVisible()
  await refresh.click()
  await expect.element(refresh).toHaveFocus()
  await expect.poll(() => fetchContracts.mock.calls.length).toBeGreaterThanOrEqual(2)
  await input.click()
  await page.getByRole('option', { name: '同一公司合同' }).click()
  await expect.poll(() => draft.value.contractReference).toEqual({ domain: 'company', id: 'same-contract', version: '2' })
  expect(draft.value).toMatchObject({ name: '保留的申请', applyAmount: 42, invoiceAllocations: allocations })
  forbidden = true
  await refresh.click()
  await expect.poll(() => fetchContracts.mock.calls.length).toBeGreaterThanOrEqual(3)
  await input.click()
  await expect.element(page.getByRole('option', { name: '同一公司合同' })).not.toBeInTheDocument()
  expect(draft.value.contractReference).toEqual({ domain: 'company', id: 'same-contract', version: '2' })
  expect(draft.value).toMatchObject({ name: '保留的申请', applyAmount: 42, invoiceAllocations: allocations })
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
