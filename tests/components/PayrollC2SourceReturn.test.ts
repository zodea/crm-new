import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import PayrollC2SourceReturn from '~/components/payroll/PayrollC2SourceReturn.vue'
import { c2Form, dayworkForm } from '../helpers/payroll-c2-ui'

const read = vi.fn()
const matrix = vi.fn()
const route = reactive({ query: {} as Record<string, string> })
beforeEach(() => {
  vi.clearAllMocks()
  route.query = { payrollReturnTo: '/subcontract/payroll/wage?origin=real&format=C2&month=2026-08', payrollSourceKind: 'daywork', payrollSourceId: 'r', payrollProject: 'p', payrollFormat: 'C2' }
  read.mockResolvedValue(c2Form())
  matrix.mockResolvedValue(dayworkForm())
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('usePayrollC2Store', () => ({ loadC2Form: read }))
  vi.stubGlobal('useDayworkCentralStore', () => ({ loadDayworkForm: matrix }))
})
describe('c2 来源返回验证', () => {
  it('未保存新草稿凭已授权候选与原日期记录核实返回，不假造已存工资成员', async () => {
    const back = '/subcontract/payroll/new?origin=real&format=C2&draftKey=original-draft&project=p&month=2026-08&crew=c'
    route.query = { ...route.query, payrollReturnTo: back, month: '2026-08', crew: 'c', worker: 'w', workDate: '2026-08-01', record: 'r' }
    read.mockResolvedValue({ ...c2Form(), statementId: null, draftKey: 'original-draft', status: 'new', draft: { projectId: 'p' }, members: [], facts: [] })
    const view = mount(PayrollC2SourceReturn, { props: { kind: 'daywork', sourceId: 'r', origin: 'real', projectId: 'p' }, global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
    await flushPromises()
    expect(view.find('a').exists()).toBe(true)
    expect(view.get('a').attributes('href')).toBe(back)
    expect(matrix).toHaveBeenCalledWith({ origin: 'real' }, { recordId: 'r' })
    route.query.workDate = '2026-08-02'
    await flushPromises()
    expect(view.find('a').exists()).toBe(false)
    view.unmount()
  })
  it('实际原签工关系成立才返回原工资，不借同项目其他记录', async () => {
    const view = mount(PayrollC2SourceReturn, { props: { kind: 'daywork', sourceId: 'r', origin: 'real', projectId: 'p' }, global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
    await flushPromises()
    expect(view.get('a').attributes('href')).toContain('/subcontract/payroll/wage?')
    await view.setProps({ sourceId: 'another' })
    await flushPromises()
    expect(view.find('a').exists()).toBe(false)
    expect(view.get('[role="alert"]').text()).toContain('身份不一致')
    view.unmount()
  })
})
