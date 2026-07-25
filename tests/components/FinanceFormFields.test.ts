import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import FinanceFormFields from '~/components/finance/FinanceFormFields.vue'

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

const fetchLookup = vi.fn(async () => [])

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
    },
  })
}

describe('financeFormFields real-ID and detail-grid flow', () => {
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
    expect(wrapper.get('[data-placeholder="选择真实结算单"]').attributes('disabled'))
      .toBeUndefined()
    await wrapper.get('[data-placeholder="选择真实结算单"]').trigger('click')
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
    await wrapper.get('[data-testid="add-reimbursement-line"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      lines: [
        expect.objectContaining({ expenseItem: '交通费' }),
        expect.objectContaining({ expenseItem: '' }),
      ],
    })
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
