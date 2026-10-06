import type { FinancePageDraft } from '~/lib/finance/page'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import * as Vue from 'vue'
import VxeUI from 'vxe-pc-ui'
import VxeTable from 'vxe-table'
import FinanceGeneralFormFields from '~/components/finance/FinanceGeneralFormFields.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'
import TablePager from '~/components/ui/TablePager.vue'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'
import '~/assets/css/vxe-theme.css'

afterEach(() => vi.unstubAllGlobals())
it('真实工人/分供方选择及原费用列表保存稳定身份，五档视口表内横滚，键盘与浮层焦点可用', async () => {
  for (const [name, api] of Object.entries({ computed: Vue.computed, nextTick: Vue.nextTick, onMounted: Vue.onMounted, useTemplateRef: Vue.useTemplateRef, watch: Vue.watch })) vi.stubGlobal(name, api)
  const workers = vi.fn(async () => [{ id: 'worker-global', label: '跨项目同一工人' }])
  const suppliers = vi.fn(async () => [{ id: 'supplier-person', label: '临时金个人分供方' }])
  const originals = vi.fn(async () => [{ id: 'expense-original', label: '已记录原运费', hint: '工人垫付 40 元' }])
  const draft = Vue.ref({ applicant: '历史姓名原文', applicantNameSnapshot: null, applicantWorkerId: null, applicantSupplierId: null, lines: [{ expenseItem: '真实运费', amount: 40, counterpartySupplierId: null, originalExpenseLineId: null }] } as FinancePageDraft)
  await render(Vue.defineComponent({ setup: () => () => Vue.h('main', { style: { padding: '12px', maxWidth: '100%', minWidth: '0' } }, [Vue.h(FinanceGeneralFormFields, { kind: 'reimbursement', draft: draft.value, fetchProjects: async () => [], fetchWorkers: workers, fetchSuppliers: suppliers, fetchOriginalExpenses: originals, onPatch: (patch) => {
    draft.value = { ...draft.value, ...patch }
  } }), Vue.h(LookupSelect, { fetch: suppliers, disabledReason: '请先核实来源', placeholder: '不可操作的来源' })]) }), { global: { plugins: [createPinia(), VxeUI, VxeTable], components: { LookupSelect, SelectFilter, SectionHeader, TablePager } } })
  // The select type and searchable picker have separate comboboxes; use the worker placeholder for the actual picker.
  const input = page.getByPlaceholder('从全局工人清单选择')
  await input.click()
  await input.fill('工人')
  await expect.element(page.getByRole('option', { name: '跨项目同一工人' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await expect.poll(() => draft.value.applicantWorkerId).toBe('worker-global')
  await expect.element(input).toHaveFocus()
  expect(draft.value.applicant).toBe('历史姓名原文')
  expect(workers).toHaveBeenCalledWith('工人')
  const type = page.getByRole('combobox', { name: '报销身份类型' })
  await type.click()
  await page.getByRole('option', { name: '分供方清单' }).click()
  const supplier = page.getByPlaceholder('选择垫付分供方')
  await supplier.click()
  await supplier.fill('临时金')
  await page.getByRole('option', { name: '临时金个人分供方' }).click()
  await expect.poll(() => draft.value.applicantSupplierId).toBe('supplier-person')
  await expect.element(supplier).toHaveFocus()
  expect(draft.value.applicantWorkerId).toBeNull()
  expect(draft.value.applicant).toBe('历史姓名原文')
  await page.getByRole('button', { name: '清空选择' }).click()
  await expect.poll(() => draft.value.applicantSupplierId).toBeNull()
  await expect.element(supplier).toHaveFocus()
  await supplier.fill('临时金')
  await expect.element(page.getByRole('option', { name: '临时金个人分供方' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await expect.poll(() => draft.value.applicantSupplierId).toBe('supplier-person')
  await expect.element(supplier).toHaveFocus()
  const source = page.getByPlaceholder('选择实际服务分供方')
  await source.click()
  await source.fill('临时金')
  await page.getByRole('option', { name: '临时金个人分供方' }).click()
  await expect.poll(() => draft.value.lines![0]!.counterpartySupplierId).toBe('supplier-person')
  const original = page.getByPlaceholder('新费用留空；清偿选择原费用')
  await original.click()
  await original.fill('运费')
  await page.getByRole('option', { name: /已记录原运费/ }).click()
  await expect.poll(() => draft.value.lines![0]!.originalExpenseLineId).toBe('expense-original')
  await expect.element(original).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  const item = page.elementLocator(document.querySelector<HTMLInputElement>('[data-testid="reimbursement-item-0"]')!)
  await item.click()
  await userEvent.keyboard('{End}补充')
  await expect.poll(() => draft.value.lines![0]!.expenseItem).toBe('真实运费补充')
  await expect.element(item).toHaveFocus()
  expect(draft.value.lines![0]!.counterpartySupplierId).toBe('supplier-person')
  expect(draft.value.lines![0]!.originalExpenseLineId).toBe('expense-original')
  const disabled = page.getByPlaceholder('不可操作的来源')
  await expect.element(disabled).toBeDisabled()
  await page.getByRole('button', { name: '请先核实来源' }).click()
  await expect.element(disabled).toHaveAttribute('aria-expanded', 'false')
  const scroll = document.querySelector<HTMLElement>('.vxe-table--scroll-x-handle')!
  await expect.poll(() => scroll.scrollWidth).toBeGreaterThan(1200)
  if (scroll.scrollWidth > scroll.clientWidth) {
    scroll.scrollLeft = scroll.scrollWidth
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  await expect.poll(() => document.querySelectorAll('[role="listbox"]')).toHaveLength(0)
})
