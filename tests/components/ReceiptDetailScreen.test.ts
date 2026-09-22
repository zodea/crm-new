import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, KeepAlive, reactive, ref, toValue, watchEffect } from 'vue'
import ReceiptRegistrationDetailScreen from '../../app/components/receipt/ReceiptRegistrationDetailScreen.vue'
import KitButton from '../../app/components/ui/KitButton.vue'
import Metric from '../../app/components/ui/Metric.vue'
import MetricGrid from '../../app/components/ui/MetricGrid.vue'
import StatePanel from '../../app/components/ui/StatePanel.vue'
import { receiptProblem } from '../../app/lib/receipt/contract'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { createReceiptReadService } from '../../server/utils/receipt-read-service'
import { command, references, session } from '../receipt/fixtures'

const detail = vi.fn()
const route = reactive({ path: '/finance/receipt/receipt-a', params: { id: 'receipt-a' }, query: { origin: 'real' } })
const globals = { components: { KitButton, Metric, MetricGrid, StatePanel }, stubs: { MoneyLink: true, ReceiptFilesPanel: true, ReceiptReferenceLink: true, SectionHeader: true, KitStatusTag: true, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } }

describe('收款只读详情的当前来源', () => {
  beforeEach(() => {
    route.path = '/finance/receipt/receipt-a'
    route.query.origin = 'real'
    const commands = createReceiptCommandTestInstance({ references: () => references, createId: () => 'receipt-a' })
    commands.execute(command(), session)
    const read = createReceiptReadService({ commands, references: () => references })
    detail.mockReset().mockImplementation(async () => read.detail('receipt-a', { origin: 'real' }, session))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { receipts: { detail } } }))
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
    vi.stubGlobal('useTabTitle', vi.fn())
  })

  it('自身 ID 足以读取；重读失败撤下旧金额与编辑，重试只读恢复', async () => {
    render(ReceiptRegistrationDetailScreen, { global: globals })
    await flushPromises()
    expect(detail).toHaveBeenCalledWith('receipt-a', { origin: 'real', includeDemo: false })
    expect(screen.getByRole('group', { name: '登记金额' }).textContent).toContain('120.35')
    expect(screen.getByRole('link', { name: '编辑收款' }).getAttribute('href')).toContain('/finance/receipt/form/receipt-a')
    detail.mockRejectedValueOnce(receiptProblem('forbidden', '当前无收款权限'))
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await flushPromises()
    expect(screen.queryByRole('group', { name: '登记金额' })).toBeNull()
    expect(screen.queryByRole('link', { name: '编辑收款' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await flushPromises()
    expect(screen.getByRole('group', { name: '登记金额' }).textContent).toContain('120.35')
  })

  it('缓存离页的迟到旧读取不能覆盖重新激活后已读取的新金额', async () => {
    const record = await detail()
    detail.mockClear()
    let finish!: (value: typeof record) => void
    detail.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const active = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ReceiptRegistrationDetailScreen) : h('div') }) }), { global: globals })
    await flushPromises()
    active.value = false
    await flushPromises()
    detail.mockResolvedValueOnce({ ...record, record: { ...record.record, draft: { ...record.record.draft, amount: '999.50' } } })
    active.value = true
    await flushPromises()
    finish(record)
    await flushPromises()
    expect(screen.getByRole('group', { name: '登记金额' }).textContent).toContain('999.50')
  })

  it('离页保留已知页签名称，切换来源可见性只在重新激活后读取', async () => {
    const visibility = reactive({ includeDemo: false })
    vi.stubGlobal('useDataVisibilityStore', () => visibility)
    let tabTitle = ''
    vi.stubGlobal('useTabTitle', (value: Parameters<typeof toValue<string | undefined>>[0]) => {
      watchEffect(() => {
        const title = toValue(value)
        if (title)
          tabTitle = title
      })
    })
    const active = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ReceiptRegistrationDetailScreen) : h('div') }) }), { global: globals })
    await flushPromises()
    const knownTitle = tabTitle
    expect(knownTitle).toBeTruthy()
    expect(detail).toHaveBeenCalledTimes(1)
    active.value = false
    await flushPromises()
    expect(tabTitle).toBe(knownTitle)
    visibility.includeDemo = true
    await flushPromises()
    expect(detail).toHaveBeenCalledTimes(1)
    expect(tabTitle).toBe(knownTitle)
    active.value = true
    await flushPromises()
    expect(detail).toHaveBeenCalledTimes(2)
    expect(detail).toHaveBeenLastCalledWith('receipt-a', { origin: 'real', includeDemo: true })
  })

  it('同 ID 缓存从正式切到演示按当前来源重读，非法来源撤下金额和编辑', async () => {
    const formal = await detail()
    detail.mockClear().mockImplementation(async (_id, query) => ({ ...formal, capabilities: query.origin === 'demo' ? ['receipt:read'] : formal.capabilities, record: { ...formal.record, dataOrigin: query.origin, draft: { ...formal.record.draft, amount: query.origin === 'demo' ? '900.00' : '120.35' } } }))
    const active = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ReceiptRegistrationDetailScreen) : h('div') }) }), { global: globals })
    await flushPromises()
    active.value = false
    await flushPromises()
    route.path = '/finance/receipt'
    route.query.origin = 'demo'
    await flushPromises()
    expect(detail).toHaveBeenCalledTimes(1)
    route.path = '/finance/receipt/receipt-a'
    active.value = true
    await flushPromises()
    expect(detail).toHaveBeenLastCalledWith('receipt-a', { origin: 'demo', includeDemo: false })
    expect(screen.getByRole('group', { name: '登记金额' }).textContent).toContain('900.00')
    expect(screen.queryByRole('link', { name: '编辑收款' })).toBeNull()
    route.query.origin = 'invalid'
    await flushPromises()
    expect(screen.queryByRole('group', { name: '登记金额' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('身份或来源无效')
  })
})
