import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import PayrollC1SourceReturn from '~/components/payroll/PayrollC1SourceReturn.vue'
import PayrollC2SourceReturn from '~/components/payroll/PayrollC2SourceReturn.vue'
import { c1Form, c1Matrix } from '../helpers/payroll-c1-ui'
import { c2Form, dayworkForm } from '../helpers/payroll-c2-ui'

const read = vi.fn()
const matrix = vi.fn()
const route = reactive({ query: {} as Record<string, string> })
const link = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } }

describe.each([
  {
    format: 'C1',
    kind: 'attendance',
    sourceName: '考勤',
    Screen: PayrollC1SourceReturn,
    form: c1Form,
    stub: () => {
      matrix.mockResolvedValue(c1Matrix())
      vi.stubGlobal('usePayrollC1Store', () => ({ loadC1Form: read }))
      vi.stubGlobal('useAttendanceCentralStore', () => ({ loadMatrix: matrix }))
    },
    sourceQuery: { projectId: 'p', month: '2026-08', crewId: 'c' },
  },
  {
    format: 'C2',
    kind: 'daywork',
    sourceName: '签工',
    Screen: PayrollC2SourceReturn,
    form: c2Form,
    stub: () => {
      matrix.mockResolvedValue(dayworkForm())
      vi.stubGlobal('usePayrollC2Store', () => ({ loadC2Form: read }))
      vi.stubGlobal('useDayworkCentralStore', () => ({ loadDayworkForm: matrix }))
    },
    sourceQuery: { recordId: 'r' },
  },
] as const)('$format 来源返回验证', ({ format, kind, sourceName, Screen, form, stub, sourceQuery }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.query = { payrollReturnTo: `/subcontract/payroll/wage?origin=real&format=${format}&month=2026-08`, payrollSourceKind: kind, payrollSourceId: 'r', payrollProject: 'p', payrollFormat: format }
    read.mockResolvedValue(form())
    vi.stubGlobal('useRoute', () => route)
    stub()
  })
  it('未保存新草稿凭已授权候选与原日期记录核实返回，不假造已存工资成员', async () => {
    const back = `/subcontract/payroll/new?origin=real&format=${format}&draftKey=original-draft&project=p&month=2026-08&crew=c`
    route.query = { ...route.query, payrollReturnTo: back, month: '2026-08', crew: 'c', worker: 'w', workDate: '2026-08-01', record: 'r' }
    read.mockResolvedValue({ ...form(), statementId: null, draftKey: 'original-draft', status: 'new', draft: { projectId: 'p' }, members: [], facts: [] })
    const view = mount(Screen, { props: { kind, sourceId: 'r', origin: 'real', projectId: 'p' }, global: link })
    await flushPromises()
    expect(view.find('a').exists()).toBe(true)
    expect(view.get('a').attributes('href')).toBe(back)
    expect(matrix).toHaveBeenCalledWith({ origin: 'real' }, sourceQuery)
    route.query.workDate = '2026-08-02'
    await flushPromises()
    expect(view.find('a').exists()).toBe(false)
    view.unmount()
  })
  it(`实际原${sourceName}关系成立才返回原工资，不借同项目其他记录`, async () => {
    const view = mount(Screen, { props: { kind, sourceId: 'r', origin: 'real', projectId: 'p' }, global: link })
    await flushPromises()
    expect(view.get('a').attributes('href')).toContain('/subcontract/payroll/wage?')
    await view.setProps({ sourceId: 'another' })
    await flushPromises()
    expect(view.find('a').exists()).toBe(false)
    expect(view.get('[role="alert"]').text()).toContain('身份不一致')
    view.unmount()
  })
})
