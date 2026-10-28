import type { FinanceListRow } from '~/stores/finance'
import { screen as domScreen, fireEvent, render, within } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onActivated, onMounted, readonly, shallowRef, watch } from 'vue'
import FinanceListScreen from '~/components/finance/FinanceListScreen.vue'
import SearchInput from '~/components/ui/SearchInput.vue'

const load = vi.hoisted(() => vi.fn())
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: () => undefined }))
const listRows = shallowRef<Record<string, Array<{ id: string, amount: number, name: string }> | undefined>>({})
const loading = shallowRef(false)

beforeEach(() => {
  load.mockReset()
  listRows.value = {}
  loading.value = false
  for (const [name, value] of Object.entries({ computed, shallowRef, watch, onMounted, onActivated, useFinanceStore: () => ({ loadList: load }), storeToRefs: () => ({ listRows, loading }) }))
    vi.stubGlobal(name, value)
})
afterEach(() => vi.unstubAllGlobals())

function screen() {
  return mount(FinanceListScreen, {
    props: { kind: 'current' },
    global: {
      stubs: {
        ListShell: defineComponent({ template: '<main><slot name="toolbar" /><slot name="table" /><slot name="summary" /></main>' }),
        KitTable: defineComponent({ props: ['data'], template: '<section data-testid="actual-table"><span v-for="row in data" :key="row.id">{{ row.name }}</span></section>' }),
        SearchInput: true,
        KitColumnHeader: true,
        KitEnumFilterOptions: true,
        KitStatusTag: true,
        KitToolbarPopover: true,
      },
    },
  })
}

it('读取失败显示未知与重读，成功空集才显示合计零', async () => {
  load.mockRejectedValue(new Error('当前来源暂时不可用'))
  const wrapper = screen()
  await flushPromises()
  expect(wrapper.get('[data-testid="finance-list-unavailable"]').text()).toContain('当前来源暂时不可用')
  expect(wrapper.get('[data-testid="finance-list-summary-unknown"]').text()).toBe('金额合计尚未核实')
  expect(wrapper.find('[data-testid="actual-table"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('0.00')
  load.mockImplementation(async () => {
    listRows.value = { current: [] }
  })
  await wrapper.get('[data-testid="finance-list-unavailable"] button').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-testid="finance-list-summary-unknown"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('0.00')
  wrapper.unmount()
})

describe('保留原收款列表交互保护', () => {
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
          SearchInput,
        },
      },
    })
  }

  describe('收款列表来源边界', () => {
    it('没有中央来源时名称是普通文本，编辑仍为独立动作', async () => {
      renderList()

      expect(domScreen.getByTestId('non-central-receipt-name').textContent).toContain('正式本地客户')
      expect(domScreen.queryByRole('button', { name: '正式本地客户' })).toBeNull()
      expect(domScreen.getByTitle('编辑')).toBeTruthy()
      await fireEvent.click(domScreen.getByTitle('编辑'))
      expect(navigateTo).toHaveBeenCalledWith('/finance/receipt/form/receipt-local-1')
    })

    it('合并工具区后保留刷新、新建及中央收款详情身份', async () => {
      listRows.value = { receipt: [receipt({ dataOrigin: 'real' })] }
      const { container } = renderList()
      const toolbar = container.querySelector('[data-list-shell-toolbar]')!
      expect(toolbar.contains(domScreen.getByRole('heading', { name: '收款登记' }))).toBe(true)
      expect(toolbar.contains(domScreen.getByRole('searchbox'))).toBe(true)

      financeStore.loadList.mockClear()
      await fireEvent.click(domScreen.getByRole('button', { name: '刷新' }))
      expect(financeStore.loadList).toHaveBeenCalledWith('receipt')
      await fireEvent.click(domScreen.getByRole('button', { name: '新建收款登记' }))
      expect(navigateTo).toHaveBeenCalledWith('/finance/receipt/new')
      await fireEvent.click(domScreen.getByRole('button', { name: '正式本地客户' }))
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
      const table = domScreen.getByRole('region', { name: '收款表格' })
      expect(within(table).queryByText('客户10')).toBeNull()
      expect(domScreen.getByRole('status', { name: '列表汇总' }).textContent).toContain('¥1,250.00')

      await fireEvent.click(domScreen.getByRole('button', { name: '下一页' }))
      expect(within(table).getByText('客户10')).toBeTruthy()
      await fireEvent.update(domScreen.getByRole('searchbox'), '客户0')
      expect(within(table).getByText('客户0')).toBeTruthy()
      expect(within(table).queryByText('客户10')).toBeNull()

      await fireEvent.update(domScreen.getByRole('searchbox'), '')
      await fireEvent.click(domScreen.getByRole('button', { name: '列表筛选' }))
      await fireEvent.click(domScreen.getByRole('checkbox', { name: '项目乙' }))
      await fireEvent.keyDown(domScreen.getByRole('checkbox', { name: '项目乙' }), { key: 'Escape' })
      expect(within(table).getByText('客户10')).toBeTruthy()
      expect(within(table).queryByText('客户0')).toBeNull()
      expect(domScreen.getByRole('status', { name: '列表汇总' }).textContent).toContain('¥250.00')
    })
  })
})

it('重新读取失败撤下旧金额，真实零正常显示，金额合计溢出保持未知', async () => {
  load.mockImplementation(async () => {
    listRows.value = { current: [{ id: 'actual-zero', amount: 0, name: '真实零' }] }
  })
  const wrapper = screen()
  await flushPromises()
  expect(wrapper.text()).toContain('真实零')
  expect(wrapper.text()).toContain('0.00')
  load.mockImplementation(async () => {
    listRows.value = { current: undefined }
    throw new Error('新读取金额损坏')
  })
  await wrapper.get('[aria-label="刷新"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('真实零')
  expect(wrapper.text()).not.toContain('0.00')
  expect(wrapper.text()).toContain('新读取金额损坏')
  load.mockImplementation(async () => {
    listRows.value = { current: [{ id: 'actual-1', amount: 1e308, name: '大额一' }, { id: 'actual-2', amount: 1e308, name: '大额二' }] }
  })
  await wrapper.get('[data-testid="finance-list-unavailable"] button').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-testid="finance-list-summary-unknown"]').text()).toBe('金额合计尚未核实')
  expect(wrapper.text()).toContain('大额一')
  wrapper.unmount()
})
