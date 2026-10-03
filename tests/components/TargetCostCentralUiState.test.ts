import type { TargetCostFormRead, TargetCostPending } from '~/lib/target-cost/central-contract'
import { fireEvent, within } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import { useTargetCostForm } from '~/composables/useTargetCostForm'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const route = reactive({ params: { id: 'budget-a' as string | undefined }, path: '/project/target-cost/form/budget-a', fullPath: '/project/target-cost/form/budget-a?origin=real', query: { origin: 'real' } as Record<string, string> })
const loadForm = vi.fn()
const saveForm = vi.fn()
const recover = vi.fn()
const confirm = vi.fn()
const close = vi.fn()
const push = vi.fn()
const guards = new Map<string, () => Promise<boolean>>()
const pending = shallowRef<Record<string, TargetCostPending>>({})
function form(id = 'budget-a', version = 'v1'): TargetCostFormRead {
  return { context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: version, capabilities: ['target-cost:read', 'target-cost:write'] }, targetCostId: id, draftKey: null, draft: { id, name: id, projectId: 'project', contractRevenue: null, taxInclusiveTotal: 0, status: 'draft' }, deletedAt: null, projects: [{ id: 'project', name: '预算项目', code: 'P' }], projectOptionsStatus: 'available', files: [] }
}
const sessions: ReturnType<typeof useTargetCostForm>[] = []
const Harness = defineComponent({ setup() {
  const ui = useTargetCostForm()
  sessions.push(ui)
  return () => h('div', [
    h('form', { ref: ui.formElement }, [
      h('input', { 'aria-label': '预算版本名', 'data-field': 'name', 'disabled': !ui.editable.value, 'value': ui.draft.value.name ?? '', 'onInput': (event: Event) => ui.draft.value.name = (event.target as HTMLInputElement).value }),
      ui.editable.value ? h('input', { 'aria-label': '预算项目', 'data-field': 'projectId', 'value': ui.draft.value.projectId ?? '' }) : h('span', '预算项目暂不可编辑'),
    ]),
    h('output', { 'data-testid': 'read-version' }, ui.read.value?.context.sourceVersion),
    h('output', { 'data-testid': 'latest-version' }, ui.latest.value?.context.sourceVersion),
    h('output', { 'data-testid': 'error' }, ui.error.value),
    h('button', { disabled: ui.busy.value, onClick: () => ui.load(true) }, '核对'),
    h('button', { disabled: !ui.editable.value, onClick: () => ui.save('save') }, '保存'),
    h('button', { disabled: ui.busy.value, onClick: ui.recover }, '恢复原提交'),
  ])
} })

describe('中央预算版本头独立草稿', () => {
  it('同一新建路由更换draftKey后读取失败，不允许在B地址保存A稿', async () => {
    route.params.id = undefined
    route.path = '/project/target-cost/form'
    route.fullPath = '/project/target-cost/form?origin=real&draftKey=draft-a'
    route.query = { origin: 'real', draftKey: 'draft-a' }
    const value = { ...form(), targetCostId: null, draftKey: 'draft-a' }
    loadForm.mockResolvedValue(value)
    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.get('input').setValue('A独立新建稿')
    loadForm.mockRejectedValueOnce(new Error('B读取失败'))
    route.query = { origin: 'real', draftKey: 'draft-b' }
    route.fullPath = '/project/target-cost/form?origin=real&draftKey=draft-b'
    await flushPromises()
    expect(sessions[0]!.matchingRead.value).toBeNull()
    expect(sessions[0]!.editable.value).toBe(false)
    await sessions[0]!.save('save')
    expect(saveForm).not.toHaveBeenCalled()
    loadForm.mockResolvedValue(value)
    route.query = { origin: 'real', draftKey: 'draft-a' }
    route.fullPath = '/project/target-cost/form?origin=real&draftKey=draft-a'
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('A独立新建稿')
    wrapper.unmount()
  })
  beforeEach(() => {
    route.params.id = 'budget-a'
    route.path = '/project/target-cost/form/budget-a'
    route.fullPath = `${route.path}?origin=real`
    route.query = { origin: 'real' }
    pending.value = {}
    sessions.length = 0
    guards.clear()
    vi.clearAllMocks()
    confirm.mockResolvedValue(false)
    loadForm.mockImplementation(async (id: string) => form(id))
    saveForm.mockResolvedValue({ id: 'budget-a', commandId: 'cmd' })
    recover.mockResolvedValue({ id: 'budget-a', commandId: 'cmd' })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn().mockResolvedValue(undefined), push }))
    vi.stubGlobal('useTargetCostStore', () => ({ loadForm, saveForm, recover, getPending: (value: TargetCostFormRead) => pending.value[value.targetCostId ?? value.draftKey ?? ''] ?? null }))
    vi.stubGlobal('useTabsStore', () => ({ close, registerCloseGuard: (key: string, guard: () => Promise<boolean>) => {
      guards.set(key, guard)
      return () => guards.delete(key)
    } }))
    vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn() }))
    vi.stubGlobal('useEventListener', vi.fn())
  })
  it('keeps the original write baseline after a background read and preserves null versus zero', async () => {
    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.get('input').setValue('A 未保存')
    loadForm.mockResolvedValue(form('budget-a', 'v2'))
    await fireEvent.click(within(wrapper.element as HTMLElement).getByRole('button', { name: '核对', exact: true }))
    await flushPromises()
    expect(wrapper.get('[data-testid="read-version"]').text()).toBe('v1')
    expect(wrapper.get('[data-testid="latest-version"]').text()).toBe('v2')
    await fireEvent.click(within(wrapper.element as HTMLElement).getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
    expect(saveForm).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ sourceVersion: 'v1' }) }), expect.objectContaining({ name: 'A 未保存', contractRevenue: null, taxInclusiveTotal: 0 }), 'save', { add: [], removeIds: [], restoreIds: [] })
    expect(close).toHaveBeenCalledWith('/project/target-cost/form/budget-a')
    wrapper.unmount()
  })
  it('retains the draft when close is canceled and maps server field errors without clearing it', async () => {
    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.get('input').setValue('保存前名称')
    expect(await guards.get(route.path)!()).toBe(false)
    expect(wrapper.get('input').element.value).toBe('保存前名称')
    saveForm.mockRejectedValue(new ProjectRepositoryProblem({ ...projectProblem('validation-failed', '金额有误'), fieldErrors: { 'draft.taxAmount': ['不能为负数'] } }))
    await fireEvent.click(within(wrapper.element as HTMLElement).getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
    expect(sessions[0]!.fieldErrors.value).toEqual({ taxAmount: '不能为负数' })
    expect(wrapper.get('input').element.value).toBe('保存前名称')
    expect(close).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it.each([
    { field: 'name', label: '预算版本名', message: '请填写版本名称' },
    { field: 'projectId', label: '预算项目', message: '请选择项目' },
  ])('提交失败后等待编辑控件恢复，再聚焦首错：$field', async ({ field, label, message }) => {
    saveForm.mockRejectedValue(new ProjectRepositoryProblem({ ...projectProblem('validation-failed', '请检查预算版本字段'), fieldErrors: { [`draft.${field}`]: [message] } }))
    const wrapper = mount(Harness, { attachTo: document.body })
    await flushPromises()
    await fireEvent.click(within(wrapper.element).getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
    expect(sessions[0]!.busy.value).toBe(false)
    expect(sessions[0]!.fieldErrors.value).toEqual({ [field]: message })
    expect(document.activeElement).toBe(within(wrapper.element).getByRole('textbox', { name: label }))
    expect(close).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it.each([
    { label: '页签已停用', deactivate: true },
    { label: '目标已更换', deactivate: false },
  ])('迟到字段错误不能抢走当前页面焦点：$label', async ({ deactivate }) => {
    let rejectSave!: (cause: Error) => void
    saveForm.mockImplementation(() => new Promise((_resolve, reject) => rejectSave = reject))
    const visible = shallowRef(true)
    const Other = defineComponent({ render: () => h('p', '其他页签') })
    const wrapper = mount(defineComponent({ setup: () => () => h('div', [
      h(KeepAlive, () => visible.value ? h(Harness) : h(Other)),
      h('input', { 'aria-label': '当前页面输入' }),
    ]) }), { attachTo: document.body })
    await flushPromises()
    await fireEvent.click(within(wrapper.element).getByRole('button', { name: '保存', exact: true }))
    if (deactivate) {
      visible.value = false
    }
    else {
      route.params.id = 'budget-b'
      route.path = '/project/target-cost/form/budget-b'
      route.fullPath = `${route.path}?origin=real`
    }
    await flushPromises()
    const current = within(wrapper.element).getByRole('textbox', { name: '当前页面输入' })
    current.focus()
    rejectSave(new ProjectRepositoryProblem({ ...projectProblem('validation-failed', '旧稿名称有误'), fieldErrors: { 'draft.name': ['旧稿请填写名称'] } }))
    await flushPromises()
    expect(document.activeElement).toBe(current)
    expect(sessions[0]!.fieldErrors.value).toEqual({})
    expect(close).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('returns through KeepAlive after a late failure without locking recovery or losing the original command', async () => {
    let rejectSave!: (cause: Error) => void
    saveForm.mockImplementation((value: TargetCostFormRead) => {
      pending.value = { 'budget-a': { command: { commandId: 'cmd', workspaceId: 'workspace', actorId: 'actor', origin: 'real', requiredCapability: 'target-cost:write', sourceVersion: value.context.sourceVersion, targetCostId: 'budget-a', action: { kind: 'save-header', draft: { name: '未决预算' }, saveAction: 'save' } }, state: 'unknown' } }
      return new Promise((_resolve, reject) => rejectSave = reject)
    })
    const visible = shallowRef(true)
    const Other = defineComponent({ render: () => h('p', '其他页签') })
    const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }))
    await flushPromises()
    await wrapper.get('input').setValue('未决预算')
    await fireEvent.click(within(wrapper.element as HTMLElement).getByRole('button', { name: '保存', exact: true }))
    visible.value = false
    await flushPromises()
    rejectSave(new Error('回执丢失'))
    await flushPromises()
    visible.value = true
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('未决预算')
    expect(sessions[0]!.busy.value).toBe(false)
    expect(await guards.get(route.path)!()).toBe(false)
    await fireEvent.click(within(wrapper.element as HTMLElement).getByRole('button', { name: '恢复原提交', exact: true }))
    await flushPromises()
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ commandId: 'cmd', sourceVersion: 'v1' }) }))
    wrapper.unmount()
  })
})
