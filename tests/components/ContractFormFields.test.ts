import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import ContractFormFields from '~/components/contract/ContractFormFields.vue'

const SectionHeader = defineComponent({
  props: { title: { type: String, required: true } },
  template: '<h2>{{ title }}</h2>',
})

const LookupSelect = defineComponent({
  props: {
    modelValue: { type: String, default: null },
    disabledReason: { type: String, default: '' },
    placeholder: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      type="button"
      :data-placeholder="placeholder"
      :disabled="Boolean(disabledReason)"
      @click="$emit('update:modelValue', 'lookup-real-id')"
    >
      {{ placeholder }}
    </button>
  `,
})

const SelectFilter = defineComponent({
  props: {
    modelValue: { type: String, default: '' },
    options: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  template: '<button type="button">{{ modelValue }}</button>',
})

const fetchLookup = vi.fn(async () => [])

function mountFields(
  kind: 'construction' | 'other_settlement' | 'company_expense',
  draft: Record<string, unknown>,
  editing = false,
) {
  return mount(ContractFormFields, {
    props: {
      kind,
      editing,
      draft,
      fieldErrors: {},
      fetchProjects: fetchLookup,
      fetchCustomers: fetchLookup,
      fetchSuppliers: fetchLookup,
      fetchOriginalContracts: fetchLookup,
      fetchOtherExpenseContracts: fetchLookup,
    },
    global: {
      components: {
        LookupSelect,
        SelectFilter,
        SectionHeader,
      },
    },
  })
}

describe('contractFormFields lookup data flow', () => {
  it('enforces project-first settlement cascade and emits selected real IDs', async () => {
    const wrapper = mountFields('other_settlement', {
      name: '',
      projectId: null,
      contractId: null,
      totalAmount: 0,
    })
    const project = wrapper.get('[data-placeholder="检索项目"]')
    const contract = wrapper.get('[data-placeholder="检索其他支出合同"]')
    expect(contract.attributes('disabled')).toBeDefined()

    await project.trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({
      projectId: 'lookup-real-id',
    })

    await wrapper.setProps({
      draft: {
        name: '',
        projectId: 'project-real-id',
        contractId: null,
        totalAmount: 0,
      },
    })
    expect(wrapper.get('[data-placeholder="检索其他支出合同"]').attributes('disabled'))
      .toBeUndefined()
    await wrapper.get('[data-placeholder="检索其他支出合同"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({
      contractId: 'lookup-real-id',
    })
  })

  it('keeps company expense independent from project lookup', () => {
    const wrapper = mountFields('company_expense', {
      name: '',
      counterparty: '',
      amount: 0,
    })
    expect(wrapper.find('[data-placeholder="检索项目"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('对方单位')
  })

  it('locks main/supplement identity while editing', () => {
    const wrapper = mountFields('construction', {
      isSupplement: false,
      name: '既有施工合同',
      status: '草稿',
      amount: 0,
    }, true)
    expect(wrapper.get('[data-testid="contract-is-supplement"]').attributes('disabled'))
      .toBeDefined()
  })
})
