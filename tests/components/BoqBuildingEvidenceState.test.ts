import type { BoqBuildingContext } from '~/lib/boq/central-building-contract'
import { cleanup, render, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, shallowRef } from 'vue'
import { useBoqBuildingEvidence } from '~/composables/useBoqBuildingEvidence'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
function context(projectId = 'p'): BoqBuildingContext {
  return { workspaceId: 'w', actorId: 'a', origin: 'real', projectId, contractId: 'c', contractName: '施工合同', sourceVersion: 'original-read', capabilities: ['owner-document:write'], buildings: [{ id: 'b', code: 'B1', name: '一栋' }], audit: [], lines: [
    { id: 'line', itemName: '导入原清单', unit: '㎡', qty: 8, unitPrice: 20, effectiveQty: 8, effectiveUnitPrice: 20, building: null, sourceKind: 'confirmed-import', readOnlyReason: null },
    { id: 'other', itemName: '另一导入清单', unit: 'm', qty: 2, unitPrice: 20, effectiveQty: 2, effectiveUnitPrice: 20, building: null, sourceKind: 'confirmed-import', readOnlyReason: null },
    { id: 'signed', itemName: '签证新增', unit: '㎡', qty: 10, unitPrice: 20, effectiveQty: 10, effectiveUnitPrice: 20, building: null, sourceKind: 'change-addition', readOnlyReason: '已签证行只读' },
  ] }
}
function fixture(keepAlive = false) {
  const route = reactive({ fullPath: '/contract/boq/building-evidence', query: { project: 'p', contract: 'c', origin: 'real', returnTo: '/schedule/p/bind/g?origin=real&contract=c' } as Record<string, string> })
  const store = reactive({ saving: false, pendingCommand: null as object | null, read: vi.fn(async ({ projectId }: { projectId: string }) => context(projectId)), save: vi.fn().mockResolvedValue({}), recover: vi.fn(), cancelRead: vi.fn() })
  const kit = { confirm: vi.fn().mockResolvedValue(true), success: vi.fn() }
  const tabs = { close: vi.fn() }
  const router = { push: vi.fn() }
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => router)
  vi.stubGlobal('useBoqBuildingStore', () => store)
  vi.stubGlobal('useScheduleStore', () => ({ readBinding: vi.fn().mockRejectedValue(new Error('该样本无已绑定楼层关系')) }))
  vi.stubGlobal('useKitUI', () => kit)
  vi.stubGlobal('useTabsStore', () => tabs)
  let ui!: ReturnType<typeof useBoqBuildingEvidence>
  const component = defineComponent({ setup() {
    ui = useBoqBuildingEvidence()
    return () => h('div')
  } })
  const visible = shallowRef(true)
  render(keepAlive
    ? defineComponent({ setup() {
        return () => h(KeepAlive, {}, { default: () => visible.value ? h(component) : h(defineComponent({ render: () => h('div') })) })
      } })
    : component)
  return { ui, store, kit, tabs, router, route, visible }
}
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})
describe('合同楼栋证据整页更正', () => {
  it('从A行深链打开后选择B行，切走再返回仍保留B行输入；真正深链变化仍取新行', async () => {
    const { ui, route, visible } = fixture(true)
    route.query.line = 'line'
    await waitFor(() => expect(ui.loading.value).toBe(false))
    await ui.selectLine('other')
    ui.buildingId.value = 'b'
    ui.reason.value = 'B行原件依据'
    await nextTick()
    visible.value = false
    await nextTick()
    visible.value = true
    await nextTick()
    await waitFor(() => expect(ui.loading.value).toBe(false))
    expect(ui.lineId.value).toBe('other')
    expect(ui.reason.value).toBe('B行原件依据')
    route.query.line = 'signed'
    await waitFor(() => expect(ui.lineId.value).toBe('signed'))
    expect(ui.reason.value).toBe('')
  })
  it('直接切换清单行先确认放弃该行更正，取消留原行，确认后不带入旧理由', async () => {
    const { ui, kit } = fixture()
    await waitFor(() => expect(ui.loading.value).toBe(false))
    ui.lineId.value = 'line'
    ui.buildingId.value = 'b'
    ui.reason.value = '只属于原行的依据'
    kit.confirm.mockResolvedValueOnce(false)
    await ui.selectLine('signed')
    expect(ui.lineId.value).toBe('line')
    expect(ui.reason.value).toBe('只属于原行的依据')
    await ui.selectLine('signed')
    expect(ui.lineId.value).toBe('signed')
    expect(ui.reason.value).toBe('')
    expect(ui.buildingId.value).toBe('')
  })
  it('keepAlive保存确认切走再激活，可核对原提交而不永久卡在忙态', async () => {
    const { ui, store, kit, visible } = fixture(true)
    await waitFor(() => expect(ui.loading.value).toBe(false))
    ui.lineId.value = 'line'
    ui.buildingId.value = 'b'
    ui.reason.value = '依据原件'
    let release!: (value: boolean) => void
    kit.confirm.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const saving = ui.save()
    expect(ui.busy.value).toBe(true)
    store.pendingCommand = { commandId: 'original' }
    visible.value = false
    await nextTick()
    release(false)
    await saving
    visible.value = true
    await nextTick()
    await waitFor(() => expect(ui.busy.value).toBe(false))
    expect(ui.busy.value).toBe(false)
    expect(store.pendingCommand).toEqual({ commandId: 'original' })
  })
  it('同一实例line/mode路由变化不把A行草稿套给B，同合同A原提交不关闭B', async () => {
    const { ui, store, route, tabs } = fixture()
    await waitFor(() => expect(ui.loading.value).toBe(false))
    ui.lineId.value = 'line'
    ui.buildingId.value = 'b'
    ui.reason.value = '原行草稿'
    await nextTick()
    route.query.line = 'signed'
    await waitFor(() => expect(ui.lineId.value).toBe('signed'))
    expect(ui.reason.value).toBe('')
    expect(ui.buildingId.value).toBe('')
    route.query.mode = 'read'
    await nextTick()
    await waitFor(() => expect(ui.loading.value).toBe(false))
    expect(ui.canEdit.value).toBe(false)
    store.pendingCommand = { projectId: 'p', contractId: 'c', lineId: 'line', origin: 'real', workspaceId: 'w', actorId: 'a', commandId: 'old-target' }
    await waitFor(() => expect(ui.loading.value).toBe(false))
    await ui.recover()
    expect(store.recover).toHaveBeenCalledOnce()
    expect(tabs.close).not.toHaveBeenCalled()
    expect(ui.read.value?.projectId).toBe('p')
  })
  it('只对已确认导入基准开放更正，以固定读版本提交，成功返回原绑定并清表单', async () => {
    const { ui, store, tabs, router } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    ui.lineId.value = 'signed'
    expect(ui.canEdit.value).toBe(false)
    ui.buildingId.value = 'b'
    ui.reason.value = '原件第2页为一栋'
    await ui.save()
    expect(store.save).not.toHaveBeenCalled()
    ui.lineId.value = 'line'
    const original = ui.read.value
    expect(ui.canEdit.value).toBe(true)
    await ui.save()
    expect(store.save).toHaveBeenCalledExactlyOnceWith(original, 'line', 'b', '原件第2页为一栋')
    expect(tabs.close).toHaveBeenCalledOnce()
    expect(router.push).toHaveBeenCalledWith('/schedule/p/bind/g?origin=real&contract=c&group=g')
  })
  it('取消关闭保稿，确认放弃才返回；未决原提交禁止放弃', async () => {
    const { ui, store, kit, router } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    ui.lineId.value = 'line'
    ui.buildingId.value = 'b'
    ui.reason.value = '未保存理由'
    kit.confirm.mockResolvedValueOnce(false)
    await ui.leave()
    expect(router.push).not.toHaveBeenCalled()
    expect(ui.reason.value).toBe('未保存理由')
    store.pendingCommand = { commandId: 'original' }
    expect(await ui.mayLeave()).toBe(false)
    store.pendingCommand = null
    await ui.leave()
    expect(router.push).toHaveBeenCalledOnce()
    expect(store.save).not.toHaveBeenCalled()
  })
  it('确认期间切换项目，旧确认不得保存或关闭新来源页', async () => {
    const { ui, store, kit, route, tabs } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    ui.lineId.value = 'line'
    ui.buildingId.value = 'b'
    ui.reason.value = '依据原件'
    let release!: (value: boolean) => void
    kit.confirm.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const save = ui.save()
    route.query.project = 'p2'
    route.query.returnTo = '/schedule/p2/bind/g2?origin=real&contract=c'
    await waitFor(() => expect(ui.read.value?.projectId).toBe('p2'))
    release(true)
    await save
    expect(store.save).not.toHaveBeenCalled()
    expect(tabs.close).not.toHaveBeenCalled()
  })
  it('重读失败仍保稿，但旧来源版本不能直接保存', async () => {
    const { ui, store } = fixture()
    await waitFor(() => expect(ui.read.value).not.toBeNull())
    ui.lineId.value = 'line'
    ui.buildingId.value = 'b'
    ui.reason.value = '保持理由'
    store.read.mockRejectedValueOnce(new Error('来源读取失败'))
    await ui.recheck()
    await ui.save()
    expect(store.save).not.toHaveBeenCalled()
    expect(ui.reason.value).toBe('保持理由')
  })
})
