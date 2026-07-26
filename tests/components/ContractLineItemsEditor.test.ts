import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ContractLineItemsEditor from '~/components/contract/ContractLineItemsEditor.vue'

const KitButton = defineComponent({
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
})

const SelectFilter = defineComponent({
  props: {
    modelValue: { type: String, default: '' },
    options: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  template: '<button type="button">{{ modelValue }}</button>',
})

function mountEditor(lines: Array<Record<string, unknown>> = []) {
  return mount(ContractLineItemsEditor, {
    props: { lines },
    global: {
      components: { KitButton, SelectFilter },
    },
  })
}

describe('contractLineItemsEditor', () => {
  it('adds, copies and deletes rows without mutating the incoming prop', async () => {
    const source = [{
      id: 'line-1',
      materialName: '瓷砖',
      unit: '㎡',
      qty: 2,
      taxInclusiveUnitPrice: 30,
    }]
    const wrapper = mountEditor(source)

    expect(wrapper.text()).toContain('60.00')
    await wrapper.get('[title="复制明细"]').trigger('click')
    const copied = wrapper.emitted('update')?.at(-1)?.[0] as typeof source
    expect(copied).toHaveLength(2)
    expect(copied[1]).toMatchObject({
      id: undefined,
      materialName: '瓷砖',
      qty: 2,
      taxInclusiveUnitPrice: 30,
    })
    expect(source).toHaveLength(1)

    await wrapper.setProps({ lines: copied })
    await wrapper.get('[title="删除明细"]').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([copied[1]])

    await wrapper.setProps({ lines: [] })
    await wrapper.get('[data-testid="add-contract-line"]').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      expect.objectContaining({
        materialName: '',
        qty: 1,
        taxInclusiveUnitPrice: 0,
      }),
    ])
  })

  it('derives amount after quantity and unit-price edits', async () => {
    const wrapper = mountEditor([{
      materialName: '砂浆',
      unit: '包',
      qty: 1,
      taxInclusiveUnitPrice: 10,
    }])

    await wrapper.get('[data-testid="contract-line-qty-0"]').setValue('3')
    const afterQty = wrapper.emitted('update')?.at(-1)?.[0] as Array<Record<string, unknown>>
    await wrapper.setProps({ lines: afterQty })
    await wrapper.get('[data-testid="contract-line-price-0"]').setValue('12.5')
    const afterPrice = wrapper.emitted('update')?.at(-1)?.[0] as Array<Record<string, unknown>>
    await wrapper.setProps({ lines: afterPrice })

    expect(wrapper.text()).toContain('37.50')
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
