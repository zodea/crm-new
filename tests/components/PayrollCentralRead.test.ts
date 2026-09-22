import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import CentralPayrollDetailScreen from '~/components/payroll/CentralPayrollDetailScreen.vue'
import CentralPayrollScreen from '~/components/payroll/CentralPayrollScreen.vue'
import CentralPayrollSourcesScreen from '~/components/payroll/CentralPayrollSourcesScreen.vue'
import CentralPayrollUnavailableScreen from '~/components/payroll/CentralPayrollUnavailableScreen.vue'
import PayrollEvidenceTable from '~/components/payroll/PayrollEvidenceTable.vue'
import PayrollReadDiagnostics from '~/components/payroll/PayrollReadDiagnostics.vue'
import PayrollReadFilters from '~/components/payroll/PayrollReadFilters.vue'
import PayrollReadHistory from '~/components/payroll/PayrollReadHistory.vue'
import PayrollReadNotice from '~/components/payroll/PayrollReadNotice.vue'
import PayrollSnapshotEvidence from '~/components/payroll/PayrollSnapshotEvidence.vue'
import PayrollSourceEvidence from '~/components/payroll/PayrollSourceEvidence.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { payrollDetailFixture, payrollListFixture, payrollSourcesFixture } from '../helpers/payroll-central-read-fixture'

const table = defineComponent({ props: ['columns', 'data', 'empty'], template: '<div role="table"><div v-for="row in data"><span v-for="column in columns"><slot v-if="column.slot" :name="column.slot" :row="row"/><template v-else>{{ row[column.field] }}</template></span></div></div>' })
const link = defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : `${props.to.path}?${new URLSearchParams(props.to.query)}` }, slots.default?.()) })
const components = { PayrollReadNotice, PayrollReadDiagnostics, PayrollReadFilters, PayrollReadHistory, PayrollEvidenceTable, PayrollSnapshotEvidence, PayrollSourceEvidence, KitStatusTag }
const stubs = { KitTable: table, SectionHeader: { props: ['title'], template: '<h2>{{title}}</h2>' }, KitButton: { template: '<button><slot /></button>' }, KitMultiSelectFilter: defineComponent({ props: ['label', 'modelValue'], setup: props => () => h('button', { 'aria-label': `${props.label}，已选 ${props.modelValue.length} 项` }, props.label) }), PayrollBatchDialog: { props: ['open', 'rows', 'projectId', 'month'], template: '<div v-if="open" data-testid="batch-dialog">{{projectId}}/{{month}}/{{rows.length}}</div>' }, PayrollWorkbookArchiveDialog: { props: ['open'], template: '<div v-if="open" data-testid="archive-dialog" />' }, NuxtLink: link }
let route: ReturnType<typeof makeRoute>
const detailRead = vi.fn()
const listRead = vi.fn()
const sourceRead = vi.fn()
const router = { replace: vi.fn(), push: vi.fn() }
function makeRoute() {
  return reactive({ path: '/subcontract/payroll/wage-a', params: { id: 'wage-a' }, query: { origin: 'real' } as Record<string, string> })
}
beforeEach(() => {
  vi.clearAllMocks()
  route = makeRoute()
  detailRead.mockResolvedValue(payrollDetailFixture())
  listRead.mockResolvedValue(payrollListFixture())
  sourceRead.mockImplementation(query => Promise.resolve(payrollSourcesFixture(query.projectId)))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => router)
  vi.stubGlobal('usePayrollStore', () => ({ loadRead: listRead }))
  vi.stubGlobal('usePayrollStatementDetailStore', () => ({ loadRead: detailRead }))
  vi.stubGlobal('useAttendanceStore', () => ({ loadRead: sourceRead }))
  vi.stubGlobal('useSignedDayworkStore', () => ({ loadRead: sourceRead }))
  vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
  vi.stubGlobal('useTabTitle', () => {})
})
afterEach(() => vi.unstubAllGlobals())
describe('工资中央只读资料', () => {
  it('只允许同一固定项目月份的未发中央工资进入批次', async () => {
    const value = payrollListFixture()
    const base = value.rows[0]!
    value.context = { ...value.context, capabilities: ['payroll:read', 'payroll:write'], readonly: false }
    value.rows = [
      { ...base, id: 'eligible', status: 'checked', releasedAt: null, formatFamily: 'C1' },
      { ...base, id: 'released', status: 'released', releasedAt: '2026-09-01', formatFamily: 'C2' },
      { ...base, id: 'isolated', status: 'checked', releasedAt: null, recordKind: 'isolated', formatFamily: 'A' },
    ]
    listRead.mockResolvedValue(value)
    route.query = { origin: 'real', project: 'project-a', month: '2026-08' }
    const wrapper = mount(CentralPayrollScreen, { global: { components, stubs } })
    await flushPromises()
    const checks = wrapper.findAll('input[type="checkbox"]')
    expect(checks).toHaveLength(1)
    await checks[0]!.setValue(true)
    expect(wrapper.text()).toContain('批量核对 / 资金（1）')
    await wrapper.findAll('button').find(button => button.text().includes('批量核对 / 资金'))!.trigger('click')
    expect(wrapper.get('[data-testid="batch-dialog"]').text()).toBe('project-a/2026-08/1')
    wrapper.unmount()
  })
  it('同人同月两个A请款簿按已证用途分开展示，旧单没有凭空补普通簿', async () => {
    const value = payrollListFixture()
    const base = value.rows[0]!
    value.rows = [{ ...base, id: 'ordinary', formatFamily: 'A', leaderName: '同一管理人', book: { bookPurpose: 'ordinary', managementBookId: null } }, { ...base, id: 'management', formatFamily: 'A', leaderName: '同一管理人', book: { bookPurpose: 'management', managementBookId: 'management-book' } }, { ...base, id: 'legacy', formatFamily: 'A', leaderName: '原历史人' }]
    listRead.mockResolvedValue(value)
    const wrapper = mount(CentralPayrollScreen, { global: { components, stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('普通施工簿')
    expect(wrapper.text()).toContain('独立管理费簿')
    expect(wrapper.text().match(/普通施工簿/g)).toHaveLength(1)
    expect(wrapper.findAll('a').some(link => link.attributes('href')?.includes('/ordinary?'))).toBe(true)
    expect(wrapper.findAll('a').some(link => link.attributes('href')?.includes('/management?'))).toBe(true)
    wrapper.unmount()
  })
  it('null不是0，完整快照保扩展原文、零分配与分开的关系历史', async () => {
    const wrapper = mount(CentralPayrollDetailScreen, { global: { components, stubs } })
    await flushPromises()
    const totals = wrapper.get('[aria-label="工资金额与状态"]')
    expect(totals.text()).toContain('实际发放未记录')
    expect(totals.text()).toContain('核算应发¥0.00')
    expect(totals.text()).toContain('100%')
    expect(wrapper.get('[aria-label="发放快照证据"]').text()).toContain('futureEvidence')
    expect(wrapper.get('[aria-label="工资明细"]').text()).toContain('快照原姓名')
    expect(wrapper.get('[aria-label="工资明细"]').text()).not.toContain('当前关系姓名')
    expect(wrapper.get('[aria-label="收款分配"]').text()).toContain('¥0.00')
    expect(wrapper.get('[aria-label="原关系历史"]').text()).toContain('已删除')
    expect(wrapper.get('[aria-label="原关系历史"]').text()).toContain('100')
    expect(wrapper.get('[aria-label="迁入工资原始记录"]').text()).toContain('完整原列')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['刷新'])
    wrapper.unmount()
  })
  it.each(['missing', 'invalid', 'partial'] as const)('b与%s快照只呈现保存信息，不用原表100替代缺失实发', async (state) => {
    const value = payrollDetailFixture()
    value.statement.snapshot = { state, raw: state === 'missing' ? null : '{破损原文', originalRaw: null, data: null, issues: ['原快照不完整'] }
    value.statement.formatFamily = 'B'
    value.statement.recordKind = 'isolated'
    value.statement.lines = []
    detailRead.mockResolvedValue(value)
    const wrapper = mount(CentralPayrollDetailScreen, { global: { components, stubs } })
    await flushPromises()
    expect(wrapper.get('[aria-label="隔离工资历史"]').text()).toContain('退役')
    expect(wrapper.get('[aria-label="工资金额与状态"]').text()).toContain('实际发放未记录')
    expect(wrapper.get('[aria-label="工资明细"]').text()).not.toContain('后来删除分项')
    expect(wrapper.findAll('button').some(button => /导出|打印|发放|核对/.test(button.text()))).toBe(false)
    wrapper.unmount()
  })
  it('项目没有工资单也能查看独立来源，签工确认筛选不误用工资状态', async () => {
    route.path = '/subcontract/payroll/sources'
    route.query = { origin: 'real', project: 'source-only', month: '2026-08', status: 'released', dayworkStatus: 'confirmed', tab: 'daywork' }
    listRead.mockResolvedValue({ ...payrollListFixture(), rows: [] })
    const wrapper = mount(CentralPayrollSourcesScreen, { global: { components, stubs } })
    await flushPromises()
    expect(sourceRead).toHaveBeenCalledWith({ origin: 'real', includeDemo: false, projectId: 'source-only', month: '2026-08', crewId: undefined })
    expect(wrapper.get('[aria-label="独立签工记录"]').text()).toContain('尚未领用签工')
    expect(wrapper.get('[aria-label="独立签工记录"] [data-ui="status-tag"]').attributes('data-tone')).toBe('ok')
    expect(wrapper.text()).toContain('只有独立来源的项目')
    const labels = wrapper.findAll('label')
    expect(labels.find(label => label.text().startsWith('签工确认状态'))?.get('select').element.value).toBe('confirmed')
    wrapper.unmount()
  })
  it('来源页未指定项目不默认首项，失效深链报错不回本地', async () => {
    route.path = '/subcontract/payroll/sources'
    const wrapper = mount(CentralPayrollSourcesScreen, { global: { components, stubs } })
    await flushPromises()
    expect(sourceRead).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择项目')
    sourceRead.mockRejectedValue(new Error('指定来源项目不存在'))
    route.query = { origin: 'real', project: 'not-found' }
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('不存在')
    expect(router.replace).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="工资配置"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('真实路由A到B，A迟到失败不覆盖B；同目标失权限清除旧资料', async () => {
    let rejectOld: (error: Error) => void = () => {}
    detailRead.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectOld = reject
    }))
    const wrapper = mount(CentralPayrollDetailScreen, { global: { components, stubs } })
    route.params.id = 'wage-b'
    detailRead.mockResolvedValue(payrollDetailFixture('wage-b'))
    await flushPromises()
    rejectOld(new Error('旧A失败'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧A失败')
    expect(wrapper.get('[aria-label="工资金额与状态"]').exists()).toBe(true)
    detailRead.mockRejectedValue(new Error('无工资查看权限'))
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('无工资查看权限')
    expect(wrapper.find('[aria-label="工资金额与状态"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('keepAlive切走后旧结果不回填，重新激活能刷新且不锁住加载状态', async () => {
    let finishOld: (read: ReturnType<typeof payrollDetailFixture>) => void = () => {}
    detailRead.mockImplementationOnce(() => new Promise((resolve) => {
      finishOld = resolve
    }))
    const show = shallowRef(true)
    const other = defineComponent({ render: () => h('p', '其他页签') })
    const host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => h(show.value ? CentralPayrollDetailScreen : other) }) })
    const wrapper = mount(host, { global: { components, stubs } })
    show.value = false
    await flushPromises()
    finishOld(payrollDetailFixture())
    await flushPromises()
    detailRead.mockResolvedValue(payrollDetailFixture())
    show.value = true
    await flushPromises()
    expect(detailRead).toHaveBeenCalledTimes(2)
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('正在读取')
    wrapper.unmount()
  })
  it('已缓存台账响应真实query筛选变化；建单深链仅显示停用说明', async () => {
    const wrapper = mount(CentralPayrollScreen, { global: { components, stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('快照原姓名')
    route.query = { origin: 'real', status: 'draft' }
    await flushPromises()
    expect(wrapper.text()).not.toContain('快照原姓名')
    route.query = { origin: 'real', status: 'confirmed' }
    await flushPromises()
    expect(wrapper.text()).toContain('快照原姓名')
    expect(wrapper.find('[aria-label="工资状态，已选 0 项"]').exists()).toBe(true)
    wrapper.unmount()
    listRead.mockClear()
    const blocked = mount(CentralPayrollUnavailableScreen, { global: { components, stubs } })
    expect(blocked.text()).toContain('工资建单暂未开放')
    expect(listRead).not.toHaveBeenCalled()
    expect(blocked.find('input').exists()).toBe(false)
    blocked.unmount()
  })
  it('多个工资状态同字段OR、班组跨字段AND，选A后B仍可改选', async () => {
    const value = payrollListFixture()
    value.rows.push({ ...payrollDetailFixture('wage-b').statement, status: 'checked', crewId: 'crew-b', crewName: '另一班组', leaderName: '另一负责人' })
    listRead.mockResolvedValue(value)
    route.query = { origin: 'real', status: '["checked","released"]', crew: 'crew-a' }
    const wrapper = mount(CentralPayrollScreen, { global: { components, stubs } })
    await flushPromises()
    expect(wrapper.get('[aria-label="工资只读台账"]').text()).toContain('快照原姓名')
    expect(wrapper.get('[aria-label="工资只读台账"]').text()).not.toContain('另一负责人')
    expect(wrapper.find('option[value="crew-b"]').text()).toBe('另一班组')
    expect(wrapper.get('[aria-label="工资只读台账"] [data-ui="status-tag"]').attributes('data-tone')).toBe('ok')
    expect(listRead).toHaveBeenLastCalledWith({ origin: 'real', includeDemo: false })
    route.query = { ...route.query, crew: 'crew-b' }
    await flushPromises()
    expect(wrapper.get('[aria-label="工资只读台账"]').text()).toContain('另一负责人')
    expect(wrapper.get('[aria-label="工资只读台账"]').text()).not.toContain('快照原姓名')
    expect(wrapper.get('[aria-label="工资只读台账"] [data-ui="status-tag"]').attributes('data-tone')).toBe('brand')
    wrapper.unmount()
  })
  it('只有工资头与月份锁也提供两班组来源候选，缺配置考勤签工不隐藏另一班组', async () => {
    const list = payrollListFixture()
    list.rows.push({ ...payrollDetailFixture('wage-b').statement, crewId: 'crew-b', crewName: '仅有月锁的另一班组' })
    listRead.mockResolvedValue(list)
    sourceRead.mockImplementation(query => Promise.resolve({ ...payrollSourcesFixture(query.projectId), configs: [], attendance: [], daywork: [] }))
    route.path = '/subcontract/payroll/sources'
    route.query = { origin: 'real', project: 'project-a', month: '2026-08', crew: 'crew-a', tab: 'locks' }
    const wrapper = mount(CentralPayrollSourcesScreen, { global: { components, stubs } })
    await flushPromises()
    expect(wrapper.find('option[value="crew-b"]').text()).toBe('仅有月锁的另一班组')
    route.query = { ...route.query, crew: 'crew-b' }
    await flushPromises()
    expect(sourceRead).toHaveBeenLastCalledWith({ origin: 'real', includeDemo: false, projectId: 'project-a', month: '2026-08', crewId: 'crew-b' })
    wrapper.unmount()
  })
})
