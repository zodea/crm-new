import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ContractLineItemsEditor from '~/components/contract/ContractLineItemsEditor.vue'

const KitButton = defineComponent({
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
})

const KitEditGrid = defineComponent({
  props: {
    modelValue: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  setup(props) {
    return () => h('div', { 'data-testid': 'kit-edit-grid' }, [
      h('output', { 'data-testid': 'grid-row-count' }, String(props.modelValue.length)),
    ])
  },
})

function mountEditor(lines: Array<Record<string, unknown>> = []) {
  return mount(ContractLineItemsEditor, {
    props: { lines },
    global: {
      components: { KitButton, KitEditGrid },
    },
  })
}

describe('contractLineItemsEditor', () => {
  it('adds a domain-default row without mutating the incoming prop', async () => {
    const source = [{
      id: 'line-1',
      materialName: '瓷砖',
      unit: '㎡',
      qty: 2,
      taxInclusiveUnitPrice: 30,
    }]
    const wrapper = mountEditor(source)

    expect(source).toHaveLength(1)

    await wrapper.get('[data-testid="add-contract-line"]').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      source[0],
      expect.objectContaining({
        materialName: '',
        qty: 1,
        taxInclusiveUnitPrice: 0,
      }),
    ])
  })

  it('configures the shared edit grid with derived amount and forwards controlled updates', async () => {
    const wrapper = mountEditor([{
      materialName: '砂浆',
      unit: '包',
      qty: 1,
      taxInclusiveUnitPrice: 10,
    }])

    const grid = wrapper.findComponent(KitEditGrid)
    const amountColumn = (grid.props('columns') as Array<{
      key: string
      derive?: (row: Record<string, unknown>) => unknown
    }>).find(column => column.key === 'amount')
    expect(amountColumn?.derive?.({
      materialName: '砂浆',
      qty: 3,
      taxInclusiveUnitPrice: 12.5,
    })).toBe(37.5)

    const updated = [{
      materialName: '砂浆',
      unit: '包',
      qty: 3,
      taxInclusiveUnitPrice: 12.5,
    }]
    grid.vm.$emit('update:modelValue', updated)
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual(updated)
  })

  it('imports Excel TSV rows in editable-column order', async () => {
    const wrapper = mountEditor()
    await wrapper.get('[data-testid="import-contract-lines"]').trigger('click')
    await wrapper.get('[data-testid="contract-lines-tsv"]').setValue(
      '瓷砖\t600×600\t品牌A\t㎡\t10\t23.8\t2026-08-01\t首批',
    )
    await wrapper.get('[data-testid="confirm-contract-lines-import"]').trigger('click')

    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([{
      materialName: '瓷砖',
      spec: '600×600',
      brand: '品牌A',
      unit: '㎡',
      qty: 10,
      taxInclusiveUnitPrice: 23.8,
      plannedArrivalDate: '2026-08-01',
      note: '首批',
    }])
  })
})
