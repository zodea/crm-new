import type { ContractAuxRow } from '~/lib/contract/aux-list'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, onActivated, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import VxeUI from 'vxe-pc-ui'
import VxeTable from 'vxe-table'
import ContractAuxListScreen from '~/components/contract/ContractAuxListScreen.vue'
import ContractAuxListToolbar from '~/components/contract/ContractAuxListToolbar.vue'
import KitTable from '~/components/ui/KitTable.vue'
import RowActionMenu from '~/components/ui/RowActionMenu.vue'
import SearchInput from '~/components/ui/SearchInput.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import TablePager from '~/components/ui/TablePager.vue'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'
import '~/assets/css/vxe-theme.css'

afterEach(() => vi.unstubAllGlobals())

it('native 公司合同实际表格、筛选合计和键盘在五档视口保留未知与真实零', async () => {
  const row: ContractAuxRow = { id: 'native-known', no: 'KNOWN-01', name: '已知公司合同', projectId: '', projectName: '', supplierId: '', supplierName: '', contractId: '', contractName: '', category: '房租', counterparty: '真实文书单位', period: '2026年', amount: 80, date: '2026-10-04', status: '履约中' }
  const rows = [row, { ...row, id: 'native-null', name: '未知公司合同', amount: null }, { ...row, id: 'native-zero', name: '真实零公司合同', amount: 0 }]
  for (const [name, api] of Object.entries({ computed, nextTick, onActivated, onMounted, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, api)
  vi.stubGlobal('useRoute', () => ({ query: {}, path: '/contract/company-expense' }))
  vi.stubGlobal('useContractStore', () => ({ auxByKind: () => rows, auxLoadingFor: () => false, auxError: () => '', loadAux: async () => {} }))
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn(), undoToast: vi.fn(), error: vi.fn() }))
  vi.stubGlobal('navigateTo', vi.fn())
  await render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(ContractAuxListScreen, { kind: 'company_expense' })) }), {
    global: { plugins: [VxeUI, VxeTable], components: { ContractAuxListToolbar, KitTable, RowActionMenu, SearchInput, StatePanel, TablePager, NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } },
  })
  const summary = page.getByTestId('contract-aux-summary')
  await expect.element(summary).toHaveTextContent('未知（金额未齐）')
  const input = page.getByRole('searchbox', { name: '搜索合同名称 / 编号 / 对方单位' })
  await input.fill('未知公司')
  await expect.element(summary).toHaveTextContent('合同数：1')
  await expect.element(summary).toHaveTextContent('未知（金额未齐）')
  await expect.element(summary).not.toHaveTextContent('¥0.00')
  await input.fill('真实零')
  await expect.element(summary).toHaveTextContent('¥0.00')
  await expect.element(summary).not.toHaveTextContent('金额未齐')
  await input.fill('已知公司')
  await expect.element(summary).toHaveTextContent('¥80.00')
  await input.fill('不存在')
  await expect.element(summary).toHaveTextContent('合同数：0')
  await expect.element(summary).toHaveTextContent('¥0.00')
  await input.fill('')
  await expect.element(summary).toHaveTextContent('未知（金额未齐）')
  await input.element().focus()
  await expect.element(input).toHaveFocus()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: '刷新公司支出合同' })).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const scroll = document.querySelector<HTMLElement>('.vxe-table--scroll-x-handle')!
  if (scroll.scrollWidth > scroll.clientWidth) {
    scroll.scrollLeft = scroll.scrollWidth
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  }
})
