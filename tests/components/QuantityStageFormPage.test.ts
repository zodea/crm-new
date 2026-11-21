import type { QuantityStageWorkspace } from '../../app/lib/quantity/central-stages'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, ref } from 'vue'
import QuantityStageFormPage from '../../app/components/quantity/QuantityStageFormPage.vue'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { createQuantityStageState } from '../../app/lib/quantity/stage-state'

let state: ReturnType<typeof reactive<ReturnType<typeof createQuantityStageState>>>
vi.mock('~/stores/quantity-stage', () => ({ useQuantityStageStore: () => state }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
const identity = { workspaceId: 'w', actorId: 'a', capabilities: ['quantity:read', 'quantity:write', 'project:list:read'] }
const initial: QuantityStageWorkspace = { projectId: 'p', matrixArchivedAt: null, stages: [], items: [{ id: 'item', code: 'P', name: '腻子', trade: '油漆工', unit: '㎡' }], mappings: [] }
const read = vi.fn()
const execute = vi.fn()
const confirm = vi.fn()
const context = vi.fn()
const global = { stubs: { QuantityCommandRecovery: true } }
function response(data = initial, version = 'v1') {
  return { data, sourceVersion: version, dataOrigin: 'real', asOf: '2026-09-11T00:00:00Z', capabilities: identity.capabilities }
}
beforeEach(() => {
  read.mockReset().mockResolvedValue(response())
  execute.mockReset()
  confirm.mockReset().mockResolvedValue(true)
  context.mockReset().mockResolvedValue(identity)
  state = reactive(createQuantityStageState({ read, context, execute }))
  vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), warning: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
})

describe('施工阶段配置整页', () => {
  it('缓存草稿返回时权限读取失败可原地重试，恢复后保留输入和编辑版本', async () => {
    const active = ref(true)
    const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(QuantityStageFormPage, { projectId: 'p' }) : h('div') }) }), { global })
    await flushPromises()
    await wrapper.get('input[aria-label="阶段名称"]').setValue('尚未保存的阶段')
    active.value = false
    await flushPromises()
    context.mockRejectedValueOnce(quantityProblem('unavailable', '当前权限读取中断'))
    active.value = true
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('当前权限读取中断')
    await wrapper.findAll('button').find(button => button.text() === '重新读取')!.trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect((wrapper.get('input[aria-label="阶段名称"]').element as HTMLInputElement).value).toBe('尚未保存的阶段')
    expect(state.baseVersion).toBe('v1')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('保存失败保留整页输入，重试同一命令；保存已确认但回读失败时只读重试定位已存阶段', async () => {
    const wrapper = mount(QuantityStageFormPage, { props: { projectId: 'p' }, global })
    await flushPromises()
    await wrapper.get('input[aria-label="阶段编码"]').setValue('PUTTY-01')
    await wrapper.get('input[aria-label="阶段名称"]').setValue('第一遍腻子')
    await wrapper.get('input[aria-label="关联腻子"]').setValue(true)
    execute.mockRejectedValueOnce(quantityProblem('unavailable', '保存中断'))
    await wrapper.findAll('button').find(button => button.text() === '保存阶段')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('保存中断')
    expect((wrapper.get('input[aria-label="阶段名称"]').element as HTMLInputElement).value).toBe('第一遍腻子')
    execute.mockResolvedValue({ commandId: 'irrelevant', id: 'saved', sourceVersion: 'v2', logIds: [] })
    read.mockRejectedValueOnce(quantityProblem('unavailable', '回读暂不可用'))
    await wrapper.findAll('button').find(button => button.text() === '保存阶段')!.trigger('click')
    await flushPromises()
    expect(execute.mock.calls[1]![0].commandId).toBe(execute.mock.calls[0]![0].commandId)
    expect(wrapper.text()).toContain('回读暂不可用')
    read.mockResolvedValue(response({ ...initial, stages: [{ id: 'saved', code: 'PUTTY-01', name: '第一遍腻子', trade: '油漆工', completionMode: 'unit', sortOrder: 0 }], mappings: [{ id: 'm', stageId: 'saved', itemId: 'item', isReportingStage: false }] }, 'v2'))
    await wrapper.findAll('button').find(button => button.text() === '重新读取')!.trigger('click')
    await flushPromises()
    expect(execute).toHaveBeenCalledTimes(2)
    expect((wrapper.get('select[aria-label="当前施工阶段"]').element as HTMLSelectElement).value).toBe('saved')
    expect((wrapper.get('input[aria-label="阶段名称"]').element as HTMLInputElement).value).toBe('第一遍腻子')
  })

  it('取消归档确认不提交、不丢输入；取消切换阶段同样保留当前草稿', async () => {
    read.mockResolvedValue(response({ ...initial, matrixArchivedAt: '2026-09-11T00:00:00Z' }))
    const wrapper = mount(QuantityStageFormPage, { props: { projectId: 'p' }, global })
    await flushPromises()
    await wrapper.get('input[aria-label="阶段编码"]').setValue('A')
    await wrapper.get('input[aria-label="阶段名称"]').setValue('未保存名称')
    confirm.mockResolvedValue(false)
    await wrapper.findAll('button').find(button => button.text() === '保存阶段')!.trigger('click')
    await flushPromises()
    expect(execute).not.toHaveBeenCalled()
    expect((wrapper.get('input[aria-label="阶段名称"]').element as HTMLInputElement).value).toBe('未保存名称')
    await wrapper.findAll('button').find(button => button.text() === '新建阶段')!.trigger('click')
    await flushPromises()
    expect((wrapper.get('input[aria-label="阶段编码"]').element as HTMLInputElement).value).toBe('A')
  })

  it('只有读取权限时整页不提供保存动作，阶段字段与报量选择不可写', async () => {
    read.mockResolvedValue({ ...response(), capabilities: ['quantity:read'] })
    const wrapper = mount(QuantityStageFormPage, { props: { projectId: 'p' }, global })
    await flushPromises()
    expect(wrapper.text()).toContain('仅可查看')
    expect(wrapper.findAll('button').some(button => button.text() === '保存阶段')).toBe(false)
    expect(wrapper.get('fieldset').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('select[aria-label="腻子的报量阶段"]').attributes()).toHaveProperty('disabled')
    expect(execute).not.toHaveBeenCalled()
  })

  it('项目范围改变立即撤旧字段，不能把前一个项目的未保存内容带到另一项目', async () => {
    const wrapper = mount(QuantityStageFormPage, { props: { projectId: 'p' }, global })
    await flushPromises()
    await wrapper.get('input[aria-label="阶段名称"]').setValue('项目一草稿')
    read.mockResolvedValue(response({ ...initial, projectId: 'p2', items: [], stages: [], mappings: [] }, 'p2-v1'))
    await wrapper.setProps({ projectId: 'p2' })
    await flushPromises()
    expect((wrapper.get('input[aria-label="阶段名称"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).not.toContain('腻子的报量阶段')
    expect(state.baseVersion).toBe('p2-v1')
  })

  it('两个分项先分别改报量选择，只保存一项后另一项草稿仍保留且未被暗中提交', async () => {
    const stages: QuantityStageWorkspace['stages'] = ['first', 'second'].map((id, sortOrder) => ({ id, code: id, name: id === 'first' ? '第一遍' : '第二遍', trade: '油漆工', completionMode: 'unit', sortOrder }))
    const items = [...initial.items, { id: 'paint', code: 'PAINT', name: '涂料', trade: '油漆工', unit: '㎡' }]
    const mappings = items.flatMap(item => stages.map(stage => ({ id: `${item.id}-${stage.id}`, itemId: item.id, stageId: stage.id, isReportingStage: stage.id === 'first' })))
    read.mockResolvedValue(response({ ...initial, stages, items, mappings }))
    const wrapper = mount(QuantityStageFormPage, { props: { projectId: 'p' }, global })
    await flushPromises()
    await wrapper.get('select[aria-label="腻子的报量阶段"]').setValue('second')
    await wrapper.get('select[aria-label="涂料的报量阶段"]').setValue('second')
    execute.mockResolvedValue({ commandId: 'one', id: 'item', sourceVersion: 'v2', logIds: [] })
    read.mockResolvedValue(response({ ...initial, stages, items, mappings: mappings.map(row => row.itemId === 'item' ? { ...row, isReportingStage: row.stageId === 'second' } : row) }, 'v2'))
    await wrapper.get('button[aria-label="保存腻子的报量阶段"]').trigger('click')
    await flushPromises()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]![0].action).toMatchObject({ itemId: 'item', stageId: 'second' })
    expect((wrapper.get('select[aria-label="涂料的报量阶段"]').element as HTMLSelectElement).value).toBe('second')
    expect(wrapper.get('button[aria-label="保存涂料的报量阶段"]').attributes()).not.toHaveProperty('disabled')
  })
})
