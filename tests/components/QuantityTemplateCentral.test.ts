import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, KeepAlive, reactive, ref, shallowRef, watch } from 'vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import { createQuantityBrowserState } from '~/lib/quantity/browser-state'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createQuantityReadAdapter } from '~/lib/quantity/read-adapter'
import QuantityTemplateFormPage from '~/pages/subcontract/quantity/_components/QuantityTemplateFormPage.vue'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
const identity = { workspaceId: 'w', actorId: 'a', capabilities: ['quantity:read', 'quantity:write'] }
const workspace = { projectId: 'p', items: [], rooms: [], lines: [], templates: ['a', 'b'].map(id => ({ id, projectId: 'p', code: id.toUpperCase(), name: `${id}户型`, copiedFromTemplateId: null, sortOrder: 0, updatedAt: '2026-09-11T00:00:00Z', unitCount: 0 })) }
const read = vi.fn()
const context = vi.fn()
const execute = vi.fn()
const confirm = vi.fn()
const undoToast = vi.fn()
let state: ReturnType<typeof reactive<ReturnType<typeof createQuantityBrowserState>>>
const global = {
  components: { EntityFormShell, FormFooter },
  stubs: { QuantityCommandRecovery: true },
}
beforeEach(() => {
  read.mockReset().mockResolvedValue({ data: workspace, sourceVersion: 'template-v1', dataOrigin: 'real', capabilities: identity.capabilities, asOf: '2026-09-11T00:00:00Z' })
  context.mockReset().mockResolvedValue(identity)
  execute.mockReset()
  confirm.mockReset()
  undoToast.mockReset()
  const repository = createQuantityRepository(vi.fn())
  const reads = createQuantityReadAdapter(repository, { db: { select: vi.fn(), execute: vi.fn() }, context, includeDemo: () => false })
  vi.spyOn(reads, 'templates').mockImplementation(read)
  vi.spyOn(reads, 'boq').mockResolvedValue({ data: { projectId: 'p', lines: [] }, sourceVersion: 'boq-v99', dataOrigin: 'real', capabilities: identity.capabilities, asOf: '2026-09-11T00:00:00Z' })
  state = reactive(createQuantityBrowserState({ reads, context, execute, catalog: async () => [], includeDemo: () => false }))
  for (const [name, value] of Object.entries({ computed, ref, shallowRef, watch, useQuantityStore: () => state, useRoute: () => ({ query: { project: 'p', origin: 'real' } }), useRouter: () => ({ push: vi.fn() }), useTabTitle: vi.fn(), useKitUI: () => ({ confirm, error: vi.fn(), warning: vi.fn(), success: vi.fn(), undoToast }) }))
    vi.stubGlobal(name, value)
})

describe('中央模板整页与缓存', () => {
  it.each([false, true])('撤回保存遇到归档时请求独立确认，确认结果 %s 决定是否发送授权命令', async (approved) => {
    execute.mockResolvedValue({ commandId: 'save', id: 'a', sourceVersion: 'template-v2', logIds: ['save-log'] })
    const wrapper = mount(QuantityTemplateFormPage, { props: { projectId: 'p' }, global })
    await flushPromises()
    await wrapper.get('input[placeholder="如 A户型"]').setValue('已保存修改')
    await wrapper.findAll('button').find(button => button.text() === '保存模板')!.trigger('click')
    await flushPromises()
    const undo = undoToast.mock.calls[0]![1] as () => Promise<unknown>
    execute.mockReset().mockRejectedValueOnce(quantityProblem('validation-failed', '工程量矩阵已归档，请二次确认后再撤回模板操作')).mockResolvedValue({ commandId: 'undo', id: 'p', sourceVersion: 'template-v3', logIds: [] })
    confirm.mockResolvedValue(approved)
    expect(await undo()).toBe(approved ? undefined : 'cancelled')
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '修改已归档矩阵' }))
    expect(execute).toHaveBeenCalledTimes(approved ? 2 : 1)
    expect(execute.mock.calls[0]![0].action).toMatchObject({ kind: 'undo-template', allowArchivedEdit: false })
    if (approved) {
      expect(execute.mock.calls[1]![0].action).toMatchObject({ kind: 'undo-template', allowArchivedEdit: true })
      expect(execute.mock.calls[1]![0].commandId).not.toBe(execute.mock.calls[0]![0].commandId)
    }
    wrapper.unmount()
  })

  it('只读权限仍可查看另一户型，字段只读且没有新建和保存动作', async () => {
    context.mockResolvedValue({ ...identity, capabilities: ['quantity:read'] })
    const wrapper = mount(QuantityTemplateFormPage, { props: { projectId: 'p' }, global })
    await flushPromises()
    expect(wrapper.get('select[aria-label="当前户型模板"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('select[aria-label="当前户型模板"]').setValue('b')
    expect((wrapper.get('input[placeholder="如 A户型"]').element as HTMLInputElement).value).toBe('b户型')
    expect(wrapper.get('input[placeholder="如 A户型"]').attributes()).toHaveProperty('readonly')
    expect(wrapper.findAll('button').some(button => ['新建空白', '保存模板'].includes(button.text()))).toBe(false)
  })

  it('缓存未保存模板在权限读取失败后可原地重试，保留草稿及最初编辑版本', async () => {
    const active = ref(true)
    const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(QuantityTemplateFormPage, { projectId: 'p' }) : h('div') }) }), { global })
    await flushPromises()
    await wrapper.get('input[placeholder="如 A户型"]').setValue('未保存名称')
    active.value = false
    await flushPromises()
    context.mockRejectedValueOnce(quantityProblem('unavailable', '权限读取中断'))
    active.value = true
    await flushPromises()
    expect(wrapper.text()).toContain('权限读取中断')
    await wrapper.findAll('button').find(button => button.text() === '重新核验权限')!.trigger('click')
    await flushPromises()
    expect((wrapper.get('input[placeholder="如 A户型"]').element as HTMLInputElement).value).toBe('未保存名称')
    expect(read).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    execute.mockRejectedValue(quantityProblem('unavailable', '命令中断'))
    await wrapper.findAll('button').find(button => button.text() === '保存模板')!.trigger('click')
    await flushPromises()
    expect(execute.mock.calls[0]![0].baseVersion).toBe('template-v1')
  })
})
