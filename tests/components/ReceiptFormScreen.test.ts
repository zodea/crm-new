import type { ReceiptCommand } from '../../app/lib/receipt/contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, ref } from 'vue'
import ReceiptFormScreen from '../../app/components/receipt/ReceiptFormScreen.vue'
import StatePanel from '../../app/components/ui/StatePanel.vue'
import { createReceiptCommandActions } from '../../app/lib/receipt/command-session'
import { receiptProblem } from '../../app/lib/receipt/contract'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { createReceiptReadService } from '../../server/utils/receipt-read-service'
import { command, references, session } from '../receipt/fixtures'

let actions: ReturnType<typeof createReceiptCommandActions>
vi.mock('~/stores/receipt-command', () => ({ useReceiptCommandStore: () => actions }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
const route = reactive({ path: '/finance/receipt/form/receipt-a', fullPath: '/finance/receipt/form/receipt-a?origin=real', params: { id: 'receipt-a' } as Record<string, string>, query: { origin: 'real' } as Record<string, string> })
const context = vi.fn()
const detail = vi.fn()
const execute = vi.fn()
const feedback = { success: vi.fn(), error: vi.fn(), confirm: vi.fn(async () => true) }

function open() {
  return render(ReceiptFormScreen, { global: {
    components: { StatePanel },
    stubs: { LookupSelect: true, ReceiptContractSummary: true, SectionHeader: true, KitStatusTag: true },
  } })
}

describe('收款整页表单读写边界', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.path = '/finance/receipt/form/receipt-a'
    route.fullPath = `${route.path}?origin=real`
    route.params = { id: 'receipt-a' }
    route.query = { origin: 'real' }
    const commands = createReceiptCommandTestInstance({ references: () => references, createId: () => 'receipt-a' })
    commands.execute(command(), session)
    const read = createReceiptReadService({ commands, references: () => references })
    context.mockReset().mockImplementation(async () => read.context(session))
    detail.mockReset().mockImplementation(async (id: string) => read.detail(id, { origin: 'real' }, session))
    execute.mockReset().mockImplementation(async (request: ReceiptCommand) => commands.execute(request, session))
    actions = createReceiptCommandActions(() => ({ context, detail, execute }))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useTabsStore', () => ({ close: vi.fn() }))
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useKitUI', () => feedback)
    vi.stubGlobal('navigateTo', vi.fn(async () => undefined))
  })

  it('上下文未成功读取时没有编辑和保存入口，重读成功后才能继续', async () => {
    context.mockRejectedValueOnce(receiptProblem('unavailable', '候选来源读取失败'))
    open()
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('候选来源读取失败')
    expect(screen.queryByRole('textbox', { name: '收款金额' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await flushPromises()
    expect((screen.getByRole('textbox', { name: '收款金额' }) as HTMLInputElement).value).toBe('120.35')
  })

  it('网络保存失败保留输入，原内容重试复用同一命令并带正确版本', async () => {
    open()
    await flushPromises()
    await fireEvent.update(screen.getByRole('textbox', { name: '收款金额' }), '220.25')
    await fireEvent.click(screen.getByRole('checkbox'))
    execute.mockRejectedValueOnce(receiptProblem('unavailable', '暂时不能保存'))
    await fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
    expect((screen.getByRole('textbox', { name: '收款金额' }) as HTMLInputElement).value).toBe('220.25')
    expect(screen.getByRole('alert').textContent).toContain('暂时不能保存')
    await fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
    expect(execute.mock.calls[1]![0]).toMatchObject({ id: 'receipt-a', baseVersion: '1', draft: { amount: '220.25' }, commandId: execute.mock.calls[0]![0].commandId })
    expect(feedback.success).toHaveBeenCalledWith('收款已保存')
  })

  it('保存已确认但后续重读失败，不重发写命令；重试只读即可恢复', async () => {
    open()
    await flushPromises()
    await fireEvent.click(screen.getByRole('checkbox'))
    detail.mockRejectedValueOnce(receiptProblem('unavailable', '详情重读失败'))
    await fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
    expect(feedback.success).toHaveBeenCalledWith('收款已保存')
    expect(feedback.error).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('详情重读失败')
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await flushPromises()
    expect(execute).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('textbox', { name: '收款金额' }) as HTMLInputElement).value).toBe('120.35')
  })

  it('缓存表单带未保存输入返回时先重验来源，失败禁止保存，恢复后保留输入和原版本', async () => {
    const active = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ReceiptFormScreen) : h('div') }) }), { global: { components: { StatePanel }, stubs: { LookupSelect: true, ReceiptContractSummary: true, SectionHeader: true, KitStatusTag: true } } })
    await flushPromises()
    await fireEvent.update(screen.getByRole('textbox', { name: '收款金额' }), '321.25')
    active.value = false
    await flushPromises()
    context.mockRejectedValueOnce(receiptProblem('forbidden', '关联权限已撤销'))
    active.value = true
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('关联权限已撤销')
    expect(screen.queryByRole('button', { name: '保存', exact: true })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await flushPromises()
    expect((screen.getByRole('textbox', { name: '收款金额' }) as HTMLInputElement).value).toBe('321.25')
    await fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
    expect(execute.mock.calls[0]![0]).toMatchObject({ baseVersion: '1', draft: { amount: '321.25' } })
  })

  it('同路径新建表单重新激活后使用当前返回来源，不沿用上一来源', async () => {
    route.path = '/finance/receipt/new'
    route.params = {}
    route.query = { origin: 'real', returnTo: '/finance/receipt?search=A' }
    route.fullPath = `${route.path}?${new URLSearchParams(route.query)}`
    const active = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ReceiptFormScreen) : h('div') }) }), { global: { components: { StatePanel }, stubs: { LookupSelect: true, ReceiptContractSummary: true, SectionHeader: true, KitStatusTag: true } } })
    await flushPromises()
    active.value = false
    await flushPromises()
    route.path = '/finance/receipt'
    route.query.returnTo = '/finance/receipt?search=unrelated'
    await flushPromises()
    route.path = '/finance/receipt/new'
    route.query.returnTo = '/finance/receipt?search=B'
    active.value = true
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '返回来源页面' }))
    expect(navigateTo).toHaveBeenLastCalledWith('/finance/receipt?search=B')
  })

  it('缓存的正式表单再次打开为演示或非法来源时撤下编辑和保存，不读取正式草稿', async () => {
    const active = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ReceiptFormScreen) : h('div') }) }), { global: { components: { StatePanel }, stubs: { LookupSelect: true, ReceiptContractSummary: true, SectionHeader: true, KitStatusTag: true } } })
    await flushPromises()
    for (const origin of ['demo', 'invalid']) {
      active.value = false
      await flushPromises()
      const reads = detail.mock.calls.length
      route.query.origin = origin
      active.value = true
      await flushPromises()
      expect(screen.getByRole('alert').textContent).toContain('当前来源不可编辑')
      expect(screen.queryByRole('button', { name: '保存', exact: true })).toBeNull()
      expect(screen.queryByRole('textbox', { name: '收款金额' })).toBeNull()
      expect(detail).toHaveBeenCalledTimes(reads)
    }
  })
})
