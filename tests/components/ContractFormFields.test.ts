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
    invalid: { type: Boolean, default: false },
    descriptionId: { type: String, default: '' },
    placeholder: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      type="button"
      :data-placeholder="placeholder"
      :disabled="Boolean(disabledReason)"
      :aria-invalid="invalid"
      :aria-describedby="descriptionId || undefined"
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
  template: '<button type="button" :data-options="options.map(option => option.label).join(\',\')">{{ modelValue }}</button>',
})

const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
})

const fetchLookup = vi.fn(async () => [])

function mountFields(
  kind: 'construction' | 'other_settlement' | 'material_settlement' | 'company_expense',
  draft: Record<string, unknown>,
  editing = false,
  extraProps: Record<string, unknown> = {},
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
      ...extraProps,
    },
    global: {
      components: {
        LookupSelect,
        NuxtLink,
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
    expect(wrapper.get('[aria-label="公司支出状态"]').attributes('data-options'))
      .toContain('履约中,已结清')
  })

  it('shows settlement tax facts, real contract summary and confirmation statuses', async () => {
    const wrapper = mountFields('material_settlement', {
      name: '材料结算',
      projectId: 'project-real-id',
      contractId: 'contract-real-id',
      totalAmount: 113,
      amount: 100,
      taxAmount: 13,
      taxRate: 13,
      settlementDate: '2026-07-30',
      status: '待确认',
    }, false, {
      selectedContract: {
        projectName: '项目甲',
        supplierName: '供方乙',
        amount: 500,
        paid: 120,
      },
    })

    expect(wrapper.text()).toContain('项目甲')
    expect(wrapper.text()).toContain('供方乙')
    expect(wrapper.text()).toContain('500.00')
    expect(wrapper.text()).toContain('120.00')
    expect(wrapper.get('[aria-label="结算状态"]').attributes('data-options'))
      .toContain('待确认,已确认')

    await wrapper.get('[data-testid="settlement-tax-amount"]').setValue('15')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ taxAmount: 15 })
  })

  it('marks ordinary required controls with aria-invalid', () => {
    const wrapper = mount(ContractFormFields, {
      props: {
        kind: 'other_settlement',
        draft: {
          name: '',
          projectId: null,
          contractId: null,
          totalAmount: 0,
          settlementDate: '',
        },
        fieldErrors: {
          name: '结算名称为必填项',
          projectId: '项目为必填项',
        },
        fetchProjects: fetchLookup,
        fetchCustomers: fetchLookup,
        fetchSuppliers: fetchLookup,
        fetchOriginalContracts: fetchLookup,
        fetchOtherExpenseContracts: fetchLookup,
      },
      global: {
        components: { LookupSelect, SelectFilter, SectionHeader },
      },
    })

    expect(wrapper.get('[data-testid="settlement-name"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[data-placeholder="检索项目"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[data-testid="settlement-name"]').attributes('aria-describedby'))
      .toBe('contract-form-other_settlement-name-error')
    expect(wrapper.get('[data-placeholder="检索项目"]').attributes('aria-describedby'))
      .toBe('contract-form-other_settlement-projectId-error')
    expect(wrapper.get('#contract-form-other_settlement-name-error').text())
      .toBe('结算名称为必填项')
  })

  it('explains when the selected project has no eligible settlement contract', () => {
    const wrapper = mountFields('other_settlement', {
      name: '',
      projectId: 'project-without-contract',
      contractId: null,
      totalAmount: 0,
      settlementDate: '',
      status: '草稿',
    }, false, {
      eligibleSettlementContractCount: 0,
    })

    expect(wrapper.get('[role="status"]').text()).toContain('当前项目暂无可结算的其他支出合同')
    expect(wrapper.get('[role="status"] a').attributes('href')).toBe('/contract/other-expense')
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
