import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ListShell from '~/components/ui/ListShell.vue'

const TreeNavStub = defineComponent({
  props: {
    items: {
      type: Array as () => Array<{ key: string, label: string }>,
      required: true,
    },
    modelValue: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue'],
  template: `
    <div>
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        :aria-pressed="modelValue === item.key"
        @click="$emit('update:modelValue', item.key)"
      >
        {{ item.label }}
      </button>
    </div>
  `,
})

const SelectFilterStub = defineComponent({
  props: {
    options: {
      type: Array as () => Array<{ key: string, label: string }>,
      required: true,
    },
    modelValue: {
      type: String,
      default: '',
    },
    ariaLabel: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue'],
  template: `
    <select
      :aria-label="ariaLabel"
      :value="modelValue"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option v-for="option in options" :key="option.key" :value="option.key">
        {{ option.label }}
      </option>
    </select>
  `,
})

const global = {
  components: {
    SelectFilter: SelectFilterStub,
    TreeNav: TreeNavStub,
  },
}

describe('list shell', () => {
  it('把分类树和视图作为受控值向页面回传，并保留工具栏与表格插槽', async () => {
    const { emitted } = render(ListShell, {
      props: {
        tree: [
          { key: 'all', label: '全部合同' },
          { key: 'active', label: '履约中' },
        ],
        treeKey: 'all',
        views: [
          { key: 'all', label: '全部视图' },
          { key: 'mine', label: '我负责的' },
        ],
        viewKey: 'all',
      },
      slots: {
        toolbar: '<button type="button">新建合同</button>',
        table: '<div role="table" aria-label="合同列表">表格</div>',
      },
      global,
    })

    expect(screen.getByRole('button', { name: '新建合同' })).not.toBeNull()
    expect(screen.getByRole('table', { name: '合同列表' })).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '履约中' }))
    await fireEvent.update(screen.getByRole('combobox', { name: '列表视图' }), 'mine')

    expect(emitted()['update:treeKey']).toEqual([['active']])
    expect(emitted()['update:viewKey']).toEqual([['mine']])
  })

  it('按红圈句式格式化汇总值，并允许自定义汇总覆盖默认呈现', () => {
    const board = render(ListShell, {
      props: {
        summary: {
          变更后合同金额总和: 19393316.46,
          合同数量: 12,
          数据截止: '2026-07-30',
        },
      },
      slots: {
        table: '<div>表格</div>',
      },
      global,
    })

    const summary = screen.getByRole('status', { name: '列表汇总' })
    expect(summary.textContent).toContain('变更后合同金额总和: 19,393,316.46；')
    expect(summary.textContent).toContain('合同数量: 12；')
    expect(summary.textContent).toContain('数据截止: 2026-07-30；')
    board.unmount()

    render(ListShell, {
      props: {
        summary: { 总额: 1 },
      },
      slots: {
        table: '<div>表格</div>',
        summary: '<p>由业务页面提供的汇总</p>',
      },
      global,
    })

    expect(screen.getByText('由业务页面提供的汇总')).not.toBeNull()
    expect(screen.queryByText('总额: 1；')).toBeNull()
  })

  it('缺省可选能力时不留下空树、空视图或空汇总区域', () => {
    const { container } = render(ListShell, {
      slots: {
        toolbar: '<button type="button">刷新</button>',
        table: '<div role="table" aria-label="基础列表">表格</div>',
      },
      global,
    })

    expect(screen.getByRole('button', { name: '刷新' })).not.toBeNull()
    expect(screen.getByRole('table', { name: '基础列表' })).not.toBeNull()
    expect(screen.queryByRole('navigation', { name: '列表分类' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: '列表视图' })).toBeNull()
    expect(screen.queryByRole('status', { name: '列表汇总' })).toBeNull()
    expect(container.querySelector('[data-list-shell-tree]')).toBeNull()
  })

  it('分类树可以折叠且恢复后仍保留页面选中值', async () => {
    render(ListShell, {
      props: {
        tree: [
          { key: 'active', label: '履约中' },
          { key: 'paused', label: '中止' },
        ],
        treeKey: 'active',
      },
      slots: {
        table: '<div>表格</div>',
      },
      global,
    })

    await fireEvent.click(screen.getByRole('button', { name: '收起分类' }))
    expect(screen.queryByRole('navigation', { name: '列表分类' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '展开分类' }))
    expect(screen.getByRole('button', { name: '履约中' }).getAttribute('aria-pressed')).toBe('true')
  })
})
