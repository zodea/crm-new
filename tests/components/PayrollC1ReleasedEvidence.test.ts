import type { PayrollC1OutputRead } from '~/lib/payroll/central-c1-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PayrollC1StatementWorkspace from '~/components/payroll/PayrollC1StatementWorkspace.vue'
import { c1Form, c1Frozen } from '../helpers/payroll-c1-ui'

const load = vi.fn()
const output = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  load.mockResolvedValue({ ...c1Form(), status: 'released', needsRecheck: true, eligibility: { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: false, reasons: ['请选择负责人'] } })
  vi.stubGlobal('usePayrollC1Store', () => ({ loadC1Form: load, loadC1Output: output, getC1Pending: () => null }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn() }))
})
afterEach(() => vi.unstubAllGlobals())
function open() {
  return mount(PayrollC1StatementWorkspace, { props: { statementId: 'wage', origin: 'real', returnTo: '/subcontract/payroll/wage?origin=real' }, global: { stubs: {
    PayrollACommandState: true,
    PayrollC1SourceReview: true,
    PayrollC1FrozenPrint: true,
    PayrollC1ReleaseDialog: true,
    SectionHeader: { props: ['title'], template: '<h2>{{ title }}</h2>' },
    NuxtLink: { template: '<a><slot /></a>' },
    KitButton: { template: '<button><slot /></button>' },
  } } })
}
it('旧已发头缺配对证据只说明原记录只读，不宣告完整冻结或显示新建重核要求', async () => {
  output.mockResolvedValue({ context: c1Form().context, statementId: 'wage', state: 'unavailable', reasons: ['旧 C1 未保留完整逐日来源或发放原文。'] })
  const view = open()
  await flushPromises()
  expect(view.text()).toContain('原记录标为已发放，本页只读；逐日来源或发放证据不完整，不能生成配对输出。')
  expect(view.text()).toContain('旧 C1 未保留完整逐日来源或发放原文。')
  expect(view.text()).not.toContain('本次工资与考勤已冻结')
  expect(view.text()).not.toContain('请选择负责人')
  expect(view.text()).not.toContain('本工资需要重新核对考勤')
  expect(view.findAll('button').map(button => button.text())).not.toContain('下载工资与考勤表')
  view.unmount()
})
it('已发状态本身不承诺冻结完整，真实输出核实可用后才显示配对成功', async () => {
  let resolve!: (value: PayrollC1OutputRead) => void
  output.mockReturnValue(new Promise<PayrollC1OutputRead>((done) => {
    resolve = done
  }))
  const view = open()
  await flushPromises()
  expect(view.text()).not.toContain('本次工资与考勤已冻结')
  resolve({ context: c1Form().context, statementId: 'wage', state: 'available', document: c1Frozen() })
  await flushPromises()
  expect(view.text()).toContain('本次工资与考勤已冻结，原全成员整月锁定。')
  expect(view.findAll('button').map(button => button.text())).toContain('下载工资与考勤表')
  expect(view.text()).not.toContain('请选择负责人')
  view.unmount()
})
