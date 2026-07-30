import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import CustomerDetailScreen from '~/components/master-data/CustomerDetailScreen.vue'

const route = reactive({
  query: {} as Record<string, string>,
})
const routerReplace = vi.fn()
const load = vi.fn().mockResolvedValue(undefined)

const detail = {
  customer: {
    id: 'customer-1',
    name: '合和地产集团',
    aliases: ['合和地产'],
    taxNo: '91440101TEST',
    legalRep: '何先生',
    registeredAddress: '广州市天河区',
    invoiceName: '合和地产集团',
    bank: '建设银行',
    bankAccount: '62270001',
    contact: '林经理',
    contactPhone: '13800000001',
    status: 'active',
    note: '重点客户',
    updatedAt: '2026-07-29',
  },
  projects: [{ id: 'project-1' }, { id: 'project-2' }],
  contracts: [{ id: 'contract-1' }],
  receipts: [{ id: 'receipt-1' }, { id: 'receipt-2' }, { id: 'receipt-3' }],
  summary: {
    projectCount: 2,
    contractCount: 1,
    effectiveContractAmount: 1000000,
    receiptCount: 3,
    effectiveReceiptAmount: 320000,
    outstandingAmount: 680000,
    draftReceiptCount: 0,
  },
}

const EntityDetailShellStub = defineComponent({
  props: ['title'],
  template: `
    <main>
      <h1>{{ title }}</h1>
      <slot name="mark" />
      <slot name="status" />
      <slot name="actions" />
      <slot name="summary" />
      <slot />
    </main>
  `,
})

const SegTabStub = defineComponent({
  props: ['modelValue', 'tabs'],
  emits: ['update:modelValue'],
  template: `
    <div role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        role="tab"
        :aria-selected="modelValue === tab.key"
        @click="$emit('update:modelValue', tab.key)"
      >
        {{ tab.label }} {{ tab.count }}
      </button>
    </div>
  `,
})

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useRouter', () => ({ replace: routerReplace }))
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('useCustomerDetailStore', () => ({
  byCustomer: () => detail,
  load,
}))

describe('客户详情业务页签', () => {
  beforeEach(() => {
    route.query = {}
    routerReplace.mockReset()
    load.mockClear()
  })

  it('从 query 恢复页签，展示真实数量并在切换时保留其他 query', async () => {
    route.query = { tab: 'contracts', from: 'list' }
    render(CustomerDetailScreen, {
      props: { customerId: 'customer-1' },
      global: {
        components: {
          EntityDetailShell: EntityDetailShellStub,
          SegTab: SegTabStub,
          CustomerDetailOverview: defineComponent({ template: '<section>客户概览</section>' }),
          CustomerDetailRelations: defineComponent({
            props: ['tab'],
            template: '<section data-testid="active-relation">{{ tab }}</section>',
          }),
          MetricGrid: defineComponent({ template: '<div><slot /></div>' }),
          Metric: defineComponent({ template: '<span />' }),
          NuxtLink: defineComponent({ template: '<a><slot /></a>' }),
        },
      },
    })

    expect(screen.getByRole('tab', { name: '施工合同 1' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '名下项目 2' })).not.toBeNull()
    expect(screen.getByRole('tab', { name: '收款明细 3' })).not.toBeNull()
    expect(screen.getByTestId('active-relation').textContent).toBe('contracts')

    await fireEvent.click(screen.getByRole('tab', { name: '收款明细 3' }))
    expect(routerReplace).toHaveBeenLastCalledWith({
      query: { tab: 'receipts', from: 'list' },
    })

    await fireEvent.click(screen.getByRole('tab', { name: '名下项目 2' }))
    expect(routerReplace).toHaveBeenLastCalledWith({
      query: { from: 'list' },
    })
  })

  it('无效 query 回退到名下项目', () => {
    route.query = { tab: 'unknown' }
    render(CustomerDetailScreen, {
      props: { customerId: 'customer-1' },
      global: {
        components: {
          EntityDetailShell: EntityDetailShellStub,
          SegTab: SegTabStub,
          CustomerDetailOverview: defineComponent({ template: '<section />' }),
          CustomerDetailRelations: defineComponent({
            props: ['tab'],
            template: '<section data-testid="active-relation">{{ tab }}</section>',
          }),
          MetricGrid: defineComponent({ template: '<div><slot /></div>' }),
          Metric: defineComponent({ template: '<span />' }),
          NuxtLink: defineComponent({ template: '<a><slot /></a>' }),
        },
      },
    })

    expect(screen.getByTestId('active-relation').textContent).toBe('projects')
  })
})
