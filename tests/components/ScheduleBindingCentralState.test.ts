import type { ScheduleBindingRead } from '~/lib/schedule/central-binding-contract'
import type { SchedulePending } from '~/lib/schedule/central-contract'
import { cleanup, render, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, shallowRef } from 'vue'
import { useScheduleContractBinding } from '~/composables/useScheduleContractBinding'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
function readValue(projectId = 'p', groupId = 'g', contractId = ''): ScheduleBindingRead {
  return {
    workspaceId: 'w',
    actorId: 'a',
    origin: 'real',
    sourceVersion: 'version-before-preview',
    capabilities: ['schedule:read', 'schedule:write'],
    group: { id: groupId, name: `分组${groupId}`, projectId, scopeBasis: 'provisional', contractId: null },
    contracts: [{ id: 'c', projectId, no: 'C1', name: '当前施工合同', lineCount: 2 }],
    state: 'unbound',
    binding: null,
    preview: contractId ? { groupId, groupName: `分组${groupId}`, projectId, contractId, contractNo: 'C1', contractName: '当前施工合同', buildings: [], extraContractBuildings: [], items: [], blockers: [], warnings: [], canBind: true } : null,
  }
}
function fixture(keepAlive = false) {
  const props = reactive({ projectId: 'p', groupId: 'g', origin: 'real' as const })
  const route = reactive({ fullPath: '/schedule/p/bind/g?origin=real', query: { task: 't', month: '2026-09', view: 'crew', assignee: 'crew:x' } as Record<string, string> })
  const store = reactive({
    sourceVersion: 'arbitrary-global',
    saving: false,
    pendingCommand: null as SchedulePending | null,
    readBinding: vi.fn(async (project: string, group: string, contract = '') => readValue(project, group, contract)),
    confirmBinding: vi.fn().mockResolvedValue({ groupId: 'g' }),
    recoverPending: vi.fn().mockResolvedValue({ groupId: 'g' }),
    cancelBindingRead: vi.fn(),
  })
  const kit = { confirm: vi.fn().mockResolvedValue(true), success: vi.fn() }
  const router = { push: vi.fn() }
  const tabs = { close: vi.fn() }
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => router)
  vi.stubGlobal('useScheduleStore', () => store)
  vi.stubGlobal('useKitUI', () => kit)
  vi.stubGlobal('useTabsStore', () => tabs)
  vi.stubGlobal('useState', (_key: string, init: () => Record<string, string>) => shallowRef(init()))
  let ui!: ReturnType<typeof useScheduleContractBinding>
  const component = defineComponent({ setup() {
    ui = useScheduleContractBinding(props)
    return () => h('div')
  } })
  const visible = shallowRef(true)
  const mounted = render(keepAlive
    ? defineComponent({ setup() {
        return () => h(KeepAlive, {}, { default: () => visible.value ? h(component) : h(defineComponent({ render: () => h('div') })) })
      } })
    : component)
  return { props, route, store, kit, router, tabs, ui, mounted, visible }
}
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('中央绑定表单状态边界', () => {
  it('选择只保应用内存，旧浏览器选择不读不删；descriptor空正文冷恢复仍核原号后读', async () => {
    const key = 'ruihang:schedule-binding-drafts-v1'
    const old = JSON.stringify({ '["w","a","real","p","g"]': 'c' })
    window.sessionStorage.setItem(key, old)
    const { ui, store, router } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    expect(ui.selectedContractId.value).toBe('')
    await ui.selectContract('c')
    expect(window.sessionStorage.getItem(key)).toBe(old)
    store.pendingCommand = { descriptor: { family: 'schedule', action: 'bind-contract', targetId: 'p', commandId: 'original-cold-id', workspaceId: 'w', actorId: 'a' }, command: null, state: 'unknown' }
    await ui.recover()
    expect(store.recoverPending).toHaveBeenCalledOnce()
    expect(store.confirmBinding).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ path: '/schedule', query: expect.objectContaining({ project: 'p', group: 'g' }) }))
    expect(window.sessionStorage.getItem(key)).toBe(old)
  })

  it('同项目另一分组的原绑定回执不得关闭当前表单或假认当前分组已绑定', async () => {
    const { ui, store, router, tabs } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    store.pendingCommand = { descriptor: { family: 'schedule', action: 'bind-contract', targetId: 'p', commandId: 'another-group-original-id', workspaceId: 'w', actorId: 'a' }, command: null, state: 'unknown' }
    store.recoverPending.mockResolvedValueOnce({ groupId: 'g2' })
    await ui.recover()
    expect(store.recoverPending).toHaveBeenCalledOnce()
    expect(router.push).not.toHaveBeenCalled()
    expect(tabs.close).not.toHaveBeenCalled()
    expect(ui.read.value?.group.id).toBe('g')
  })

  it('keepAlive确认等待切走再返回，清临时确认忙态并保留原提交', async () => {
    const { ui, store, kit, visible } = fixture(true)
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    await ui.selectContract('c')
    let release!: (value: boolean) => void
    kit.confirm.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const binding = ui.bind()
    expect(ui.confirming.value).toBe(true)
    store.pendingCommand = { descriptor: { family: 'schedule', action: 'bind-contract', targetId: 'p', commandId: 'original-id', workspaceId: 'w', actorId: 'a' }, command: null, state: 'unknown' }
    visible.value = false
    await nextTick()
    release(false)
    await binding
    visible.value = true
    await nextTick()
    await waitFor(() => expect(ui.busy.value).toBe(false))
    expect(ui.confirming.value).toBe(false)
    expect(ui.busy.value).toBe(false)
    expect(store.pendingCommand.descriptor.commandId).toBe('original-id')
  })
  it('旁路读取抬高全局版本也只提交原预览，成功关闭原表单并保完整返回筛选', async () => {
    const { ui, store, router, tabs } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    await ui.selectContract('c')
    const original = ui.read.value
    store.sourceVersion = 'newer-unrelated-read'
    await ui.bind()
    expect(store.confirmBinding).toHaveBeenCalledExactlyOnceWith(original)
    expect(store.confirmBinding.mock.calls[0]![0].sourceVersion).toBe('version-before-preview')
    expect(tabs.close).toHaveBeenCalledOnce()
    expect(router.push).toHaveBeenCalledWith({ path: '/schedule', query: { project: 'p', group: 'g', origin: 'real', task: 't', month: '2026-09', view: 'crew', assignee: 'crew:x' } })
  })
  it('最终确认取消不写入并保留合同选择与预览', async () => {
    const { ui, store, kit } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    await ui.selectContract('c')
    kit.confirm.mockResolvedValueOnce(false)
    await ui.bind()
    expect(store.confirmBinding).not.toHaveBeenCalled()
    expect(ui.selectedContractId.value).toBe('c')
    expect(ui.preview.value?.contractId).toBe('c')
  })
  it('真实参数切换期间旧预览迟到不能覆盖新分组', async () => {
    const { ui, props, store } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    let release!: (read: ScheduleBindingRead) => void
    store.readBinding.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const old = ui.selectContract('c')
    props.groupId = 'g2'
    await waitFor(() => expect(ui.read.value?.group.id).toBe('g2'))
    release(readValue('p', 'g', 'c'))
    await old
    expect(ui.read.value?.group.id).toBe('g2')
    expect(ui.preview.value).toBeNull()
  })
  it('确认等待期间切换分组，旧确认不得写入', async () => {
    const { ui, props, store, kit } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    await ui.selectContract('c')
    let release!: (value: boolean) => void
    kit.confirm.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const save = ui.bind()
    props.groupId = 'g2'
    await waitFor(() => expect(ui.read.value?.group.id).toBe('g2'))
    release(true)
    await save
    expect(store.confirmBinding).not.toHaveBeenCalled()
  })
  it('旧保存响应不关闭新分组，结果不确定时不能放弃或新提交', async () => {
    const { ui, props, store, tabs } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    await ui.selectContract('c')
    let release!: () => void
    store.confirmBinding.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    const save = ui.bind()
    await waitFor(() => expect(store.confirmBinding).toHaveBeenCalledOnce())
    props.groupId = 'g2'
    await waitFor(() => expect(ui.read.value?.group.id).toBe('g2'))
    release()
    await save
    expect(tabs.close).not.toHaveBeenCalled()
    store.pendingCommand = { descriptor: { family: 'schedule', action: 'bind-contract', targetId: 'p', commandId: 'original-id', workspaceId: 'w', actorId: 'a' }, command: null, state: 'unknown' }
    expect(await ui.mayLeave()).toBe(false)
    await ui.selectContract('c')
    expect(ui.selectedContractId.value).toBe('')
    expect(store.pendingCommand.descriptor.commandId).toBe('original-id')
  })
  it('资料重读失败后旧预览不能再确认，原合同选择仍可修正', async () => {
    const { ui, store } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    await ui.selectContract('c')
    store.readBinding.mockRejectedValueOnce(new Error('清单来源已变化'))
    await ui.recheck()
    await ui.bind()
    expect(store.confirmBinding).not.toHaveBeenCalled()
    expect(ui.selectedContractId.value).toBe('c')
  })
  it('来源更正携带完整返回目标，卸载后迟到请求不再打开确认', async () => {
    const { ui, router, mounted, store, kit } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    await ui.selectContract('c')
    await ui.repair()
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ path: '/contract/boq/building-evidence', query: expect.objectContaining({ project: 'p', contract: 'c', origin: 'real', returnTo: expect.stringContaining('assignee=crew%3Ax') }) }))
    let release!: (value: boolean) => void
    kit.confirm.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const save = ui.bind()
    mounted.unmount()
    release(true)
    await save
    await flushPromises()
    expect(store.confirmBinding).not.toHaveBeenCalled()
  })
  it('原有绑定只读读取实际结果，不重新预览或生成命令', async () => {
    const { ui, store } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    const bound = { ...readValue(), state: 'bound' as const, group: { ...readValue().group, contractId: 'c', scopeBasis: 'contract' as const }, binding: { contractId: 'c', contractNo: 'C1', contractName: '既有合同', boundAt: null, actorId: null, sourceVersion: null, preview: null, legacyDetailMissing: true } }
    store.readBinding.mockResolvedValueOnce(bound)
    await ui.recheck()
    expect(ui.canChoose.value).toBe(false)
    await ui.selectContract('c')
    await ui.bind()
    expect(store.confirmBinding).not.toHaveBeenCalled()
    expect(ui.read.value?.binding?.legacyDetailMissing).toBe(true)
  })
})
