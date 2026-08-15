import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import MaterialLineGrid from '~/components/material/MaterialLineGrid.vue'

const SectionHeader = defineComponent({
  props: { title: { type: String, required: true } },
  template: '<h2>{{ title }}</h2>',
})

const KitButton = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  emits: ['click'],
  template: `
    <button
      v-bind="$attrs"
      type="button"
      :disabled="disabled || loading"
      @click="$emit('click')"
    >
      <slot />
    </button>
  `,
})

const KitTable = defineComponent({
  props: {
    data: { type: Array, required: true },
  },
  template: `
    <div>
      <div v-for="(row, rowIndex) in data" :key="rowIndex">
        <slot name="materialName" :row="row" :row-index="rowIndex" />
        <slot name="spec" :row="row" :row-index="rowIndex" />
        <slot name="unit" :row="row" :row-index="rowIndex" />
        <slot name="qty" :row="row" :row-index="rowIndex" />
        <slot name="unitPrice" :row="row" :row-index="rowIndex" />
        <slot name="amount" :row="row" :row-index="rowIndex" />
        <slot name="bookQty" :row="row" :row-index="rowIndex" />
        <slot name="actualQty" :row="row" :row-index="rowIndex" />
        <slot name="varianceQty" :row="row" :row-index="rowIndex" />
        <slot name="varianceAmount" :row="row" :row-index="rowIndex" />
        <slot name="action" :row="row" :row-index="rowIndex" />
      </div>
    </div>
  `,
})

const global = {
  components: {
    KitButton,
    KitTable,
    SectionHeader,
  },
}

describe('materialLineGrid behavior', () => {
  it('derives arrival amount and emits a numeric line patch', async () => {
    const lines = [{
      materialName: '瓷砖',
      spec: '600×600',
      unit: '㎡',
      qty: 3,
      unitPrice: 12.5,
      note: '',
    }]
    const wrapper = mount(MaterialLineGrid, {
      props: { kind: 'mat_arrival', lines },
      global,
    })

    expect(wrapper.text()).toContain('数量 3.000 · 含税金额 ¥37.50')
    expect(wrapper.text()).toContain('37.50')

    await wrapper.get('[aria-label="到货数量"]').setValue('4')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([{
      ...lines[0],
      qty: 4,
    }])
  })

  it('保留未定价到货行，不将缺失单价显示为零金额', async () => {
    const wrapper = mount(MaterialLineGrid, {
      props: {
        kind: 'mat_arrival',
        lines: [{
          materialName: '砂浆',
          spec: '',
          unit: '吨',
          qty: 2,
          unitPrice: null,
          note: '',
        }],
      },
      global,
    })

    expect(wrapper.text()).toContain('数量 2.000 · 含税金额 待补')
    expect(wrapper.get('[data-testid="arrival-line-amount"]').text()).toBe('待补')

    await wrapper.get('[data-testid="add-material-line"]').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      expect.objectContaining({ materialName: '砂浆', unitPrice: null }),
      expect.objectContaining({ materialName: '', unitPrice: null }),
    ])
  })

  it('refreshes stock-check book quantities and keeps variance derived', async () => {
    const resolveBookQty = vi.fn(async () => 8)
    const lines = [{
      materialName: '钢筋',
      spec: 'HRB400',
      unit: 't',
      bookQty: 5,
      actualQty: 7,
      varianceAmount: 20,
    }]
    const wrapper = mount(MaterialLineGrid, {
      props: {
        kind: 'stock_check',
        lines,
        resolveBookQty,
      },
      global,
    })

    expect(wrapper.text()).toContain('盘点 1 项 · 盈亏 2.000 · ¥20.00')
    expect(wrapper.text()).toContain('2.000')

    await wrapper.get('[data-testid="refresh-book-qty"]').trigger('click')
    expect(resolveBookQty).toHaveBeenCalledWith(lines[0])
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([{
      ...lines[0],
      bookQty: 8,
    }])
  })
})
