import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import FinanceFormFields from '~/components/finance/FinanceFormFields.vue'

const SectionHeader = defineComponent({
  props: { title: { type: String, default: '' } },
  template: '<h2><slot />{{ title }}</h2>',
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
    ariaLabel: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      type="button"
      :data-select="ariaLabel"
      @click="$emit('update:modelValue', ariaLabel === '业务类型' ? '公司付款' : modelValue)"
    >
      {{ modelValue }}
    </button>
  `,
})

const KitButton = defineComponent({
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" type="button" @click="$emit(\'click\')"><slot /></button>',
})

const KitTable = defineComponent({
  props: { data: { type: Array, default: () => [] } },
  template: `
    <div>
      <div v-for="(row, rowIndex) in data" :key="rowIndex">
        <slot name="source" :row="row" :row-index="rowIndex" />
        <slot name="counterparty" :row="row" :row-index="rowIndex" />
        <slot name="original" :row="row" :row-index="rowIndex" />
        <slot name="date" :row="row" :row-index="rowIndex" />
        <slot name="amount" :row="row" :row-index="rowIndex" />
        <slot name="note" :row="row" :row-index="rowIndex" />
        <slot name="action" :row="row" :row-index="rowIndex" />
      </div>
    </div>
  `,
})

const fetchLookup = vi.fn(async () => [])

it.each([
  { input: '', expected: null },
  { input: '0', expected: 0 },
  { input: '12.50', expected: 12.5 },
])('批复输入 $input 携带独立输入意图；仅改备注不产生批复修改', async ({ input, expected }) => {
  const wrapper = mountFields('payment_application', { bizType: '公司付款', approvedAmount: 0, approvedAmountOrigin: 'legacy' })
  expect(wrapper.text()).toContain('历史批复待核验')
  const amount = wrapper.get('input[aria-describedby="approval-amount-help"]')
  await amount.setValue(input)
  expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ approvedAmount: expected, approvedAmountEdit: { value: expected } })
  await wrapper.get('#section-approval textarea').setValue('核对备注')
  expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ approvalNote: '核对备注' })
})

it('批复临时负数保持表单可编辑并提示修正，不能因读取金额而渲染异常', async () => {
  const wrapper = mountFields('payment_application', { bizType: '公司付款', approvedAmount: null })
  await wrapper.setProps({ draft: { bizType: '公司付款', approvedAmount: -1, approvedAmountEdit: { value: -1 } } })
  expect(wrapper.text()).toContain('请输入非负有效金额')
  expect(wrapper.get('input[aria-describedby="approval-amount-help"]').element).toHaveProperty('value', '-1')
})

function mountFields(
  kind: 'payment_application' | 'payment_record' | 'reimbursement',
  draft: Record<string, unknown>,
) {
  return mount(FinanceFormFields, {
    props: {
      kind,
      draft,
      fetchProjects: fetchLookup,
      fetchCustomers: fetchLookup,
      fetchSuppliers: fetchLookup,
      fetchWorkers: fetchLookup,
      fetchIncomeContracts: fetchLookup,
      fetchExpenseContracts: fetchLookup,
      fetchSettlements: fetchLookup,
      fetchInvoices: fetchLookup,
      fetchPaymentApplications: fetchLookup,
    },
    global: {
      components: {
        KitButton,
        LookupSelect,
        SectionHeader,
        SelectFilter,
      },
      stubs: {
        KitButton,
        KitTable,
        LookupSelect,
      },
    },
  })
}

describe('financeFormFields real-ID and detail-grid flow', () => {
  it('切换垫付身份后保留选择种类与历史原文，其他字段补录不会退回工人种类', async () => {
    const draft = { applicant: '原报销人文字', applicantWorkerId: null, applicantSupplierId: null, lines: [] }
    const wrapper = mountFields('reimbursement', draft)
    wrapper.getComponent(SelectFilter).vm.$emit('update:modelValue', 'supplier')
    await wrapper.setProps({ draft: { ...draft, reason: '补充报销事由' } })
    expect(wrapper.find('[data-placeholder="从全局工人清单选择"]').exists()).toBe(false)
    await wrapper.get('[data-placeholder="选择垫付分供方"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({ applicantSupplierId: 'lookup-real-id' })
    expect(wrapper.text()).toContain('原报销人文字')
  })

  it('父级替换未保存明细时移除旧可选引用和冻结名，显示行不保留上一份表单的来源', async () => {
    const wrapper = mountFields('reimbursement', { lines: [{ expenseItem: '旧费用', amount: 10, counterpartyNameSnapshot: '旧交易方快照', originalExpenseLineId: 'old-original' }] })
    expect(wrapper.text()).toContain('旧交易方快照')
    expect(wrapper.text()).toContain('old-original')
    await wrapper.setProps({ draft: { lines: [{ expenseItem: '新费用', amount: 20 }] } })
    expect(wrapper.text()).not.toContain('旧交易方快照')
    expect(wrapper.text()).not.toContain('old-original')
    expect(wrapper.get('[data-testid="reimbursement-item-0"]').element).toHaveProperty('value', '新费用')
    expect(wrapper.text()).toContain('20.00')
  })

  it('enforces project/contract cascade and emits real settlement IDs', async () => {
    const wrapper = mountFields('payment_application', {
      name: '',
      bizType: '有合同-材料',
      projectId: null,
      supplierId: null,
      contractId: null,
      applyAmount: 100,
      invoiceState: '先款后票',
      settlementAllocations: [{ settlementId: null, allocatedAmount: 100 }],
      invoiceAllocations: [],
    })

    expect(wrapper.get('[data-placeholder="检索支出合同"]').attributes('disabled'))
      .toBeDefined()
    await wrapper.get('[data-placeholder="检索项目"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      projectId: 'lookup-real-id',
      contractId: null,
      settlementAllocations: [],
    })

    await wrapper.setProps({
      draft: {
        name: '',
        bizType: '有合同-材料',
        projectId: 'project-real-id',
        supplierId: 'supplier-real-id',
        contractId: 'contract-real-id',
        applyAmount: 100,
        invoiceState: '先款后票',
        settlementAllocations: [{ settlementId: null, allocatedAmount: 100 }],
        invoiceAllocations: [],
      },
    })
    expect(wrapper.get('[data-placeholder="选择结算单"]').attributes('disabled'))
      .toBeUndefined()
    await wrapper.get('[data-placeholder="选择结算单"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      settlementAllocations: [
        expect.objectContaining({ settlementId: 'lookup-real-id' }),
      ],
    })
  })

  it('clears project and settlement state when switching to company payment', async () => {
    const wrapper = mountFields('payment_application', {
      name: '公司付款',
      bizType: '有合同-材料',
      projectId: 'project-real-id',
      contractId: 'contract-real-id',
      applyAmount: 10,
      invoiceState: '无需发票',
      settlementAllocations: [{ settlementId: 'settlement-real-id', allocatedAmount: 10 }],
      invoiceAllocations: [],
    })
    await wrapper.get('[data-select="业务类型"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      bizType: '公司付款',
      projectId: null,
      contractId: null,
      settlementAllocations: [],
    })
  })

  it('supports reimbursement add/copy/delete and derives total from lines', async () => {
    const wrapper = mountFields('reimbursement', {
      applicant: '王工',
      reimbursementDate: '2026-07-25',
      invoiceCount: 1,
      lines: [{
        expenseItem: '交通费',
        expenseDate: '2026-07-24',
        amount: 18.5,
        note: '',
      }],
    })
    expect(wrapper.text()).toContain('18.50')

    await wrapper.get('[title="复制"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      lines: [
        expect.objectContaining({ expenseItem: '交通费', amount: 18.5 }),
        expect.objectContaining({ expenseItem: '交通费', amount: 18.5 }),
      ],
    })
    await wrapper.get('[data-testid="add-grid-line"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      lines: [
        expect.objectContaining({ expenseItem: '交通费' }),
        expect.objectContaining({ expenseItem: '' }),
      ],
    })

    await wrapper.get('[data-testid="import-grid-tsv"]').trigger('click')
    await wrapper.get('[data-testid="grid-tsv-input"]').setValue('差旅费\t2026-07-25\t20\t出差')
    await wrapper.get('[data-testid="confirm-grid-import"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      lines: [
        expect.objectContaining({ expenseItem: '交通费' }),
        expect.objectContaining({ expenseItem: '差旅费', amount: 20 }),
      ],
    })
    expect(wrapper.get('[data-testid="toggle-grid-fullscreen"]').exists()).toBe(true)
  })

  it('shows payment allocation conservation and the mandatory manual-review boundary', async () => {
    const wrapper = mountFields('payment_record', {
      payeeName: '分供方',
      amount: 100,
      source: 'image_ocr',
      confirmationStatus: 'needs_review',
      applicationAllocations: [{
        paymentApplicationId: null,
        allocatedAmount: 80,
      }],
    })
    expect(wrapper.text()).toContain('差额 ¥ 20.00')
    expect(wrapper.text()).toContain('OCR 只负责预填')

    await wrapper.get('[data-placeholder="选择付款申请"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      applicationAllocations: [
        expect.objectContaining({ paymentApplicationId: 'lookup-real-id' }),
      ],
    })
  })
})
