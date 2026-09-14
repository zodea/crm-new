import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import PayrollASourceReturn from '~/components/payroll/PayrollASourceReturn.vue'
import { feeFormRead, feeManagementBook } from '../helpers/payroll-fees-ui-fixture'

const route = reactive({ query: { origin: 'real', payrollReturnTo: '/subcontract/payroll/form/wage-a?origin=real', payrollSourceKind: 'quantity-unit', payrollSourceId: 'unit-a', payrollProject: 'project-a' } as Record<string, string> })
const form = vi.fn()
const list = vi.fn()
const context = { workspaceId: 'workspace', actorId: 'actor', origin: 'real', capabilities: ['payroll:read'], sourceVersion: 'v1', readonly: true }
const global = { components: { NuxtLink: defineComponent({ props: ['to'], setup: props => () => h('a', { href: props.to }, '返回原工资') }) } }
beforeEach(() => {
  vi.clearAllMocks()
  route.query = { origin: 'real', payrollReturnTo: '/subcontract/payroll/form/wage-a?origin=real', payrollSourceKind: 'quantity-unit', payrollSourceId: 'unit-a', payrollProject: 'project-a' }
  form.mockResolvedValue({ context, statementId: 'wage-a', draft: { projectId: 'project-a' }, facts: [{ unitId: 'unit-a' }], blockers: [] })
  list.mockResolvedValue({ context, projects: [{ id: 'project-a' }] })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('usePayrollStore', () => ({ loadAForm: form, loadRead: list }))
})
describe('工资来源页返回读取核验', () => {
  it('独立管理簿可从已证管理责任返回未完工户，不能借无关户放行', async () => {
    const read = feeFormRead()
    read.statementId = 'wage-a'
    read.draft.projectId = 'project-a'
    read.facts = []
    read.book = { bookPurpose: 'management', managementBookId: 'management-book' }
    const book = feeManagementBook()
    book.revision!.scope.assignments[0]!.cells[0]!.unitId = 'unit-a'
    read.fees!.management = { book: book.book, revision: book.revision! }
    form.mockResolvedValue(read)
    const wrapper = mount(PayrollASourceReturn, { props: { kind: 'quantity-unit', sourceId: 'unit-a', projectId: 'project-a', origin: 'real' }, global })
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toContain('/form/wage-a')
    route.query.payrollSourceId = 'other-unit'
    await wrapper.setProps({ sourceId: 'other-unit' })
    await flushPromises()
    expect(wrapper.find('a').exists()).toBe(false)
    wrapper.unmount()
  })
  it('已存工资需真实同户来源，失效不回默认工资', async () => {
    const wrapper = mount(PayrollASourceReturn, { props: { kind: 'quantity-unit', sourceId: 'unit-a', projectId: 'project-a', origin: 'real' }, global })
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toBe('/subcontract/payroll/form/wage-a?origin=real')
    form.mockResolvedValue({ context, statementId: 'wage-b', draft: { projectId: 'project-a' }, facts: [{ unitId: 'another-unit' }], blockers: [] })
    route.query.payrollReturnTo = '/subcontract/payroll/form/wage-b?origin=real'
    await flushPromises()
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('稳定关系')
    wrapper.unmount()
  })
  it('工资行已损坏时只接受服务证明的诊断入口，原户ID本身不能放行', async () => {
    const read = { context, statementId: 'wage-a', draft: { projectId: 'project-a' }, facts: [], blockers: [{ unitId: 'unit-a', source: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'quantity-unit', id: 'unit-a' }, filters: { projectId: 'project-a', dataOrigin: 'real' } } }] }
    form.mockResolvedValue(read)
    const wrapper = mount(PayrollASourceReturn, { props: { kind: 'quantity-unit', sourceId: 'unit-a', projectId: 'project-a', origin: 'real' }, global })
    await flushPromises()
    expect(wrapper.find('a').exists()).toBe(true)
    form.mockResolvedValue({ ...read, statementId: 'wage-b', blockers: [{ unitId: 'unit-a', source: null }] })
    route.query.payrollReturnTo = '/subcontract/payroll/form/wage-b?origin=real'
    await flushPromises()
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('稳定关系')
    wrapper.unmount()
  })
  it('新草稿只验证已授权源目标与项目，不伪造已存工资读取或执行命令', async () => {
    route.query.payrollReturnTo = '/subcontract/payroll/new?origin=real&draftKey=draft-a&project=project-a'
    form.mockResolvedValue({ context, statementId: null, draftKey: 'draft-a', options: { projects: [{ id: 'project-a' }] } })
    const wrapper = mount(PayrollASourceReturn, { props: { kind: 'quantity-unit', sourceId: 'unit-a', projectId: 'project-a', origin: 'real' }, global })
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toContain('draftKey=draft-a')
    expect(form).toHaveBeenCalledWith({ origin: 'real' }, { statementId: null, draftKey: 'draft-a', draft: { projectId: 'project-a' } })
    expect(list).not.toHaveBeenCalled()
    await wrapper.setProps({ projectId: 'other-project' })
    await flushPromises()
    expect(wrapper.find('a').exists()).toBe(false)
    wrapper.unmount()
  })
})
