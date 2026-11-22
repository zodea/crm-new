import type { PayrollC2Pending } from '~/lib/payroll/central-c2-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, ref, shallowRef } from 'vue'
import CrewWorkerCentralDetailScreen from '~/components/crew-worker/CrewWorkerCentralDetailScreen.vue'
import { usePayrollC2Statement } from '~/composables/usePayrollC2Statement'
import { usePayrollDayworkForm } from '~/composables/usePayrollDayworkForm'
import PayrollDayworkConfirmDialog from '~/pages/subcontract/daywork/_components/PayrollDayworkConfirmDialog.vue'
import { c2Form, c2Frozen, dayworkForm } from '../helpers/payroll-c2-ui'

const load = vi.fn()
const save = vi.fn()
const workerStore = vi.hoisted(() => ({
  workerDetailState: { kind: 'ready', data: { dataOrigin: 'real', worker: { id: 'w', name: '原工人', trade: '', phone: '', projectStatus: '' }, capabilities: [], summary: { projectCount: 0, assignedUnitCount: 0, completedStageCount: 0, attendanceDays: 0, attendanceHours: 0, overtimeHours: 0, confirmedDayworkUnits: 0, releasedStatementCount: 0, knownAllocatedAmount: '0.00', missingAllocationCount: 0, penaltyAmount: '0.00' } } },
  loadWorkerDetail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('~/stores/crew-worker-read', () => ({ useCrewWorkerReadStore: () => workerStore }))
const route = { params: { id: 'r' }, path: '/subcontract/daywork/form/r', fullPath: '/subcontract/daywork/form/r?origin=real', query: { origin: 'real' } }
const Harness = defineComponent({
  setup() {
    const ui = usePayrollDayworkForm()
    return () => h('div', [
      h('input', { disabled: !ui.editable.value, value: ui.draft.value.workContent, onInput: (event: Event) => ui.change({ workContent: (event.target as HTMLInputElement).value }) }),
      h('p', { 'data-test': 'basis' }, ui.matching.value?.context.sourceVersion),
      h('p', { 'data-test': 'review' }, String(ui.needsReview.value)),
      h('button', { 'data-test': 'reload', 'onClick': ui.load }, '按当前资料重新核对本稿'),
      h('button', { 'data-test': 'save', 'disabled': !ui.canSubmit.value, 'onClick': () => ui.save('confirmed') }, '保存并确认'),
    ])
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  load.mockResolvedValue(dayworkForm())
  save.mockRejectedValue(new Error('读取依据变化，本次命令明确未应用'))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }))
  vi.stubGlobal('useDayworkCentralStore', () => ({ loadDayworkForm: load, saveDaywork: save, getDayworkPending: () => null }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: vi.fn().mockResolvedValue(false) }))
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it('独立规格反例：重新读取已撤写权的同一签工，保留本地草稿但停止可编辑与提交', async () => {
  const view = mount(Harness)
  try {
    await flushPromises()
    await view.get('input').setValue('尚未保存的现场备注')
    const latest = dayworkForm()
    latest.context = { ...latest.context, sourceVersion: 'readonly-v2', readonly: true, capabilities: ['payroll:read'] }
    latest.eligibility = { canEdit: false, canConfirm: false, reasons: ['当前身份只能阅读签工'] }
    load.mockResolvedValue(latest)
    await view.get('[data-test=reload]').trigger('click')
    await flushPromises()
    expect((view.get('input').element as HTMLInputElement).value).toBe('尚未保存的现场备注')
    expect(view.get('input').attributes('disabled')).toBeDefined()
    await view.get('[data-test=save]').trigger('click')
    expect(save).not.toHaveBeenCalled()
  }
  finally { view.unmount() }
})

it('独立规格反例：明确未应用后显式按当前资料重新核对本稿，使用新依据提交且不清理原稿', async () => {
  const view = mount(Harness)
  try {
    await flushPromises()
    await view.get('input').setValue('我要保留的本次输入')
    await view.get('[data-test=save]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(1)
    const latest = dayworkForm()
    latest.context = { ...latest.context, sourceVersion: 'current-v2' }
    load.mockResolvedValue(latest)
    await view.get('[data-test=reload]').trigger('click')
    await flushPromises()
    expect((view.get('input').element as HTMLInputElement).value).toBe('我要保留的本次输入')
    await view.get('[data-test=save]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![0].context.sourceVersion).toBe('current-v2')
    expect(save.mock.calls[1]![1].workContent).toBe('我要保留的本次输入')
  }
  finally { view.unmount() }
})

it('独立规格复验：恢复原页签只刷新资格，保旧稿依据直到用户明确重新核对', async () => {
  const shown = ref(true)
  const Parent = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(Harness) : null }) })
  const view = mount(Parent)
  try {
    await flushPromises()
    await view.get('input').setValue('离开来源前的原稿')
    shown.value = false
    await flushPromises()
    const latest = dayworkForm()
    latest.context = { ...latest.context, sourceVersion: 'other-window-v2' }
    load.mockResolvedValue(latest)
    shown.value = true
    await flushPromises()
    expect((view.get('input').element as HTMLInputElement).value).toBe('离开来源前的原稿')
    expect(view.get('[data-test=basis]').text()).toBe('v1')
    expect(view.get('[data-test=review]').text()).toBe('true')
    expect(view.get('[data-test=save]').attributes('disabled')).toBeDefined()
    await view.get('[data-test=reload]').trigger('click')
    await flushPromises()
    expect(view.get('[data-test=basis]').text()).toBe('other-window-v2')
    expect((view.get('input').element as HTMLInputElement).value).toBe('离开来源前的原稿')
  }
  finally { view.unmount() }
})

it('独立规格复验：确认弹窗明确未应用后按当前记录重核，保留证明和日期并采用新依据', async () => {
  const read = dayworkForm()
  read.eligibility = { canEdit: true, canConfirm: true, reasons: [] }
  const confirm = vi.fn().mockRejectedValue(new Error('原签工已更新，本次确认明确未应用'))
  vi.stubGlobal('useDayworkCentralStore', () => ({ loadDayworkForm: load, confirmDaywork: confirm, getDayworkPending: () => null }))
  const view = mount(PayrollDayworkConfirmDialog, { props: { read, open: true }, attachTo: document.body })
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!
  const input = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  try {
    await flushPromises()
    input('确认签工证明人').value = '尚未保存的现场证明'
    input('确认签工证明人').dispatchEvent(new Event('input', { bubbles: true }))
    input('人工确认日期').value = '2026-08-04'
    input('人工确认日期').dispatchEvent(new Event('input', { bubbles: true }))
    button('确认签工').click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    const latest = dayworkForm()
    latest.context = { ...latest.context, sourceVersion: 'confirm-current-v2' }
    latest.eligibility = { canEdit: true, canConfirm: true, reasons: [] }
    latest.record = { ...latest.record!, workContent: '另一窗口补充的真实施工内容' }
    load.mockResolvedValue(latest)
    button('按当前记录重新核对证明信息').click()
    await flushPromises()
    expect(input('确认签工证明人').value).toBe('尚未保存的现场证明')
    expect(input('人工确认日期').value).toBe('2026-08-04')
    expect(document.body.textContent).toContain('另一窗口补充的真实施工内容')
    button('确认签工').click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[1]![0].context.sourceVersion).toBe('confirm-current-v2')
    expect(confirm.mock.calls[1]![1]).toEqual({ witness: '尚未保存的现场证明', confirmedOn: '2026-08-04' })
    expect(read.context.sourceVersion).toBe('v1')
    const readonly = { ...latest, context: { ...latest.context, readonly: true, capabilities: ['payroll:read'] }, eligibility: { canEdit: false, canConfirm: false, reasons: ['已撤销写入权限'] } }
    load.mockResolvedValue(readonly)
    button('按当前记录重新核对证明信息').click()
    await flushPromises()
    expect(button('确认签工').disabled).toBe(true)
    expect(input('确认签工证明人').value).toBe('尚未保存的现场证明')
  }
  finally { view.unmount() }
})

it.each(['checked', 'released'] as const)('独立规格复验：原需重核提交后当前已 %s，呈现后续变化并保留完整实发输入', async (status) => {
  const release = { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }
  const current = { ...c2Form(), status }
  const operation = shallowRef<PayrollC2Pending | null>({ state: 'awaiting-read', command: { commandId: 'original-release', workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'old-check-v1', requiredCapability: 'payroll:write', projectId: 'p', statementId: 'wage', draftKey: null, configScope: null, configId: null, action: { kind: 'release-c2', release } } })
  const result = { commandId: 'original-release', projectId: 'p', statementId: 'wage', configId: 'config', dayworkRecordIds: ['r', 'half'], dayworkLinkIds: ['link', 'link-half'], sourceVersion: 'old-needs-recheck-v2', outcome: 'needs-recheck', logIds: ['old-change'] }
  const ack = vi.fn(() => {
    operation.value = null
  })
  vi.stubGlobal('usePayrollC2Store', () => ({ loadC2Form: vi.fn().mockResolvedValue(current), loadC2Output: vi.fn().mockResolvedValue({ context: current.context, statementId: 'wage', state: 'available', document: c2Frozen() }), getC2Pending: () => operation.value, recoverC2: vi.fn().mockResolvedValue(result), acknowledgeC2: ack }))
  const Screen = defineComponent({ setup() {
    const ui = usePayrollC2Statement({ id: () => 'wage', origin: () => 'real', changed: vi.fn() })
    return () => h('div', [h('button', { onClick: ui.recover }, '恢复原提交'), h('p', { 'data-test': 'notice' }, ui.error.value), h('pre', JSON.stringify(ui.releaseDraft.value)), h('p', { 'data-test': 'write' }, String(ui.writable.value))])
  } })
  const view = mount(Screen)
  try {
    await flushPromises()
    await view.get('button').trigger('click')
    await flushPromises()
    expect(ack).toHaveBeenCalledTimes(1)
    expect(JSON.parse(view.get('pre').text())).toEqual(release)
    expect(view.get('[data-test=notice]').text()).toContain('原发放提交因签工或主体配置变化未执行')
    expect(view.get('[data-test=notice]').text()).toContain(status === 'checked' ? '当前记录随后已重新核对' : '当前记录随后已发放')
    expect(view.get('[data-test=notice]').text()).not.toContain('当前记录仍需重核')
    if (status === 'released')
      expect(view.get('[data-test=write]').text()).toBe('false')
  }
  finally { view.unmount() }
})

it('独立规格回归：C1 工资来源进入工人详情，只显示 C1 原工资返回，不误挂 A 分支', async () => {
  vi.stubGlobal('useRoute', () => ({ query: { payrollFormat: 'C1', payrollReturnTo: '/subcontract/payroll/wage?origin=real&format=C1' }, fullPath: '/base/worker/w?origin=real' }))
  vi.stubGlobal('useTabTitle', vi.fn())
  const shell = defineComponent({ setup: (_, { slots }) => () => h('main', slots.summary?.()) })
  const tag = (format: string) => defineComponent({ setup: () => () => h('p', { 'data-return': format }, `${format} 原工资返回`) })
  const view = mount(CrewWorkerCentralDetailScreen, { props: { kind: 'worker', id: 'w', origin: 'real', includeDemo: false }, global: { stubs: { EntityDetailShell: shell, PayrollC1SourceReturn: tag('C1'), PayrollC2SourceReturn: tag('C2'), PayrollASourceReturn: tag('A'), MetricGrid: true, Metric: true, NuxtLink: true, SectionHeader: true, CrewMemberSection: true, EntityLink: true } } })
  try {
    await flushPromises()
    expect(view.find('[data-return=C1]').exists()).toBe(true)
    expect(view.find('[data-return=A]').exists()).toBe(false)
    expect(view.find('[data-return=C2]').exists()).toBe(false)
  }
  finally { view.unmount() }
})
