import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import OwnerDocumentLineGrid from '~/components/owner-document/OwnerDocumentLineGrid.vue'

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
        <slot name="operation" :row="row" :row-index="rowIndex" />
        <slot name="boqLineId" :row="row" :row-index="rowIndex" />
        <slot name="itemName" :row="row" :row-index="rowIndex" />
        <slot name="unit" :row="row" :row-index="rowIndex" />
        <slot name="deltaQty" :row="row" :row-index="rowIndex" />
        <slot name="newUnitPrice" :row="row" :row-index="rowIndex" />
        <slot name="autoQty" :row="row" :row-index="rowIndex" />
        <slot name="reportedQty" :row="row" :row-index="rowIndex" />
        <slot name="auditedQty" :row="row" :row-index="rowIndex" />
        <slot name="unitPrice" :row="row" :row-index="rowIndex" />
        <slot name="amount" :row="row" :row-index="rowIndex" />
        <slot name="note" :row="row" :row-index="rowIndex" />
        <slot name="action" :row="row" :row-index="rowIndex" />
      </div>
    </div>
  `,
})

const global = {
  components: {
    KitButton,
    KitTable,
  },
}

const boqLines = [{
  id: 'boq-real-id',
  itemName: '墙砖铺贴',
  unit: '㎡',
  qty: 10,
  unitPrice: 20,
  autoQty: 3,
}]

describe('ownerDocumentLineGrid behavior', () => {
  it('fills a report line from the selected real BOQ id and derives its amount', async () => {
    const lines = [{
      boqLineId: '',
      itemName: '',
      unit: '',
      autoQty: 0,
      reportedQty: null,
      auditedQty: null,
      unitPrice: 0,
    }]
    const wrapper = mount(OwnerDocumentLineGrid, {
      props: {
        kind: 'owner_report',
        lines,
        boqLines,
      },
      global,
    })

    await wrapper.get('[aria-label="合同清单项"]').setValue('boq-real-id')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([{
      ...lines[0],
      boqLineId: 'boq-real-id',
      itemName: '墙砖铺贴',
      unit: '㎡',
      qty: 10,
      unitPrice: 20,
      autoQty: 3,
      reportedQty: 3,
    }])
  })

  it('keeps reported quantity locked during audit while audited quantity remains editable', async () => {
    const lines = [{
      boqLineId: 'boq-real-id',
      itemName: '墙砖铺贴',
      unit: '㎡',
      autoQty: 3,
      reportedQty: 2.5,
      auditedQty: null,
      unitPrice: 20,
    }]
    const wrapper = mount(OwnerDocumentLineGrid, {
      props: {
        kind: 'owner_report',
        lines,
        boqLines,
        readonly: true,
        auditMode: true,
      },
      global,
    })

    expect(wrapper.get('[aria-label="申报量"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="审定量"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[aria-label="审定量"]').setValue('2')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([{
      ...lines[0],
      auditedQty: 2,
    }])
  })

  it('derives change amount from the line operation without changing document type', () => {
    const wrapper = mount(OwnerDocumentLineGrid, {
      props: {
        kind: 'owner_change',
        lines: [{
          operation: 'qty',
          boqLineId: 'boq-real-id',
          itemName: '墙砖铺贴',
          unit: '㎡',
          qty: 10,
          unitPrice: 20,
          deltaQty: 2,
          newUnitPrice: null,
        }],
        boqLines,
      },
      global,
    })

    expect(wrapper.text()).toContain('合计 ¥40.00')
    expect(wrapper.text()).toContain('40.00')
  })

  it('renders a focusable detail error and gives row actions distinct keyboard names', async () => {
    const wrapper = mount(OwnerDocumentLineGrid, {
      props: {
        kind: 'owner_change',
        lines: [{
          operation: 'qty',
          itemName: '',
          unit: '',
          deltaQty: null,
          newUnitPrice: null,
        }],
        boqLines,
        error: '至少填写一条有效的变更明细',
      },
      attachTo: document.body,
      global,
    })

    const alert = wrapper.get('[data-field="lines"]')
    expect(alert.attributes('tabindex')).toBe('-1')
    await alert.element.focus()
    expect(document.activeElement).toBe(alert.element)
    expect(wrapper.get('[aria-label="复制第 1 行"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="删除第 1 行"]').exists()).toBe(true)

    wrapper.unmount()
  })
})
