import type { PayrollC1OutputRead } from '~/lib/payroll/central-c1-contract'
import type { PayrollC2OutputRead } from '~/lib/payroll/central-c2-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PayrollC1StatementWorkspace from '~/components/payroll/PayrollC1StatementWorkspace.vue'
import PayrollC2StatementWorkspace from '~/components/payroll/PayrollC2StatementWorkspace.vue'
import { c1Form, c1Frozen } from '../helpers/payroll-c1-ui'
import { c2Form, c2Frozen } from '../helpers/payroll-c2-ui'

type OutputRead = PayrollC1OutputRead | PayrollC2OutputRead
const load = vi.fn()
const output = vi.fn()
afterEach(() => vi.unstubAllGlobals())

describe.each([
  { format: 'C1', source: '考勤', Workspace: PayrollC1StatementWorkspace, form: c1Form, frozen: c1Frozen, store: ['usePayrollC1Store', { loadC1Form: load, loadC1Output: output, getC1Pending: () => null }] },
  { format: 'C2', source: '签工', Workspace: PayrollC2StatementWorkspace, form: c2Form, frozen: c2Frozen, store: ['usePayrollC2Store', { loadC2Form: load, loadC2Output: output, getC2Pending: () => null }] },
] as const)('$format 已发工资的冻结证据', ({ format, source, Workspace, form, frozen, store: [storeName, store] }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    load.mockResolvedValue({ ...form(), status: 'released', needsRecheck: true, eligibility: { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: false, reasons: ['请选择负责人'] } })
    vi.stubGlobal(storeName, () => store)
    vi.stubGlobal('useKitUI', () => ({ success: vi.fn() }))
  })
  function open() {
    return mount(Workspace, { props: { statementId: 'wage', origin: 'real', returnTo: '/subcontract/payroll/wage?origin=real' }, global: { stubs: {
      PayrollACommandState: true,
      [`Payroll${format}SourceReview`]: true,
      [`Payroll${format}FrozenPrint`]: true,
      PayrollTierReleaseDialog: true,
      SectionHeader: { props: ['title'], template: '<h2>{{ title }}</h2>' },
      NuxtLink: { template: '<a><slot /></a>' },
      KitButton: { template: '<button><slot /></button>' },
    } } })
  }
  it('旧已发头缺配对证据只说明原记录只读，不宣告完整冻结或显示新建重核要求', async () => {
    output.mockResolvedValue({ context: form().context, statementId: 'wage', state: 'unavailable', reasons: [`旧 ${format} 未保留完整逐日来源或发放原文。`] })
    const view = open()
    await flushPromises()
    expect(view.text()).toContain('原记录标为已发放，本页只读；逐日来源或发放证据不完整，不能生成配对输出。')
    expect(view.text()).toContain(`旧 ${format} 未保留完整逐日来源或发放原文。`)
    expect(view.text()).not.toContain(`本次工资与${source}已冻结`)
    expect(view.text()).not.toContain('请选择负责人')
    expect(view.text()).not.toContain(`本工资需要重新核对${source}`)
    expect(view.findAll('button').map(button => button.text())).not.toContain(`下载工资与${source}表`)
    view.unmount()
  })
  it('已发状态本身不承诺冻结完整，真实输出核实可用后才显示配对成功', async () => {
    let resolve!: (value: OutputRead) => void
    output.mockReturnValue(new Promise<OutputRead>((done) => {
      resolve = done
    }))
    const view = open()
    await flushPromises()
    expect(view.text()).not.toContain(`本次工资与${source}已冻结`)
    resolve({ context: form().context, statementId: 'wage', state: 'available', document: frozen() } as OutputRead)
    await flushPromises()
    expect(view.text()).toContain(`本次工资与${source}已冻结，原全成员整月锁定。`)
    expect(view.findAll('button').map(button => button.text())).toContain(`下载工资与${source}表`)
    expect(view.text()).not.toContain('请选择负责人')
    view.unmount()
  })
})
