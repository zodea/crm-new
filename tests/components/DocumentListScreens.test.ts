import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onActivated, onMounted, reactive, shallowRef, watch } from 'vue'
import FinanceListScreen from '~/components/finance/FinanceListScreen.vue'
import MaterialListScreen from '~/components/material/MaterialListScreen.vue'
import ListFilterBar from '~/components/shared/ListFilterBar.vue'
import SearchInput from '~/components/ui/SearchInput.vue'
import { F3_FORM_META } from '~/lib/finance/page'
import { MATERIAL_FORM_META } from '~/lib/material/page'

vi.mock('~/composables/useOverlayStack', () => ({ useOwnedOverlayLayerStyle: () => ({ zIndex: 80 }) }))

const materialStore = reactive({ records: {} as Record<string, object[]>, loading: false, loadKind: vi.fn() })
const financeStore = reactive({ listRows: {} as Record<string, object[]>, loading: false, loadList: vi.fn() })
const TableStub = defineComponent({
  props: ['columns', 'data', 'page'],
  setup(props, { slots }) {
    return () => h('section', { 'aria-label': '单据表格' }, [
      h('header', props.columns.map((column: { customHeader?: boolean, title: string }) => column.customHeader
        ? slots.columnHeader?.({ column })
        : h('span', column.title))),
      ...props.data.map((row: { id: string, no: string }) => h('article', { 'aria-label': row.no }, [
        slots.name?.({ row }),
        slots.status?.({ row }),
      ])),
    ])
  },
})

function mountList(component: typeof FinanceListScreen | typeof MaterialListScreen, kind: string) {
  return render(component, {
    props: { kind } as never,
    global: { components: { KitTable: TableStub, ListFilterBar, SearchInput }, stubs: { TreeNav: true, SelectFilter: true, KitButton: { template: '<button><slot /></button>' } } },
  })
}

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, onActivated, onMounted, shallowRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useMaterialStore', () => materialStore)
  vi.stubGlobal('useFinanceStore', () => financeStore)
  vi.stubGlobal('useProjectStore', () => ({ load: vi.fn(), byId: (id: string) => ({ name: id === 'p1' ? '一期项目' : '二期项目' }) }))
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn(), undoToast: vi.fn(), error: vi.fn() }))
  vi.stubGlobal('storeToRefs', () => ({ listRows: computed(() => financeStore.listRows), loading: computed(() => financeStore.loading) }))
  for (const kind of Object.keys(MATERIAL_FORM_META)) {
    materialStore.records[kind] = [
      { id: 'm1', no: 'MAT-001', materialName: '钢筋', projectId: 'p1', plannedQty: 12, status: 'submitted' },
      { id: 'm2', no: 'MAT-002', materialName: '水泥', projectId: 'p2', plannedQty: 20, status: 'unrecognized' },
    ]
  }
  for (const kind of Object.keys(F3_FORM_META)) {
    financeStore.listRows[kind] = [
      { id: 'f1', no: 'FIN-001', name: '甲公司', projectName: '一期项目', partyName: '材料采购', amount: 100, date: '', status: 'rejected', dataOrigin: 'real', customerId: 'c1' },
      { id: 'f2', no: 'FIN-002', name: '乙公司', projectName: '二期项目', partyName: '工程施工', amount: 200, date: '', status: 'needs_review', dataOrigin: 'real', customerId: 'c2' },
    ]
  }
})

describe('公共单据列表的真实状态与表头筛选', () => {
  it.each(Object.keys(MATERIAL_FORM_META))('材料 %s 保留状态语义，未知状态不显示为成功', (kind) => {
    mountList(MaterialListScreen, kind)
    const rows = screen.getAllByRole('article')
    expect(within(rows[0]!).getByText('已提交').getAttribute('data-tone')).toBe('brand')
    expect(within(rows[1]!).getByText('unrecognized').getAttribute('data-tone')).toBe('neutral')
  })

  it.each(Object.keys(F3_FORM_META))('资金 %s 将驳回与待核对分别呈现', (kind) => {
    mountList(FinanceListScreen, kind)
    expect(screen.getByText('已驳回').getAttribute('data-tone')).toBe('danger')
    expect(screen.getByText('待核对').getAttribute('data-tone')).toBe('warn')
  })

  it.each([
    { component: MaterialListScreen, kind: 'mat_requisition', keyword: '钢筋', first: 'MAT-001', second: 'MAT-002' },
    { component: FinanceListScreen, kind: 'payment_application', keyword: '甲公司', first: 'FIN-001', second: 'FIN-002' },
  ])('$kind 搜索、表头和工具筛选联动同一批表格记录', async ({ component, kind, keyword, first, second }) => {
    mountList(component, kind)
    await fireEvent.update(screen.getByRole('searchbox'), keyword)
    expect(screen.getByRole('article', { name: first })).toBeTruthy()
    expect(screen.queryByRole('article', { name: second })).toBeNull()
    await fireEvent.update(screen.getByRole('searchbox'), '')
    await fireEvent.click(screen.getByRole('button', { name: '筛选项目' }))
    await fireEvent.update(screen.getByRole('combobox', { name: '项目筛选值' }), '二期项目')
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: first })).toBeNull())
    expect(screen.getByRole('article', { name: second })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '列表筛选' }))
    expect((screen.getByRole('combobox', { name: '项目' }) as HTMLSelectElement).value).toBe('二期项目')
    await fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))
  })
})
