import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { usePayrollC2Statement } from '~/composables/usePayrollC2Statement'
import { c2Form, c2Frozen } from '../helpers/payroll-c2-ui'

const load = vi.fn()
const output = vi.fn()
const release = vi.fn()
const changed = vi.fn()
const acknowledge = vi.fn()
let ui!: ReturnType<typeof usePayrollC2Statement>
beforeEach(() => {
  vi.clearAllMocks()
  changed.mockReset()
  load.mockResolvedValue(c2Form())
  output.mockResolvedValue({ context: c2Form().context, statementId: 'wage', state: 'available', document: c2Frozen() })
  release.mockResolvedValue({ commandId: 'cmd', statementId: 'wage', projectId: 'p', outcome: 'released', sourceVersion: 'v2', rateRevisionIds: [], logIds: [] })
  vi.stubGlobal('usePayrollC2Store', () => ({ loadC2Form: load, loadC2Output: output, releaseC2: release, recoverC2: release, getC2Pending: () => ({ command: { commandId: 'cmd', projectId: 'p', statementId: 'wage', origin: 'real', action: { kind: 'release-c2', release: { actualAmount: 300, allocations: [{ workerId: 'w', amount: 300 }, { workerId: 'zero', amount: 0 }] } } } }), acknowledgeC2: acknowledge }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn() }))
})
function harness() {
  return mount(defineComponent({ setup() {
    ui = usePayrollC2Statement({ id: () => 'wage', origin: () => 'real', changed })
    return () => h('p', ui.matching.value?.status)
  } }))
}
describe('c2 回执后的同目标状态读取', () => {
  it('工作区与输出就绪后才通知父详情，不在旧核对状态发出 changed', async () => {
    const view = harness()
    await flushPromises()
    load.mockResolvedValue({ ...c2Form(), status: 'released' })
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
  it('原发放回执为需重核而当前已经另窗重核，分别说明原结果与当前状态并保原分配', async () => {
    const view = harness()
    await flushPromises()
    release.mockResolvedValue({ commandId: 'cmd', statementId: 'wage', projectId: 'p', outcome: 'needs-recheck', sourceVersion: 'v2', logIds: [] })
    load.mockResolvedValue({ ...c2Form(), status: 'checked', needsRecheck: false })
    await ui.recover()
    expect(acknowledge).toHaveBeenCalledOnce()
    expect(ui.error.value).toContain('原发放提交')
    expect(ui.error.value).toContain('随后已重新核对')
    expect(ui.error.value).not.toContain('请先重新核对')
    expect(ui.releaseDraft.value?.allocations).toEqual([{ workerId: 'w', amount: 300 }, { workerId: 'zero', amount: 0 }])
    view.unmount()
  })
})
