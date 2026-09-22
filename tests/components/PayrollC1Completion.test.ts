import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { usePayrollC1Statement } from '~/composables/usePayrollC1Statement'
import { c1Form, c1Frozen } from '../helpers/payroll-c1-ui'

const load = vi.fn()
const output = vi.fn()
const release = vi.fn()
const changed = vi.fn()
const acknowledge = vi.fn()
let ui!: ReturnType<typeof usePayrollC1Statement>
beforeEach(() => {
  vi.clearAllMocks()
  load.mockResolvedValue(c1Form())
  output.mockResolvedValue({ context: c1Form().context, statementId: 'wage', state: 'available', document: c1Frozen() })
  release.mockResolvedValue({ commandId: 'cmd', statementId: 'wage', projectId: 'p', outcome: 'released', sourceVersion: 'v2', rateRevisionIds: [], logIds: [] })
  vi.stubGlobal('usePayrollC1Store', () => ({ loadC1Form: load, loadC1Output: output, releaseC1: release, recoverC1: release, getC1Pending: () => ({ command: { commandId: 'cmd', projectId: 'p', statementId: 'wage', origin: 'real', action: { kind: 'release-c1', release: { actualAmount: 300, allocations: [{ workerId: 'w', amount: 300 }, { workerId: 'zero', amount: 0 }] } } } }), acknowledgeC1: acknowledge }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn() }))
})
function harness() {
  return mount(defineComponent({ setup() {
    ui = usePayrollC1Statement({ id: () => 'wage', origin: () => 'real', changed })
    return () => h('p', ui.matching.value?.status)
  } }))
}
describe('c1 回执后的同目标状态读取', () => {
  it('工作区与输出就绪后才通知父详情，不在旧核对状态发出 changed', async () => {
    const view = harness()
    await flushPromises()
    load.mockResolvedValue({ ...c1Form(), status: 'released' })
    changed.mockImplementation(() => {
      expect(ui.matching.value?.status).toBe('released')
      expect(ui.output.value?.state).toBe('available')
    })
    await ui.recover()
    expect(changed).toHaveBeenCalledOnce()
    expect(ui.output.value?.state).toBe('available')
    view.unmount()
  })
  it('成功后读取失败，保留实发原分配与原窗口，不宣告完成', async () => {
    const view = harness()
    await flushPromises()
    expect(ui.releaseOpen.value).toBe(true)
    load.mockRejectedValue(new Error('回执成功但读取中断'))
    await ui.recover()
    expect(ui.releaseOpen.value).toBe(true)
    expect(ui.releaseDraft.value?.allocations).toEqual([{ workerId: 'w', amount: 300 }, { workerId: 'zero', amount: 0 }])
    expect(changed).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()
    view.unmount()
  })
})
