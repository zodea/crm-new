import { within } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import ContractFormFields from '~/components/contract/ContractFormFields.vue'
import { f2FormDefaults } from '~/lib/contract/page'

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
  kind: 'material' | 'construction' | 'other_settlement' | 'material_settlement' | 'company_expense',
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
  it('总合同配置输入保留空与零，只在施工主合同显示，金额不自动跟随合同总额', async () => {
    const wrapper = mountFields('construction', { amount: 5000, managementFeeAmount: null, managementFeeBasis: '' })
    const amount = wrapper.get('[data-testid="contract-management-fee-amount"]')
    expect((amount.element as HTMLInputElement).value).toBe('')
    await amount.setValue('0')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ managementFeeAmount: 0 })
    await amount.setValue('')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ managementFeeAmount: null })
    await wrapper.get('[data-testid="contract-management-fee-basis"]').setValue('合同原件第八条')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ managementFeeBasis: '合同原件第八条' })
    await wrapper.setProps({ draft: { amount: 9000, managementFeeAmount: 0, managementFeeBasis: '合同原件第八条' } })
    expect((amount.element as HTMLInputElement).value).toBe('0')
    await wrapper.setProps({ kind: 'material' })
    expect(wrapper.find('[data-testid="contract-management-fee-amount"]').exists()).toBe(false)
    await wrapper.setProps({ kind: 'construction', draft: { isSupplement: true } })
    expect(wrapper.find('[data-testid="contract-management-fee-amount"]').exists()).toBe(false)
  })
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

describe('合同税率录入', () => {
  it.each(['construction', 'subcontract', 'material', 'other_expense'] as const)('新 %s 合同不预先认定适用税率', (kind) => {
    expect(f2FormDefaults(kind)).toMatchObject({ taxRate: null })
  })

  it.each([
    { amount: 113, taxRate: null, net: '113.00', tax: '0.00' },
    { amount: null, taxRate: 13, net: '—', tax: '—' },
    { amount: 113, taxRate: 0, net: '113.00', tax: '0.00' },
    { amount: 103, taxRate: 3, net: '100.00', tax: '3.00' },
    { amount: 106, taxRate: 6, net: '100.00', tax: '6.00' },
    { amount: 109, taxRate: 9, net: '100.00', tax: '9.00' },
    { amount: 113, taxRate: 13, net: '100.00', tax: '13.00' },
    { amount: 0, taxRate: 13, net: '0.00', tax: '0.00' },
    { amount: 113.01, taxRate: 13, net: '100.01', tax: '13.00' },
    { amount: 113, taxRate: -1, net: '—', tax: '—' },
    { amount: 113, taxRate: Number.NaN, net: '—', tax: '—' },
  ])('含税金额 $amount / 税率 $taxRate 独立派生无税金额 $net、税额 $tax', ({ amount, taxRate, net, tax }) => {
    const wrapper = mountFields('material', { amount, taxRate })
    const fields = within(wrapper.element as HTMLElement)
    expect(within(fields.getByText('无税金额', { exact: true }).parentElement!).getByText(net, { exact: true })).not.toBeNull()
    expect(within(fields.getByText('税额', { exact: true }).parentElement!).getByText(tax, { exact: true })).not.toBeNull()
    wrapper.unmount()
  })

  it.each([
    { selected: 'unknown', expected: null },
    { selected: '0', expected: 0 },
    { selected: '3', expected: 3 },
    { selected: '13', expected: 13 },
  ])('税率选择 $selected 保存 $expected，未填事实与明确零分别保留', ({ selected, expected }) => {
    const wrapper = mountFields('material', { amount: 113, taxRate: null })
    const rate = wrapper.findAllComponents({ name: 'SelectFilter' }).find(field => field.attributes('aria-label') === '税率')!
    expect(rate.props('modelValue')).toBe('unknown')
    rate.vm.$emit('update:modelValue', selected)
    expect(wrapper.emitted('patch')?.at(-1)).toEqual([{ taxRate: expected }])
    wrapper.unmount()
  })
})
