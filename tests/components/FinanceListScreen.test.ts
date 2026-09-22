import type { FinanceListRow } from '~/stores/finance'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onActivated, onMounted, readonly, shallowRef, watch } from 'vue'
import FinanceListScreen from '~/components/finance/FinanceListScreen.vue'
import ListFilterBar from '~/components/shared/ListFilterBar.vue'
import SearchInput from '~/components/ui/SearchInput.vue'

const navigateTo = vi.fn()
function receipt(overrides: Partial<FinanceListRow> = {}): FinanceListRow {
  return {
    id: 'receipt-local-1',
    no: 'SK-001',
    name: '正式本地客户',
    projectName: '示例项目',
    partyName: '示例合同',
    amount: 100,
    date: '2026-08-23',
    status: 'submitted',
    customerId: 'customer-local-1',
    dataOrigin: null,
    ...overrides,
  }
}
const listRows = shallowRef({ receipt: [receipt()] })
const financeStore = {
  listRows: readonly(listRows),
  loading: readonly(shallowRef(false)),
  loadList: vi.fn().mockResolvedValue(undefined),
}

const KitTableStub = defineComponent({
  props: ['data', 'page'],
  emits: ['page-change'],
  setup(props, { slots, emit }) {
    return () => h('section', { 'aria-label': '收款表格' }, [
      ...props.data.map((row: unknown) => [slots.name?.({ row }), slots.action?.({ row })]),
      h('button', { onClick: () => emit('page-change', { page: props.page.page + 1, pageSize: props.page.pageSize }) }, '下一页'),
    ])
  },
})

beforeEach(() => {
  navigateTo.mockReset()
  financeStore.loadList.mockClear()
  listRows.value = { receipt: [receipt()] }
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onActivated', onActivated)
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('useFinanceStore', () => financeStore)
  vi.stubGlobal('storeToRefs', () => ({ listRows, loading: shallowRef(false) }))
})

function renderList() {
  return render(FinanceListScreen, {
    props: { kind: 'receipt' },
    global: {
      stubs: { TreeNav: true, SelectFilter: true },
      components: {
        KitTable: KitTableStub,
        KitButton: defineComponent({ template: '<button><slot /></button>' }),
        ListFilterBar,
        SearchInput,
      },
    },
  })
}

describe('收款列表来源边界', () => {
  it('没有中央来源时名称是普通文本，编辑仍为独立动作', async () => {
    renderList()

    expect(screen.getByTestId('non-central-receipt-name').textContent).toContain('正式本地客户')
    expect(screen.queryByRole('button', { name: '正式本地客户' })).toBeNull()
    expect(screen.getByTitle('编辑')).toBeTruthy()
    await fireEvent.click(screen.getByTitle('编辑'))
    expect(navigateTo).toHaveBeenCalledWith('/finance/receipt/form/receipt-local-1')
  })

  it('合并工具区后保留刷新、新建及中央收款详情身份', async () => {
    listRows.value = { receipt: [receipt({ dataOrigin: 'real' })] }
    const { container } = renderList()
    const toolbar = container.querySelector('[data-list-shell-toolbar]')!
    expect(toolbar.contains(screen.getByRole('heading', { name: '收款登记' }))).toBe(true)
    expect(toolbar.contains(screen.getByRole('searchbox'))).toBe(true)

    financeStore.loadList.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(financeStore.loadList).toHaveBeenCalledWith('receipt')
    await fireEvent.click(screen.getByRole('button', { name: '新建收款登记' }))
    expect(navigateTo).toHaveBeenCalledWith('/finance/receipt/new')
    await fireEvent.click(screen.getByRole('button', { name: '正式本地客户' }))
    expect(navigateTo).toHaveBeenCalledWith('/finance/receipt/receipt-local-1?origin=real&customerId=customer-local-1')
  })

  it('换页后搜索和筛选仍回到第一页，合计使用全部筛选结果', async () => {
    listRows.value = {
      receipt: Array.from({ length: 11 }, (_, index) => receipt({
        id: `receipt-${index}`,
        name: `客户${index}`,
        projectName: index === 10 ? '项目乙' : '项目甲',
        amount: index === 10 ? 250 : 100,
      })),
    }
    renderList()
    const table = screen.getByRole('region', { name: '收款表格' })
    expect(within(table).queryByText('客户10')).toBeNull()
    expect(screen.getByRole('status', { name: '列表汇总' }).textContent).toContain('¥1,250.00')

    await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(within(table).getByText('客户10')).toBeTruthy()
    await fireEvent.update(screen.getByRole('searchbox'), '客户0')
    expect(within(table).getByText('客户0')).toBeTruthy()
    expect(within(table).queryByText('客户10')).toBeNull()

    await fireEvent.update(screen.getByRole('searchbox'), '')
    await fireEvent.click(screen.getByRole('button', { name: '列表筛选' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '项目乙' }))
    await fireEvent.keyDown(screen.getByRole('checkbox', { name: '项目乙' }), { key: 'Escape' })
    expect(within(table).getByText('客户10')).toBeTruthy()
    expect(within(table).queryByText('客户0')).toBeNull()
    expect(screen.getByRole('status', { name: '列表汇总' }).textContent).toContain('¥250.00')
  })
})
