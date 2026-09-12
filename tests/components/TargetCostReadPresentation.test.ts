import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import TargetCostFormFields from '~/components/master-data/TargetCostFormFields.vue'
import TargetCostAttachments from '~/components/target-cost/TargetCostAttachments.vue'
import TargetCostMetricValue from '~/components/target-cost/TargetCostMetricValue.vue'
import TargetCostProjectReturn from '~/components/target-cost/TargetCostProjectReturn.vue'
import TargetCostSourceReturn from '~/components/target-cost/TargetCostSourceReturn.vue'

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
})
describe('预算原值和受控回程', () => {
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
  it('来源状态中文可读，未知与真实零显示不同', async () => {
    const wrapper = mount(TargetCostMetricValue, { props: { metric: { value: null, knownValue: null, status: 'pending', missingSources: ['分包合同:forbidden', '材料结算:pending'] } } })
    expect(wrapper.text()).toContain('未知')
    expect(wrapper.text()).toContain('当前身份无权读取')
    expect(wrapper.text()).not.toContain('forbidden')
    await wrapper.setProps({ metric: { value: 0, knownValue: 0, status: 'complete', missingSources: [] } })
    expect(wrapper.text()).not.toContain('未知')
    expect(wrapper.text()).toContain('0.00')
    wrapper.unmount()
  })
  it('版本头清空金额产生null，录入零产生0', async () => {
    const wrapper = mount(TargetCostFormFields, { props: { modelValue: { taxAmount: 2 }, fieldErrors: {}, fetchProjects: async () => [] }, global: { stubs: { SectionHeader: true, LookupSelect: true } } })
    const input = wrapper.get('input[data-field="taxAmount"]')
    await input.setValue('')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ taxAmount: null })
    await input.setValue('0')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ taxAmount: 0 })
    wrapper.unmount()
  })
})
