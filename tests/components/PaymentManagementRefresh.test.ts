import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onActivated, onMounted, shallowRef, watch } from 'vue'
import PaymentManagementScreen from '~/components/finance/payment-management/PaymentManagementScreen.vue'
import { usePaymentManagementStore } from '~/stores/payment-management'

const select = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db/connection', () => ({ select }))

beforeEach(() => {
  setActivePinia(createPinia())
  select.mockReset()
  for (const [name, value] of Object.entries({ computed, onActivated, onMounted, shallowRef, watch, storeToRefs, usePaymentManagementStore }))
    vi.stubGlobal(name, value)
})

const Table = defineComponent({
  props: ['rows', 'loading'],
  setup: props => () => h('section', { 'aria-label': '付款表格' }, [
    props.loading ? h('span', { role: 'status' }, '表格加载遮罩') : null,
    ...props.rows.map((row: { name: string }) => h('article', row.name)),
  ]),
})
const Toolbar = defineComponent({
  props: ['loading'],
  emits: ['refresh'],
  setup: (props, { emit }) => () => h('button', { disabled: props.loading, onClick: () => emit('refresh') }, '刷新'),
})

describe('付款管理快照刷新', () => {
  it.each([false, true])('成功快照（有数据=%s）刷新保留表格，失败可见且不伪装首次加载', async (hasRows) => {
    let resolveInitial!: (rows: unknown[]) => void
    select.mockImplementationOnce(() => new Promise(resolve => resolveInitial = resolve))
    render(PaymentManagementScreen, { global: { components: { PaymentManagementTable: Table, PaymentManagementToolbar: Toolbar }, stubs: { PaymentManagementSummary: true, PaymentPayrollSection: true } } })
    expect(await screen.findByText('表格加载遮罩')).toBeTruthy()
    const store = usePaymentManagementStore()
    expect(store.hasSnapshot).toBe(false)
    const source = hasRows ? [{ id: 'a', name: '甲付款', no: 'A', project_name: '', supplier_name: '', apply_amount: 10, approved_amount: 10, paid_amount: 0, invoice_allocated_amount: 0 }] : []
    resolveInitial(source)
    await waitFor(() => expect(store.hasSnapshot).toBe(true))
    expect(screen.queryByText('表格加载遮罩')).toBeNull()
    let rejectRefresh!: (reason: Error) => void
    select.mockImplementationOnce(() => new Promise((_, reject) => rejectRefresh = reject))
    await fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(store.loading).toBe(true)
    expect(screen.queryByText('表格加载遮罩')).toBeNull()
    expect(screen.queryAllByRole('article')).toHaveLength(hasRows ? 1 : 0)
    expect((screen.getByRole('button', { name: '刷新' }) as HTMLButtonElement).disabled).toBe(true)
    rejectRefresh(new Error('读取失败，请稍后重试'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('读取失败，请稍后重试'))
    expect(store.hasSnapshot).toBe(true)
    expect(screen.queryAllByRole('article')).toHaveLength(hasRows ? 1 : 0)
  })
})
