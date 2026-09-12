import type { TargetCostDetailRead, TargetCostPending } from '~/lib/target-cost/central-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import { useTargetCostDetail } from '~/composables/useTargetCostDetail'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const route = reactive({ params: { id: 'a' }, path: '/project/target-cost/a', fullPath: '/project/target-cost/a?origin=real', query: { origin: 'real' } as Record<string, string> })
const load = vi.fn()
const saveItems = vi.fn()
const confirm = vi.fn()
const recover = vi.fn()
const fields = vi.fn()
const pending = shallowRef<Record<string, TargetCostPending>>({})
const sessions: ReturnType<typeof useTargetCostDetail>[] = []
function detail(id = 'a', version = 'v1'): TargetCostDetailRead {
  const metric = { value: null, knownValue: null, status: 'pending' as const, missingSources: ['缺来源'] }
  return { context: { workspaceId: 'w', actorId: 'actor', origin: 'real', sourceVersion: version, capabilities: ['target-cost:read', 'target-cost:write'] }, targetCostId: id, deletedAt: null, files: [], history: [], actualSourceVersion: 'actual', view: { header: { id, name: `版本${id}`, projectId: 'p', projectCode: 'P', projectName: '项目', isBaseline: true, contractRevenue: null, plannedProfit: 0, signedContractSum: null, taxInclusiveTotal: 0, taxExclusiveTotal: null, taxAmount: null, status: 'submitted', note: '', createdAt: '', updatedAt: '' }, items: [{ id: `${id}-item`, category: '材料', itemName: '', unit: '㎡', qty: null, unitPrice: null, amount: 0, note: '', sortOrder: 0 }], categories: [], summary: { itemTotal: 0, signedAmount: metric, settledAmount: metric, paidAmount: metric, remainingAmount: metric } } }
}
const Harness = defineComponent({ setup() {
  const ui = useTargetCostDetail()
  sessions.push(ui)
  ui.itemEditor.value = { validate: vi.fn().mockResolvedValue([]), setServerErrors: fields }
  return () => h('div', [h('p', { 'data-test': 'version' }, ui.current.value?.context.sourceVersion), h('input', { 'aria-label': '分项', 'value': ui.itemDrafts.value[0]?.itemName, 'onInput': (e: Event) => {
    ui.itemDrafts.value = ui.itemDrafts.value.map(item => ({ ...item, itemName: (e.target as HTMLInputElement).value }))
  } }), h('button', { onClick: ui.beginEdit }, '编辑'), h('button', { disabled: !ui.editable.value, onClick: ui.saveItems }, '保存'), h('button', { onClick: () => ui.load(true) }, '核对')])
} })
describe('预算科目整份保存状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessions.length = 0
    pending.value = {}
    Object.assign(route, { params: { id: 'a' }, path: '/project/target-cost/a', fullPath: '/project/target-cost/a?origin=real', query: { origin: 'real' } })
    load.mockImplementation(async (id: string) => detail(id))
    confirm.mockResolvedValue(false)
    saveItems.mockResolvedValue({ id: 'a', commandId: 'cmd' })
    recover.mockResolvedValue({ id: 'a', commandId: 'cmd' })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useTargetCostDetailStore', () => ({ loadCentral: load, saveItems }))
    vi.stubGlobal('useTargetCostStore', () => ({ getPending: (read: TargetCostDetailRead) => pending.value[read.targetCostId] ?? null, recover }))
    vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn() }))
    vi.stubGlobal('useEventListener', vi.fn())
    vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  })
  it('历史空名只读保真，进入编辑后原固定版本及null/0随整份保存，失败保稿并回填格子', async () => {
    const wrapper = mount(Harness)
    await flushPromises()
    expect(sessions[0]!.current.value?.view.items[0]?.itemName).toBe('')
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.get('input').setValue('人工目标')
    load.mockResolvedValue(detail('a', 'v2'))
    await wrapper.findAll('button')[2]!.trigger('click')
    await flushPromises()
    saveItems.mockRejectedValue(new ProjectRepositoryProblem({ ...projectProblem('validation-failed', '金额错误'), fieldErrors: { 'items.0.amount': ['请核对'] } }))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(saveItems).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ sourceVersion: 'v1' }) }), [expect.objectContaining({ itemName: '人工目标', qty: null, unitPrice: null, amount: 0 })])
    expect(fields).toHaveBeenCalledWith({ 'items.0.amount': ['请核对'] })
    expect(wrapper.get('input').element.value).toBe('人工目标')
    await sessions[0]!.cancelEdit()
    expect(sessions[0]!.editing.value).toBe(true)
    wrapper.unmount()
  })
  it('真实A/B KeepAlive往返保留各自编辑且迟到A成功不会关闭B', async () => {
    let resolveSave!: (value: { id: string }) => void
    saveItems.mockImplementation(() => new Promise(resolve => resolveSave = resolve))
    const shown = shallowRef('a')
    const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => h(Harness, { key: shown.value })) }))
    await flushPromises()
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.get('input').setValue('A稿')
    await wrapper.findAll('button')[1]!.trigger('click')
    Object.assign(route, { params: { id: 'b' }, path: '/project/target-cost/b', fullPath: '/project/target-cost/b?origin=real' })
    shown.value = 'b'
    await flushPromises()
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.get('input').setValue('B稿')
    resolveSave({ id: 'a' })
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('B稿')
    expect(sessions[1]!.editing.value).toBe(true)
    Object.assign(route, { params: { id: 'a' }, path: '/project/target-cost/a', fullPath: '/project/target-cost/a?origin=real' })
    shown.value = 'a'
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('A稿')
    expect(sessions[0]!.busy.value).toBe(false)
    wrapper.unmount()
  })
  it('重核后权限撤回或删除只读，但原稿保留', async () => {
    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.get('input').setValue('保稿')
    const next = detail('a', 'v2')
    next.context.capabilities = ['target-cost:read']
    load.mockResolvedValue(next)
    await sessions[0]!.load(true)
    expect(sessions[0]!.editable.value).toBe(false)
    expect(wrapper.get('input').element.value).toBe('保稿')
    expect(sessions[0]!.read.value?.context.sourceVersion).toBe('v1')
    wrapper.unmount()
  })
})
