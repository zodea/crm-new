import { render, screen } from '@testing-library/vue'
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
  },
  setup(props, { slots }) {
    return () => h('div', props.loading ? slots.loading?.() : props.data.length ? slots.default?.() : slots.empty?.())
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
})
