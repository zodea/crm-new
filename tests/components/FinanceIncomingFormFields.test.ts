import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import FinanceIncomingFormFields from '~/components/finance/FinanceIncomingFormFields.vue'

const SectionHeader = defineComponent({
  template: '<h2><slot /></h2>',
})

const LookupSelect = defineComponent({
  props: {
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
  template: '<button type="button"><slot /></button>',
})

function mountReceipt(projectId: string | null = null, customerId: string | null = null) {
  return mount(FinanceIncomingFormFields, {
    props: {
      kind: 'receipt',
      draft: {
        projectId,
        customerId,
        contractId: null,
        receiptDate: '2026-07-21',
        amount: 88,
      },
      fetchProjects: vi.fn(async () => []),
      fetchCustomers: vi.fn(async () => []),
      fetchIncomeContracts: vi.fn(async () => []),
    },
    global: {
      components: { LookupSelect, SectionHeader, SelectFilter },
    },
  })
}

describe('financeIncomingFormFields 收款登记', () => {
  it('先选项目再选项目甲方客户，并固定展示我方乙方为收款方', async () => {
    const wrapper = mountReceipt()

    expect(wrapper.text()).toContain('收款方（我方乙方）')
    expect(wrapper.get('[data-testid="receipt-payee"]').text()).toBe('我方乙方')
    expect(wrapper.get('[data-placeholder="检索客户"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-placeholder="检索客户"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      customerId: 'lookup-real-id',
    })

    await wrapper.get('[data-placeholder="检索项目"]').trigger('click')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toMatchObject({
      projectId: 'lookup-real-id',
      contractId: null,
    })
  })
})
