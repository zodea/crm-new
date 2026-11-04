import type { AuxiliaryContractDraft } from '~/lib/auxiliary-contract/contract'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import * as Vue from 'vue'
import AuxiliaryContractFormFields from '~/components/contract/AuxiliaryContractFormFields.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'

afterEach(() => vi.unstubAllGlobals())

it('公司合同用键盘明确选择已有分供方，保留旧对方原文并适配视口', async () => {
  vi.stubGlobal('computed', Vue.computed)
  const draft = Vue.ref<AuxiliaryContractDraft>({ id: 'legacy-company', kind: 'company_expense', counterparty: '旧对方原文' })
  const suppliers = [{ id: 'supplier-a', label: '同名公司', version: '2' }, { id: 'supplier-b', label: '另一公司', version: '5' }]
  const fetchSuppliers = vi.fn(async (keyword: string) => suppliers.filter(row => row.label.includes(keyword)))
  await render(Vue.defineComponent({ setup: () => () => Vue.h('main', { style: { padding: '12px', minWidth: '0' } }, Vue.h(AuxiliaryContractFormFields, {
    draft: draft.value,
    errors: {},
    constructionMain: null,
    fetchProjects: async () => [],
    fetchSuppliers,
    fetchMains: async () => [],
    fetchSignatories: async () => [],
    onPatch: patch => draft.value = { ...draft.value, ...patch },
    onSelectSupplier: (id) => {
      const selected = suppliers.find(row => row.id === id)
      draft.value = { ...draft.value, supplierId: selected?.id ?? null, supplierVersion: selected?.version ?? null, counterparty: selected?.label ?? draft.value.counterparty }
    },
  })) }), { global: { plugins: [createPinia()], components: { LookupSelect, SelectFilter, SectionHeader } } })
  await expect.element(page.getByLabelText('历史对方单位原文（尚未关联分供方）')).toHaveValue('旧对方原文')
  const input = page.getByPlaceholder('搜索已有分供方')
  await input.click()
  await input.fill('同名')
  await expect.element(page.getByRole('option', { name: '同名公司' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await expect.poll(() => draft.value.supplierId).toBe('supplier-a')
  expect(draft.value.supplierVersion).toBe('2')
  await expect.element(input).toHaveFocus()
  await expect.element(page.getByText('合同采用名称：同名公司')).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
