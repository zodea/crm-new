import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import KitEditGrid from '~/components/ui/KitEditGrid.vue'

const KitTableStub = defineComponent({
  props: {
    columns: {
      type: Array,
      default: () => [],
    },
    data: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['checkboxChange'],
  setup(props, { emit, expose, slots }) {
    const selected = shallowRef<unknown[]>([])
    function toggle(row: unknown, checked: boolean) {
      selected.value = checked
        ? [...selected.value, row]
        : selected.value.filter(candidate => candidate !== row)
      emit('checkboxChange', selected.value)
    }
    function clearCheckbox() {
      selected.value = []
      emit('checkboxChange', [])
    }
    expose({ clearCheckbox })
    return () => h('table', { 'aria-label': '明细网格表格' }, [
      h('tbody', (props.data as Record<string, unknown>[]).map((row, rowIndex) =>
        h('tr', { key: String(row.__kitRowKey) }, [
          h('td', [
            h('input', {
              'aria-label': `选择第 ${rowIndex + 1} 行`,
              'type': 'checkbox',
              'checked': selected.value.includes(row),
              'onChange': (event: Event) =>
                toggle(row, (event.target as HTMLInputElement).checked),
            }),
          ]),
          ...(props.columns as { field?: string, slot?: string }[])
            .filter(column => column.field)
            .map(column => h('td', column.slot
              ? slots[column.slot]?.({ row, rowIndex })
              : String(row[column.field!] ?? ''))),
        ]),
      )),
    ])
  },
})

const LookupSelectStub = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<button type="button" aria-label="选择关联项" @click="$emit(\'update:modelValue\', \'picked-id\')">{{ modelValue || \'选择\' }}</button>',
})

const KitButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: props.disabled || props.loading,
    }, slots.default?.())
  },
})

const global = {
  components: {
    KitButton: KitButtonStub,
    KitTable: KitTableStub,
    LookupSelect: LookupSelectStub,
  },
}

const columns = [
  { key: 'name', label: '名称', required: true, minWidth: 150 },
  { key: 'unit', label: '单位', type: 'select' as const, options: ['项', '㎡'] },
  { key: 'qty', label: '数量', type: 'number' as const, required: true },
  { key: 'unitPrice', label: '单价', type: 'number' as const },
  {
    key: 'amount',
    label: '金额',
    type: 'readonly' as const,
    derive: (row: Readonly<Record<string, unknown>>) =>
      Number(row.qty || 0) * Number(row.unitPrice || 0),
  },
]

function renderHarness(
  initialRows: Record<string, unknown>[] = [{
    name: '墙砖',
    unit: '㎡',
    qty: 2,
    unitPrice: 30,
  }],
  picker?: () => Promise<Record<string, unknown>[] | null>,
  max?: number,
) {
  const Harness = defineComponent({
    components: { KitEditGrid },
    setup() {
      const rows = shallowRef(initialRows)
      const grid = shallowRef<InstanceType<typeof KitEditGrid>>()
      const errorCount = shallowRef(0)
      async function validate() {
        errorCount.value = grid.value?.validate().length ?? 0
      }
      return { rows, grid, errorCount, validate }
    },
    template: `
      <form @submit.prevent="validate">
        <KitEditGrid
          ref="grid"
          v-model="rows"
          label="合同清单"
          :columns="columns"
          :summary="[{ key: 'amount', agg: 'sum' }]"
          :picker="picker ? { label: '选择清单', onPick: picker } : undefined"
          :max="max"
        />
        <button type="submit">校验明细</button>
        <output data-testid="rows-json">{{ JSON.stringify(rows) }}</output>
        <output data-testid="error-count">{{ errorCount }}</output>
      </form>
    `,
    data: () => ({ columns, max, picker }),
  })
  return render(Harness, { global })
}

describe('kit edit grid', () => {
  it('受控更新行内值、派生值和汇总，不修改只读派生列', async () => {
    renderHarness()

    const table = screen.getByRole('table', { name: '明细网格表格' })
    expect(within(table).getByText('60')).not.toBeNull()
    expect(screen.getByText('Σ 金额：60')).not.toBeNull()

    await fireEvent.update(screen.getByRole('spinbutton', { name: '数量，第 1 行' }), '3')

    expect(within(table).getByText('90')).not.toBeNull()
    expect(screen.getByText('Σ 金额：90')).not.toBeNull()
    expect(screen.getByTestId('rows-json').textContent).not.toContain('"amount"')
  })

  it('添加、复制选中和删除选中都通过 v-model 返回新数组', async () => {
    renderHarness()

    await fireEvent.click(screen.getByRole('button', { name: '添加行' }))
    expect(JSON.parse(screen.getByTestId('rows-json').textContent || '[]')).toHaveLength(2)

    await fireEvent.click(screen.getByRole('checkbox', { name: '选择第 1 行' }))
    await fireEvent.click(screen.getByRole('button', { name: '复制选中' }))
    expect(JSON.parse(screen.getByTestId('rows-json').textContent || '[]')).toHaveLength(3)

    await fireEvent.click(screen.getByRole('checkbox', { name: '选择第 1 行' }))
    await fireEvent.click(screen.getByRole('button', { name: '删除选中' }))
    expect(JSON.parse(screen.getByTestId('rows-json').textContent || '[]')).toHaveLength(2)
  })

  it('表单调用公开 validate 后标出必填单元格并返回错误定位', async () => {
    renderHarness([{ name: '', unit: '项', qty: null, unitPrice: 0 }])

    await fireEvent.click(screen.getByRole('button', { name: '校验明细' }))

    expect(screen.getByTestId('error-count').textContent).toBe('2')
    expect(screen.getByRole('textbox', { name: '名称，第 1 行' }).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('spinbutton', { name: '数量，第 1 行' }).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('2 处')
  })

  it('选择器批量插入返回行，取消不改变数据', async () => {
    const picker = vi.fn()
      .mockResolvedValueOnce([
        { name: '地砖', unit: '㎡', qty: 4, unitPrice: 20 },
        { name: '踢脚线', unit: 'm', qty: 5, unitPrice: 10 },
      ])
      .mockResolvedValueOnce(null)
    renderHarness([], picker)

    await fireEvent.click(screen.getByRole('button', { name: '选择清单' }))
    expect(JSON.parse(screen.getByTestId('rows-json').textContent || '[]')).toHaveLength(2)

    await fireEvent.click(screen.getByRole('button', { name: '选择清单' }))
    expect(JSON.parse(screen.getByTestId('rows-json').textContent || '[]')).toHaveLength(2)
  })

  it('批量插入超过最大行数时整批拒绝', async () => {
    const picker = vi.fn().mockResolvedValue([
      { name: '地砖', unit: '㎡', qty: 4, unitPrice: 20 },
      { name: '踢脚线', unit: 'm', qty: 5, unitPrice: 10 },
    ])
    renderHarness([{ name: '墙砖', unit: '㎡', qty: 2, unitPrice: 30 }], picker, 2)

    await fireEvent.click(screen.getByRole('button', { name: '选择清单' }))

    expect(JSON.parse(screen.getByTestId('rows-json').textContent || '[]')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toContain('最多只能保留 2 行')
  })
})
