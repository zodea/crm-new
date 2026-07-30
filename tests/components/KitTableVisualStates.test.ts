import { fireEvent, render, screen } from '@testing-library/vue'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, useTemplateRef } from 'vue'
import KitTable from '~/components/ui/KitTable.vue'

const VxeTableStub = defineComponent({
  props: {
    data: {
      type: Array,
      default: () => [],
    },
    loading: Boolean,
    minHeight: Number,
    rowConfig: Object,
    columnConfig: Object,
    resizableConfig: Object,
  },
  setup(props, { slots }) {
    return () => h('div', {
      'data-ui': 'vxe-table-stub',
      'data-min-height': String(props.minHeight),
      'data-row-height': String((props.rowConfig as { height?: number } | undefined)?.height),
      'data-resizable': String((props.columnConfig as { resizable?: boolean } | undefined)?.resizable),
      'data-drag-mode': String((props.resizableConfig as { dragMode?: string } | undefined)?.dragMode),
      'data-drag-tip': String((props.resizableConfig as { showDragTip?: boolean } | undefined)?.showDragTip),
      'data-double-click-auto': String((props.resizableConfig as { isDblclickAutoWidth?: boolean } | undefined)?.isDblclickAutoWidth),
    }, props.loading ? slots.loading?.() : props.data.length ? slots.default?.() : slots.empty?.())
  },
})

const VxeColumnStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

const TablePagerStub = defineComponent({
  setup() {
    return () => h('nav')
  },
})

const global = {
  components: {
    'TablePager': TablePagerStub,
    'vxe-column': VxeColumnStub,
    'vxe-table': VxeTableStub,
  },
}

describe('kitTable visual states', () => {
  beforeAll(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('uses a shimmer skeleton instead of a spinner while loading', () => {
    render(KitTable, {
      props: {
        columns: [{ field: 'name', title: '名称' }],
        data: [],
        loading: true,
      },
      global,
    })

    expect(screen.getByRole('status', { name: '正在加载表格数据' })).not.toBeNull()
    expect(document.querySelectorAll('[data-ui="kit-table-shimmer"]').length).toBeGreaterThan(0)
  })

  it('composes an empty title with guidance', () => {
    render(KitTable, {
      props: {
        columns: [{ field: 'name', title: '名称' }],
        data: [],
        empty: '暂无项目',
      },
      global,
    })

    expect(screen.getByText('暂无项目')).not.toBeNull()
    expect(screen.getByText('请调整筛选条件，或检查当前业务范围。')).not.toBeNull()
  })

  it('supports business guidance and an optional empty primary action', async () => {
    const view = render(KitTable, {
      props: {
        columns: [{ field: 'name', title: '名称' }],
        data: [],
        empty: {
          title: '还没有施工项目',
          description: '新建第一个项目后，可在这里跟踪阶段与经营数据。',
          actionLabel: '新增项目',
        },
      },
      global,
    })

    expect(screen.getByText('还没有施工项目')).not.toBeNull()
    expect(screen.getByText('新建第一个项目后，可在这里跟踪阶段与经营数据。')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '新增项目' }))
    expect(view.emitted().emptyAction).toHaveLength(1)
  })

  it('uses the compact 36px density and right-edge resize contract by default', () => {
    render(KitTable, {
      props: {
        columns: [{ field: 'name', title: '名称' }],
        data: [{ id: 1, name: '合和新城' }],
        minRows: 3,
      },
      global,
    })

    const table = document.querySelector<HTMLElement>('[data-ui="vxe-table-stub"]')
    expect(table?.dataset.minHeight).toBe('144')
    expect(table?.dataset.rowHeight).toBe('36')
    expect(table?.dataset.resizable).toBe('true')
    expect(table?.dataset.dragMode).toBe('fixed')
    expect(table?.dataset.dragTip).toBe('true')
    expect(table?.dataset.doubleClickAuto).toBe('true')
  })

  it('allows a caller to disable column resizing and double-click auto fit', () => {
    render(KitTable, {
      props: {
        columns: [{ field: 'name', title: '名称' }],
        data: [{ id: 1, name: '合和新城' }],
        resizable: false,
        resizeConfig: {
          isDblclickAutoWidth: false,
        },
      },
      global,
    })

    const table = document.querySelector<HTMLElement>('[data-ui="vxe-table-stub"]')
    expect(table?.dataset.resizable).toBe('false')
    expect(table?.dataset.doubleClickAuto).toBe('false')
  })
})
