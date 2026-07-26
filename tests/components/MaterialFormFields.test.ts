import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import MaterialFormFields from '~/components/material/MaterialFormFields.vue'

const SectionHeader = defineComponent({
  props: { title: { type: String, required: true } },
  template: '<h2>{{ title }}</h2>',
})

const LookupSelect = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: null },
    disabledReason: { type: String, default: '' },
    placeholder: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      v-bind="$attrs"
      type="button"
      :data-disabled-reason="disabledReason"
      :disabled="Boolean(disabledReason)"
      @click="$emit('update:modelValue', 'lookup-real-id')"
    >
      {{ placeholder }}
    </button>
  `,
})

const SelectFilter = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      v-bind="$attrs"
      type="button"
      :disabled="disabled"
      @click="$emit('update:modelValue', '中心仓')"
    >
      {{ modelValue }}
    </button>
  `,
})

const fetchLookup = vi.fn(async () => [])

function mountFields(
  kind: 'mat_requisition' | 'owner_control',
  draft: Record<string, unknown>,
  readonly = false,
) {
  return mount(MaterialFormFields, {
    props: {
      kind,
      draft,
      fieldErrors: {},
      readonly,
      fetchProjects: fetchLookup,
      fetchCustomers: fetchLookup,
      fetchSuppliers: fetchLookup,
      fetchContracts: fetchLookup,
      fetchRequisitions: fetchLookup,
      fetchCrews: fetchLookup,
    },
    global: {
      components: {
        LookupSelect,
        SectionHeader,
        SelectFilter,
      },
    },
  })
}

describe('materialFormFields data flow', () => {
  it('emits numeric values and enforces the project-first contract cascade', async () => {
    const wrapper = mountFields('mat_requisition', {
      projectId: null,
      contractId: null,
      plannedQty: 0,
      warehouse: '中心仓',
    })

    const contract = wrapper.get('[data-testid="material-contractId"]')
    expect(contract.attributes('disabled')).toBeDefined()
    expect(contract.attributes('data-disabled-reason')).toBe('请先选择项目')

    await wrapper.get('[data-testid="material-plannedQty"]').setValue('12.5')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ plannedQty: 12.5 })
    expect(wrapper.emitted('clearError')?.at(-1)?.[0]).toBe('plannedQty')

    await wrapper.setProps({
      draft: {
        projectId: 'project-real-id',
        contractId: null,
        plannedQty: 12.5,
        warehouse: '中心仓',
      },
    })
    expect(wrapper.get('[data-testid="material-contractId"]').attributes('disabled'))
      .toBeUndefined()
  })

  it('renders derived owner-control quantities and locks every editable field after effective', () => {
    const wrapper = mountFields('owner_control', {
      projectId: 'project-real-id',
      customerId: 'customer-real-id',
      materialName: '瓷砖',
      spec: '600×600',
      unit: '㎡',
      controlQty: 100,
      arrivedQty: 40,
      usedQty: 15,
      remainingQty: 85,
      stockQty: 25,
    }, true)

    expect(wrapper.get('[data-testid="material-arrivedQty"]').text()).toBe('40')
    expect(wrapper.get('[data-testid="material-remainingQty"]').text()).toBe('85')
    expect(wrapper.get('[data-testid="material-stockQty"]').text()).toBe('25')
    expect(wrapper.get('[data-testid="material-materialName"]').attributes('disabled'))
      .toBeDefined()
    expect(wrapper.get('[data-testid="material-projectId"]').attributes('data-disabled-reason'))
      .toBe('已生效单据不可修改')
  })

  it('translates internal stock status values for operators', () => {
    const wrapper = mount(MaterialFormFields, {
      props: {
        kind: 'mat_arrival',
        draft: {
          projectId: null,
          supplierId: null,
          warehouse: '中心仓',
          qualityResult: '合格',
          stockStatus: 'pending',
        },
        fieldErrors: {},
        fetchProjects: fetchLookup,
        fetchCustomers: fetchLookup,
        fetchSuppliers: fetchLookup,
        fetchContracts: fetchLookup,
        fetchRequisitions: fetchLookup,
        fetchCrews: fetchLookup,
      },
      global: {
        components: {
          LookupSelect,
          SectionHeader,
          SelectFilter,
        },
      },
    })

    expect(wrapper.get('[data-testid="material-stockStatus"]').text()).toBe('待入库')
  })
})
