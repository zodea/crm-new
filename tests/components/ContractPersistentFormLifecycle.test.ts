import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import ConstructionForm from '~/components/contract/ConstructionContractFormPage.vue'
import SubcontractForm from '~/components/contract/SubcontractContractFormPage.vue'
import { useContractFormAttachments } from '~/composables/useContractFormAttachments'
import { f2FormDefaults } from '~/lib/contract/page'

const mocks = vi.hoisted(() => ({ currentStore: null as any, close: vi.fn(), toast: vi.fn() }))
vi.mock('~/stores/construction-contract-command', () => ({ useConstructionContractCommandStore: () => mocks.currentStore, ConstructionContractCommandConflictError: class extends Error {} }))
vi.mock('~/stores/subcontract-contract-command', () => ({ useSubcontractContractCommandStore: () => mocks.currentStore, SubcontractContractCommandConflictError: class extends Error {} }))
vi.mock('~/composables/useContractFormNavigation', () => ({ useContractFormNavigation: () => ({ closeCurrent: mocks.close, openNew: vi.fn() }) }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const components = {
  EntityFormShell: defineComponent({ props: ['title'], setup: (props, { slots }) => () => h('main', [h('h1', props.title), slots.default?.()]) }),
  ContractFormFields: defineComponent({ props: ['draft'], setup: props => () => h('input', { 'aria-label': '合同名称', 'value': props.draft.name }) }),
  FormFooter: defineComponent({ emits: ['action'], setup: (_props, { emit }) => () => h('button', { onClick: () => emit('action', 'draft') }, '保存草稿') }),
}

afterEach(() => vi.unstubAllGlobals())
describe.each([{ kind: 'construction' as const, component: ConstructionForm }, { kind: 'subcontract' as const, component: SubcontractForm }])('$kind 正式表单异步生命周期', ({ kind, component }) => {
  let route: ReturnType<typeof reactive<any>>
  let session: any
  function form(id: string) {
    return { draft: { ...f2FormDefaults(kind), id, name: `合同${id}` }, attachments: [], version: '1', updatedAt: '2026-10-04T08:00:00.000Z' }
  }
  beforeEach(() => {
    route = reactive({ params: { id: 'A' }, query: { origin: 'real' }, fullPath: `/contract/${kind}/form/A` })
    session = shallowReactive({ generation: 0, targetId: null, baseVersion: null, authority: null, context: null, pending: null, busy: false })
    mocks.toast.mockReset()
    mocks.close.mockReset()
    mocks.currentStore = {
      createSession: () => session,
      hydrate: vi.fn(async (_session: unknown, id: string) => {
        session.generation++
        const context = { workspaceId: 'w', actorId: 'a', capabilities: [`${kind}-contract:write`], projects: [], customers: [], suppliers: [] }
        session.targetId = id
        session.baseVersion = '1'
        session.authority = { workspaceId: context.workspaceId, actorId: context.actorId }
        session.context = context
        return { form: form(id), context }
      }),
      invalidate: vi.fn(() => {
        session.generation++
        session.context = null
      }),
      saveForm: vi.fn(),
      recover: vi.fn(),
      adoptConflictVersion: vi.fn(),
    }
    for (const [key, value] of Object.entries({ computed, ref, shallowRef, watch, nextTick }))
      vi.stubGlobal(key, value)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useKitUI', () => ({ error: mocks.toast, warning: mocks.toast, success: mocks.toast, confirm: vi.fn() }))
    vi.stubGlobal('useContractFormAttachments', useContractFormAttachments)
  })

  it('旧目标迟到的hydrate不能替换新目标，读取失败也不能泄露旧提示', async () => {
    const old = deferred<any>()
    mocks.currentStore.hydrate.mockImplementationOnce(() => old.promise)
    render(component, { global: { components, stubs: { ContractAttachmentSection: true, CommandRecoveryPanel: true } } })
    route.params.id = 'B'
    route.fullPath = `/contract/${kind}/form/B`
    await waitFor(() => expect((screen.getByLabelText('合同名称') as HTMLInputElement).value).toBe('合同B'))
    old.resolve({ form: form('A'), context: {} })
    await flushPromises()
    expect((screen.getByLabelText('合同名称') as HTMLInputElement).value).toBe('合同B')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('保存结果未知时切换目标，迟到失败不改变新页；卸载仍保留原恢复编号', async () => {
    const saving = deferred<any>()
    mocks.currentStore.saveForm.mockImplementation(() => saving.promise)
    const view = render(component, { global: { components, stubs: { ContractAttachmentSection: true, CommandRecoveryPanel: true } } })
    await waitFor(() => expect((screen.getByLabelText('合同名称') as HTMLInputElement).value).toBe('合同A'))
    await fireEvent.click(screen.getByText('保存草稿'))
    expect(mocks.currentStore.saveForm).toHaveBeenCalledOnce()
    route.params.id = 'B'
    route.fullPath = `/contract/${kind}/form/B`
    await waitFor(() => expect((screen.getByLabelText('合同名称') as HTMLInputElement).value).toBe('合同B'))
    saving.reject(new Error('旧目标保存结果未知'))
    await flushPromises()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.close).not.toHaveBeenCalled()
    session.pending = { id: 'original-command-A' }
    view.unmount()
    expect(session.pending.id).toBe('original-command-A')
    expect(mocks.currentStore.invalidate).toHaveBeenCalledOnce()
  })
})
