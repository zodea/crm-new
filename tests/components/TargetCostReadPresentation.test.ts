import type { TargetCostMetric } from '~/lib/target-cost/central-contract'
import type { TargetCostDetailSummary as DetailSummary, TargetCostDetailHeader } from '~/lib/target-cost/detail'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive } from 'vue'
import TargetCostFormFields from '~/components/master-data/TargetCostFormFields.vue'
import TargetCostAttachments from '~/components/target-cost/TargetCostAttachments.vue'
import TargetCostDetailSummary from '~/components/target-cost/TargetCostDetailSummary.vue'
import TargetCostMetricValue from '~/components/target-cost/TargetCostMetricValue.vue'
import TargetCostProjectReturn from '~/components/target-cost/TargetCostProjectReturn.vue'
import TargetCostSourceReturn from '~/components/target-cost/TargetCostSourceReturn.vue'
import Metric from '~/components/ui/Metric.vue'
import MetricGrid from '~/components/ui/MetricGrid.vue'

const read = vi.fn()
const route = reactive({ path: '/contract/subcontract', query: { origin: 'real', budgetId: 'budget-a', budgetProject: 'p', budgetReturnTo: '/project/target-cost/budget-a?origin=real&tab=comparison' } as Record<string, string> })
const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } }
beforeEach(() => {
  vi.clearAllMocks()
  read.mockResolvedValue({ context: { origin: 'real', capabilities: ['target-cost:read'] }, targetCostId: 'budget-a', view: { header: { projectId: 'p', name: '预算A' } } })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { targetCosts: { detail: read, list: read } } }))
  vi.stubGlobal('useTargetCostListStore', () => ({ load: read }))
  vi.stubGlobal('useTargetCostDetailStore', () => ({ loadCentral: read }))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('computed', computed)
})
afterEach(() => vi.unstubAllGlobals())
describe('预算原值和受控回程', () => {
  it('现行只读汇总随回读更新可证100、未知、真实零和已证空源，原金额及来源不被改写', async () => {
    const completeZero: TargetCostMetric = { value: 0, knownValue: 0, status: 'complete', missingSources: [] }
    const partial: TargetCostMetric = { value: null, knownValue: 100, status: 'partial', missingSources: ['P4实际工资源:unavailable'] }
    const header: TargetCostDetailHeader = { id: 'budget-a', projectId: 'p', projectCode: '', projectName: '项目', name: '预算', isBaseline: true, contractRevenue: null, plannedProfit: null, signedContractSum: null, taxInclusiveTotal: 0, taxExclusiveTotal: null, taxAmount: null, status: 'submitted', note: '', createdAt: '', updatedAt: '' }
    const summary: DetailSummary = { itemTotal: 0, signedAmount: 0, settledAmount: null, paidAmount: 0, remainingAmount: null, metrics: { targetAmount: completeZero, signedAmount: completeZero, settledAmount: partial, paidAmount: completeZero, remainingAmount: { value: null, knownValue: null, status: 'pending', missingSources: ['P4实际工资源:unavailable'] } } }
    const original = structuredClone(summary)
    const wrapper = mount(TargetCostDetailSummary, { props: { header, summary }, global: { components: { Metric, MetricGrid } } })
    const dynamicCost = () => wrapper.get('[role="group"][aria-label="动态成本"]')
    expect(dynamicCost().text()).toContain('已知 ¥100.00')
    expect(dynamicCost().text()).toContain('部分已知')
    expect(dynamicCost().text()).toContain('P4实际工资源:unavailable')
    expect(wrapper.get('[role="group"][aria-label="预算剩余"]').text()).toContain('未知')
    await wrapper.setProps({ summary: { ...summary, metrics: { ...summary.metrics, settledAmount: { value: null, knownValue: null, status: 'pending', missingSources: ['P4实际工资源:unavailable'] } } } })
    expect(dynamicCost().text()).toContain('未知')
    expect(dynamicCost().text()).toContain('来源未齐')
    expect(dynamicCost().text()).not.toContain('¥0.00')
    await wrapper.setProps({ summary: { ...summary, settledAmount: 0, metrics: { ...summary.metrics, settledAmount: completeZero } } })
    expect(dynamicCost().text()).toContain('¥0.00')
    expect(dynamicCost().text()).not.toContain('未知')
    expect(dynamicCost().text()).not.toContain('来源未齐')
    await wrapper.setProps({ summary: { itemTotal: 0, signedAmount: 0, settledAmount: 0, paidAmount: 0, remainingAmount: 0, metrics: { targetAmount: completeZero, signedAmount: completeZero, settledAmount: completeZero, paidAmount: completeZero, remainingAmount: completeZero } } })
    expect(wrapper.get('[role="group"][aria-label="科目明细合计"]').text()).toContain('¥0.00')
    expect(wrapper.get('[role="group"][aria-label="预算剩余"]').text()).toContain('¥0.00')
    expect(wrapper.text()).not.toContain('未知')
    expect(wrapper.find('input, button, select, a').exists()).toBe(false)
    expect(wrapper.emitted('update:summary')).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    expect(summary).toEqual(original)
    wrapper.unmount()
  })
  it('缺失原件仅显示文件名和说明，不伪装可下载入口', () => {
    const file = { id: 'missing', ownerType: 'target_cost' as const, ownerId: 'a', fileName: '缺失原件.pdf', fileSize: null, mimeType: 'application/pdf', category: '', uploader: '', uploadedAt: null, deletedAt: null, payloadState: 'missing' as const }
    const wrapper = mount(TargetCostAttachments, { props: { files: [file], pending: [], removeIds: [], restoreIds: [], readonly: true }, global: { stubs: { SectionHeader: true } } })
    expect(wrapper.text()).toContain('缺失原件.pdf')
    expect(wrapper.text()).toContain('原件缺失')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
  it('含税与无税税额不符时给具体勾稽差额，任何金额均不自动覆盖', () => {
    const model = { taxInclusiveTotal: 100, taxExclusiveTotal: 80, taxAmount: 10 }
    const wrapper = mount(TargetCostFormFields, { props: { modelValue: model, fieldErrors: {}, fetchProjects: async () => [] }, global: { stubs: { SectionHeader: true, LookupSelect: true } } })
    expect(wrapper.get('[aria-label="预算税价勾稽提示"]').text()).toContain('10.00')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(model).toEqual({ taxInclusiveTotal: 100, taxExclusiveTotal: 80, taxAmount: 10 })
    wrapper.unmount()
  })
  it('项目回程复核实际预算所属，错项目不产生可点击入口', async () => {
    const wrapper = mount(TargetCostProjectReturn, { props: { projectId: 'p', origin: 'real', returnTo: '/project/target-cost/budget-a?origin=real&tab=comparison' }, global: { stubs } })
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toContain('/project/target-cost/budget-a')
    await wrapper.setProps({ projectId: 'another' })
    await flushPromises()
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('关系已不一致')
    wrapper.unmount()
  })
  it('实际来源返回保持原版本及来源，页面未使用其他详情读取基准', async () => {
    const wrapper = mount(TargetCostSourceReturn, { global: { stubs } })
    await flushPromises()
    expect(read).toHaveBeenCalledWith({ origin: 'real' }, 'budget-a')
    expect(wrapper.get('a').attributes('href')).toBe('/project/target-cost/budget-a?origin=real&tab=comparison')
    wrapper.unmount()
  })
  it.each([
    { label: '未知来源', metric: { value: null, knownValue: null, status: 'pending' as const, missingSources: ['分包合同:forbidden', '材料结算:pending'] }, expected: ['未知', '当前身份无权读取'], absent: ['forbidden', '0.00'] },
    { label: '真实零', metric: { value: 0, knownValue: 0, status: 'complete' as const, missingSources: [] }, expected: ['0.00'], absent: ['forbidden', '未知'] },
  ])('$label 状态中文可读，不混淆未知与真实零', ({ metric, expected, absent }) => {
    const wrapper = mount(TargetCostMetricValue, { props: { metric } })
    for (const text of expected)
      expect(wrapper.text()).toContain(text)
    for (const text of absent)
      expect(wrapper.text()).not.toContain(text)
    wrapper.unmount()
  })
  it.each([
    { input: '', expected: null },
    { input: '0', expected: 0 },
    { input: '12.50', expected: 12.5 },
  ])('版本头金额 $input 产生 $expected', async ({ input: value, expected }) => {
    const wrapper = mount(TargetCostFormFields, { props: { modelValue: { taxAmount: 2 }, fieldErrors: {}, fetchProjects: async () => [] }, global: { stubs: { SectionHeader: true, LookupSelect: true } } })
    const input = wrapper.get('input[data-field="taxAmount"]')
    await input.setValue(value)
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ taxAmount: expected })
    wrapper.unmount()
  })
})
