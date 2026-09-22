import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import TargetCostItemEditor from '~/components/target-cost/TargetCostItemEditor.vue'

const KitButton = defineComponent({
  emits: ['click'],
  setup(_, { emit, slots }) {
    return () => h('button', { type: 'button', onClick: () => emit('click') }, slots.default?.())
  },
})

const KitEditGrid = defineComponent({
  props: ['modelValue', 'columns', 'rowOps', 'summary', 'readonly'],
  emits: ['update:modelValue'],
  setup(props, { emit, expose, slots }) {
    const errors = shallowRef<{ row: number, key: string, message?: string }[]>([])
    const focused = shallowRef(false)
    expose({
      setErrors: (next: { row: number, key: string, message?: string }[]) => {
        errors.value = next
      },
      focusFirstError: async () => {
        focused.value = true
        return true
      },
    })
    return () => h('div', { 'data-testid': 'target-cost-grid' }, [
      h('span', `${props.columns.length} 列`),
      h('output', { 'data-testid': 'grid-errors' }, JSON.stringify(errors.value)),
      focused.value ? h('span', { 'data-testid': 'grid-focused' }) : null,
      ...props.modelValue.map((row: unknown, rowIndex: number) => slots['cell-order']?.({ row, rowIndex })),
      h('button', {
        type: 'button',
        onClick: () => emit('update:modelValue', [
          ...props.modelValue,
          { category: '材料', itemName: '新增行', amount: 10 },
        ]),
      }, '模拟新增'),
    ])
  },
})

describe('target cost item editor', () => {
  it('uses the shared edit grid contract and exposes validation', async () => {
    const wrapper = mount(TargetCostItemEditor, {
      props: {
        modelValue: [],
        saving: false,
      },
      global: {
        components: { KitButton, KitEditGrid },
      },
    })

    const grid = wrapper.findComponent(KitEditGrid)
    expect(grid.props('rowOps')).toEqual(['add', 'copy', 'del'])
    expect(grid.props('summary')).toEqual([{ key: 'amount', agg: 'sum' }])
    expect(grid.props('columns').map((column: { key: string }) => column.key)).toEqual([
      'category',
      'itemName',
      'unit',
      'qty',
      'unitPrice',
      'amount',
      'note',
      'order',
    ])
    expect(await (wrapper.vm as unknown as { validate: () => Promise<unknown[]> }).validate())
      .toEqual([])

    await wrapper.get('[data-testid="target-cost-grid"] button').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
      { category: '材料', itemName: '新增行', amount: 10 },
    ])
  })

  it('preserves row identity and nullable values when moving rows, then applies server cell errors', async () => {
    const rows = [{ id: 'a', category: '材料', itemName: '空数量', qty: null, unitPrice: null, amount: 0 }, { id: 'b', category: '机械', itemName: '真实零', qty: 0, unitPrice: 0, amount: 100 }]
    const wrapper = mount(TargetCostItemEditor, { props: { modelValue: rows, saving: false }, global: { components: { KitButton, KitEditGrid } } })
    await wrapper.get('button[aria-label="第 2 行上移"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([rows[1], rows[0]])
    await (wrapper.vm as unknown as { setServerErrors: (value: Record<string, string>) => Promise<void> }).setServerErrors({ 'items.1.amount': '该行金额无效' })
    expect(JSON.parse(wrapper.get('[data-testid="grid-errors"]').text())).toEqual([{ row: 1, key: 'amount', message: '该行金额无效' }])
    expect(wrapper.find('[data-testid="grid-focused"]').exists()).toBe(true)
    await wrapper.setProps({ saving: true })
    expect(wrapper.findComponent(KitEditGrid).props('readonly')).toBe(true)
  })

  it('emits explicit save and cancel actions', async () => {
    const wrapper = mount(TargetCostItemEditor, {
      props: {
        modelValue: [],
        saving: false,
      },
      global: {
        components: { KitButton, KitEditGrid },
      },
    })

    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '保存科目明细')!.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('returns row-and-field domain errors to the grid and focuses the first invalid cell', async () => {
    const wrapper = mount(TargetCostItemEditor, {
      props: {
        modelValue: [{
          category: '非法科目',
          itemName: ' ',
          qty: -1,
          unitPrice: Number.NaN,
          amount: -20,
        }],
        saving: false,
      },
      global: {
        components: { KitButton, KitEditGrid },
      },
    })

    const errors = await (wrapper.vm as unknown as {
      validate: () => Promise<{ row: number, key: string, message: string }[]>
    }).validate()

    expect(errors).toEqual([
      { row: 0, key: 'category', message: '成本科目不在可选范围' },
      { row: 0, key: 'itemName', message: '分项名称为必填项' },
      { row: 0, key: 'qty', message: '数量必须是非负数' },
      { row: 0, key: 'unitPrice', message: '单价必须是非负数' },
      { row: 0, key: 'amount', message: '目标金额必须是非负数' },
    ])
    expect(JSON.parse(wrapper.get('[data-testid="grid-errors"]').text())).toEqual(errors)
    expect(wrapper.find('[data-testid="grid-focused"]').exists()).toBe(true)
  })
})
