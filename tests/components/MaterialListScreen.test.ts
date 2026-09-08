import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onActivated, onMounted, shallowRef, watch } from 'vue'
import MaterialListScreen from '~/components/material/MaterialListScreen.vue'
import ListFilterBar from '~/components/shared/ListFilterBar.vue'
import SearchInput from '~/components/ui/SearchInput.vue'

const navigateTo = vi.fn()
const confirm = vi.fn().mockResolvedValue(true)
const undoToast = vi.fn<(message: string, undo: () => Promise<void>) => void>()
const materialStore = {
  loading: false,
  records: {
    mat_requisition: [
      { id: 'material-1', no: 'XL-001', materialName: '瓷砖', projectId: 'project-1', plannedQty: 12, unit: '块', status: 'draft' },
      { id: 'material-2', no: 'XL-002', materialName: '砂浆', projectId: 'project-2', plannedQty: 30, unit: '袋', status: 'submitted' },
    ],
  },
  loadKind: vi.fn().mockResolvedValue(undefined),
  removeForm: vi.fn().mockResolvedValue('delete-log-1'),
  restoreForm: vi.fn().mockResolvedValue(undefined),
}
const projectStore = {
  load: vi.fn().mockResolvedValue(undefined),
  byId: (id: string) => ({ name: id === 'project-1' ? '项目甲' : '项目乙' }),
}
const KitTableStub = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    return () => h('section', { 'aria-label': '材料表格' }, props.data.map((row: { id: string }) =>
      h('div', { 'data-testid': row.id }, [slots.name?.({ row }), slots.quantity?.({ row }), slots.status?.({ row }), slots.action?.({ row })])))
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  confirm.mockResolvedValue(true)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onActivated', onActivated)
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('useMaterialStore', () => materialStore)
  vi.stubGlobal('useProjectStore', () => projectStore)
  vi.stubGlobal('useKitUI', () => ({ confirm, undoToast, error: vi.fn() }))
})

function renderList() {
  return render(MaterialListScreen, {
    props: { kind: 'mat_requisition' },
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

describe('物资列表连续工作面', () => {
  it('合并后保留搜索、项目筛选、数量合计以及刷新和表单入口', async () => {
    renderList()
    await fireEvent.update(screen.getByRole('searchbox'), '瓷砖')
    expect(screen.getByRole('button', { name: '瓷砖' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '砂浆' })).toBeNull()
    expect(screen.getByRole('status', { name: '列表汇总' }).textContent).toContain('12')

    await fireEvent.update(screen.getByRole('searchbox'), '')
    await fireEvent.click(screen.getByRole('button', { name: '列表筛选' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '项目乙' }))
    await fireEvent.keyDown(screen.getByRole('checkbox', { name: '项目乙' }), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '瓷砖' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '砂浆' }))
    expect(navigateTo).toHaveBeenCalledWith('/material/requisition/material-2')
    await fireEvent.click(screen.getByRole('button', { name: '新建下料单' }))
    expect(navigateTo).toHaveBeenCalledWith('/material/requisition/new')

    materialStore.loadKind.mockClear()
    projectStore.load.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(materialStore.loadKind).toHaveBeenCalledWith('mat_requisition')
    expect(projectStore.load).toHaveBeenCalledOnce()
  })

  it('行级删除仍先确认，取消不写入，接受后可撤回原记录', async () => {
    renderList()
    const row = within(screen.getByTestId('material-1'))
    confirm.mockResolvedValueOnce(false)
    await fireEvent.click(row.getByTitle('删除'))
    expect(materialStore.removeForm).not.toHaveBeenCalled()

    await fireEvent.click(row.getByTitle('删除'))
    await waitFor(() => expect(undoToast).toHaveBeenCalledOnce())
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: '删除下料单', confirmLabel: '删除' }))
    expect(materialStore.removeForm).toHaveBeenCalledWith('mat_requisition', 'material-1')
    await undoToast.mock.calls[0]![1]()
    expect(materialStore.restoreForm).toHaveBeenCalledWith('mat_requisition', 'material-1')
  })
})
