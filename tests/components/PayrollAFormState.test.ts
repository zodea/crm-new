import type { PayrollAFormInput, PayrollAFormRead, PayrollAPending } from '~/lib/payroll/central-a-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import { usePayrollAForm } from '~/composables/usePayrollAForm'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const route = reactive({ params: { id: 'wage-a' as string | undefined }, path: '/subcontract/payroll/form/wage-a', fullPath: '/subcontract/payroll/form/wage-a?origin=real', query: { origin: 'real' } as Record<string, string> })
const load = vi.fn()
const save = vi.fn()
const recover = vi.fn()
const confirm = vi.fn()
const close = vi.fn()
const push = vi.fn()
const pending = shallowRef<PayrollAPending | null>(null)
const guards = new Map<string, () => Promise<boolean>>()
const values: ReturnType<typeof usePayrollAForm>[] = []
function read(id: string | null = 'wage-a', version = 'v1', draftKey: string | null = null): PayrollAFormRead {
  const known = { value: 300, knownValue: 300, state: 'known' as const, reasons: [] }
  return { context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: version, capabilities: ['payroll:read', 'payroll:write'], readonly: false }, statementId: id, draftKey, status: id ? 'draft' : 'new', needsRecheck: false, paymentSourceVersion: 'paid-v1', draft: { projectId: 'project', month: '2026-09', periodKind: 'monthly', crewId: null, leaderWorkerId: 'worker', memberWorkerIds: ['worker'], payRatio: null, note: '' }, options: { projects: [], crews: [], workers: [] }, members: [], facts: [], lines: [], prices: [], ratioDefault: { value: null, source: 'missing', statementId: null, configId: null, sourceVersion: null }, totals: { workAmount: known, cumulativeAmount: known, previouslyPaid: known, grossAmount: known }, blockers: [], eligibility: { canSaveDraft: true, canCheck: false, canRelease: false, canOutput: false, reasons: [] } }
}
const Harness = defineComponent({ setup() {
  const ui = usePayrollAForm()
  values.push(ui)
  return () => h('div', [h('input', { 'aria-label': '备注', 'value': ui.draft.value.note, 'onInput': (event: Event) => ui.change({ note: (event.target as HTMLInputElement).value }) }), h('button', { disabled: !ui.canSave.value, onClick: ui.save }, '保存'), h('button', { disabled: ui.busy.value, onClick: () => ui.load() }, '读取'), h('button', { disabled: ui.busy.value, onClick: ui.recover }, '核对原提交')])
} })
beforeEach(() => {
  vi.clearAllMocks()
  values.length = 0
  guards.clear()
  pending.value = null
  route.params.id = 'wage-a'
  route.path = '/subcontract/payroll/form/wage-a'
  route.fullPath = `${route.path}?origin=real`
  route.query = { origin: 'real' }
  load.mockImplementation(async (_query, input: PayrollAFormInput) => read(input.statementId, 'v1', input.draftKey ?? null))
  save.mockImplementation(async (value: PayrollAFormRead, draft: PayrollAFormRead['draft']) => {
    pending.value = { state: 'awaiting-read', command: { ...value.context, requiredCapability: 'payroll:write', commandId: 'cmd', projectId: 'project', statementId: value.statementId, draftKey: value.draftKey, configScope: null, action: { kind: 'save-a-draft', draft } } }
    return { statementId: 'wage-a', projectId: 'project', commandId: 'cmd', outcome: 'saved' }
  })
  confirm.mockResolvedValue(false)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn().mockResolvedValue(undefined) }))
  vi.stubGlobal('usePayrollStore', () => ({ loadAForm: load, saveADraft: save, recoverA: recover, acknowledgeA: vi.fn(() => pending.value = null), getAPending: (value: PayrollAFormRead) => pending.value && pending.value.command.statementId === value.statementId && pending.value.command.draftKey === value.draftKey ? pending.value : null }))
  vi.stubGlobal('useTabsStore', () => ({ close, registerCloseGuard: (key: string, guard: () => Promise<boolean>) => {
    guards.set(key, guard)
    return () => guards.delete(key)
  } }))
  vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn() }))
  vi.stubGlobal('useEventListener', vi.fn())
})
describe('中央 A 独立草稿', () => {
  it('新建未手填比例可采用明确建议，主动清空后核对仍保null', async () => {
    route.params.id = undefined
    route.path = '/subcontract/payroll/new'
    route.fullPath = `${route.path}?origin=real&draftKey=draft-a`
    route.query = { origin: 'real', draftKey: 'draft-a' }
    load.mockImplementation(async (_query, input: PayrollAFormInput) => ({ ...read(null, 'v1', 'draft-a'), draft: { ...read().draft, ...input.draft, payRatio: input.draft?.payRatio === undefined ? 0.75 : input.draft.payRatio } }))
    const wrapper = mount(Harness)
    await flushPromises()
    await values[0]!.load(true)
    expect(values[0]!.draft.value.payRatio).toBe(0.75)
    values[0]!.change({ payRatio: null })
    await values[0]!.load(true)
    expect(load.mock.calls.at(-1)?.[1].draft.payRatio).toBeNull()
    expect(values[0]!.draft.value.payRatio).toBeNull()
    wrapper.unmount()
  })
  it('恢复读取发现无写权限时保留原稿和基准，但禁止保存', async () => {
    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.get('input').setValue('原稿保留')
    const revoked = read('wage-a', 'v2')
    revoked.context.capabilities = ['payroll:read']
    revoked.context.readonly = true
    load.mockResolvedValue(revoked)
    await values[0]!.load()
    expect(values[0]!.draft.value.note).toBe('原稿保留')
    expect(values[0]!.matchingRead.value?.context.sourceVersion).toBe('v1')
    expect(values[0]!.canSave.value).toBe(false)
    await values[0]!.save()
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('旁路读取不抬旧稿基准，成功才清原页签，null比例仍保留', async () => {
    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.get('input').setValue('原输入')
    load.mockResolvedValue(read('wage-a', 'v2'))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('原输入')
    expect(values[0]!.matchingRead.value?.context.sourceVersion).toBe('v1')
    expect(values[0]!.latest.value?.context.sourceVersion).toBe('v2')
    expect(await guards.get(route.path)!()).toBe(false)
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ sourceVersion: 'v1' }) }), expect.objectContaining({ note: '原输入', payRatio: null }))
    expect(close).toHaveBeenCalledWith('/subcontract/payroll/form/wage-a')
    wrapper.unmount()
  })
  it('真实route切换新建draftKey，B失败不得保存A', async () => {
    route.params.id = undefined
    route.path = '/subcontract/payroll/new'
    route.fullPath = `${route.path}?origin=real&draftKey=draft-a`
    route.query = { origin: 'real', draftKey: 'draft-a' }
    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.get('input').setValue('A草稿')
    load.mockRejectedValueOnce(new Error('B读取失败'))
    route.query = { origin: 'real', draftKey: 'draft-b' }
    route.fullPath = `${route.path}?origin=real&draftKey=draft-b`
    await flushPromises()
    expect(values[0]!.matchingRead.value).toBeNull()
    await values[0]!.save()
    expect(save).not.toHaveBeenCalled()
    route.query = { origin: 'real', draftKey: 'draft-a' }
    route.fullPath = `${route.path}?origin=real&draftKey=draft-a`
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('A草稿')
    wrapper.unmount()
  })
  it('keepAlive停用后迟到失败不锁死原命令恢复', async () => {
    let reject!: (error: Error) => void
    save.mockImplementation((value: PayrollAFormRead) => {
      pending.value = { state: 'unknown', command: { commandId: 'original-key', workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: value.context.sourceVersion, requiredCapability: 'payroll:write', projectId: 'project', statementId: 'wage-a', draftKey: null, configScope: null, action: { kind: 'save-a-draft', draft: { ...values[0]!.draft.value } } } }
      return new Promise((_resolve, rejectPromise) => reject = rejectPromise)
    })
    const visible = shallowRef(true)
    const Other = defineComponent({ render: () => h('p', '其它页') })
    const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }))
    await flushPromises()
    await wrapper.get('input').setValue('保留输入')
    await wrapper.findAll('button')[0]!.trigger('click')
    visible.value = false
    await flushPromises()
    reject(new Error('回执丢失'))
    await flushPromises()
    visible.value = true
    await flushPromises()
    expect(values[0]!.busy.value).toBe(false)
    expect(wrapper.get('input').element.value).toBe('保留输入')
    recover.mockResolvedValue({ statementId: 'wage-a', projectId: 'project', outcome: 'saved' })
    await wrapper.findAll('button')[2]!.trigger('click')
    await flushPromises()
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ commandId: 'original-key', sourceVersion: 'v1' }) }))
    wrapper.unmount()
  })
})
