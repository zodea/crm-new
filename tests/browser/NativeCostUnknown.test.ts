import type { TargetCostMetric } from '~/lib/target-cost/central-contract'
import type { TargetCostDetailSummary as DetailSummary, TargetCostDetailCategory } from '~/lib/target-cost/detail'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import VxeUI from 'vxe-pc-ui'
import VxeTable from 'vxe-table'
import TargetCostComparisonTable from '~/components/target-cost/TargetCostComparisonTable.vue'
import TargetCostDetailSummary from '~/components/target-cost/TargetCostDetailSummary.vue'
import KitTable from '~/components/ui/KitTable.vue'
import Metric from '~/components/ui/Metric.vue'
import MetricGrid from '~/components/ui/MetricGrid.vue'
import MoneyLink from '~/components/ui/MoneyLink.vue'
import TablePager from '~/components/ui/TablePager.vue'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'
import '~/assets/css/vxe-theme.css'

afterEach(() => vi.unstubAllGlobals())
const known = (value: number): TargetCostMetric => ({ value, knownValue: value, status: 'complete', missingSources: [] })
const pending: TargetCostMetric = { value: null, knownValue: null, status: 'pending', missingSources: ['P4实际工资源:unavailable'] }
const partial: TargetCostMetric = { value: null, knownValue: 120, status: 'partial', missingSources: ['P4实际工资源:unavailable'] }
const metrics = { targetAmount: known(300), signedAmount: known(0), settledAmount: pending, paidAmount: pending, remainingAmount: pending }
const category: TargetCostDetailCategory = { id: 'wage', category: '工人工资', targetAmount: 300, signedAmount: 0, settledAmount: null, paidAmount: null, remainingAmount: null, metrics, targetLineCount: 1, contractCount: 0, settlementCount: 0, paymentCount: null, reimbursementCount: 0, contractPath: '', settlementPath: '', paymentPath: '', reimbursementPath: '' }

it('实际目标成本显示未知及可证小计，来源可键盘展开，五档视口仅表内横滚且回读切换不造零', async () => {
  // Register the same Vue APIs/components/plugins that Nuxt supplies; domain values remain explicit fixture evidence.
  for (const [name, api] of Object.entries({ computed, nextTick, onMounted, useTemplateRef, watch }))
    vi.stubGlobal(name, api)
  const summary = ref<DetailSummary>({ itemTotal: 300, signedAmount: 0, settledAmount: null, paidAmount: null, remainingAmount: null, metrics: { ...metrics, settledAmount: partial } })
  const categories = ref<TargetCostDetailCategory[]>([category])
  await render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, [
    h(TargetCostDetailSummary, { header: { id: 'budget', projectId: 'project', projectCode: '', projectName: '合成项目', name: '预算', isBaseline: true, contractRevenue: null, plannedProfit: null, signedContractSum: null, taxInclusiveTotal: 300, taxExclusiveTotal: null, taxAmount: null, status: 'submitted', note: '', createdAt: '', updatedAt: '' }, summary: summary.value }),
    h(TargetCostComparisonTable, { categories: categories.value }),
  ]) }), { global: { plugins: [VxeUI, VxeTable], components: { KitTable, TablePager, MetricGrid, Metric, MoneyLink, NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } } })
  await expect.element(page.getByRole('group', { name: '动态成本', exact: true })).toHaveTextContent('已知 ¥120.00')
  await expect.element(page.getByRole('group', { name: '预算剩余', exact: true })).toHaveTextContent('未知')
  const scroll = document.querySelector<HTMLElement>('.vxe-table--scroll-x-handle')!
  await expect.poll(() => scroll.scrollWidth).toBeGreaterThan(900)
  if (scroll.scrollWidth > scroll.clientWidth) {
    scroll.scrollLeft = scroll.scrollWidth
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
    scroll.scrollLeft = 0
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const cell = page.getByLabelText('工人工资 动态成本来源', { exact: true })
  await cell.element().focus()
  await expect.element(cell).toHaveFocus()
  await userEvent.tab()
  expect(document.activeElement?.tagName).toBe('SUMMARY')
  await userEvent.keyboard('{Enter}')
  expect(cell.element().querySelector('details')?.open).toBe(true)
  await expect.element(cell).toHaveTextContent('P4实际工资源：来源暂不可用')
  const dynamicCost = page.getByRole('group', { name: '动态成本', exact: true })
  summary.value = { ...summary.value, settledAmount: 100, metrics: { ...metrics, settledAmount: known(100) } }
  categories.value = [{ ...category, settledAmount: 100, metrics: { ...metrics, settledAmount: known(100) } }]
  await expect.element(dynamicCost).toHaveTextContent('¥100.00')
  await expect.element(cell).toHaveTextContent('¥100.00')
  await expect.element(cell).not.toHaveTextContent('来源未齐')
  summary.value = { ...summary.value, settledAmount: null, metrics: { ...metrics, settledAmount: pending } }
  categories.value = [category]
  await expect.element(dynamicCost).toHaveTextContent('未知')
  await expect.element(dynamicCost).not.toHaveTextContent('¥0.00')
  await expect.element(cell).toHaveTextContent('未知')
  summary.value = { ...summary.value, settledAmount: 0, metrics: { ...metrics, settledAmount: known(0) } }
  categories.value = [{ ...category, settledAmount: 0, metrics: { ...metrics, settledAmount: known(0) } }]
  await expect.element(dynamicCost).toHaveTextContent('¥0.00')
  await expect.element(dynamicCost).not.toHaveTextContent('来源未齐')
  await expect.element(cell).toHaveTextContent('¥0.00')
  await expect.element(cell).not.toHaveTextContent('未知')
  categories.value = []
  await expect.element(page.getByRole('region', { name: '目标与实际对比' })).toHaveTextContent('当前项目尚无成本对比事实')
  await expect.element(dynamicCost).toHaveTextContent('¥0.00')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
