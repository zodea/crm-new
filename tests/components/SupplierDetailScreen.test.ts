import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import SupplierDetailScreen from '~/components/supplier/SupplierDetailScreen.vue'

const supplierStoreMock = vi.hoisted(() => ({
  detailState: { kind: 'idle' } as any,
  loadDetail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~/stores/supplier-read', () => ({ useSupplierReadStore: () => supplierStoreMock }))

const route = reactive({ query: {} as Record<string, string> })
const routerReplace = vi.fn()
function metric(value: string, entity: string, clickable = true) {
  return {
    value,
    unit: 'CNY',
    status: 'complete',
    missingSources: [],
    asOf: '2026-08-23T00:00:00.000Z',
    drilldown: clickable ? { entity, filters: { supplierId: 'supplier-1' } } : null,
  }
}
const detail = {
  dataOrigin: 'real' as const,
  capabilities: ['supplier:list:read', 'supplier:write'],
  supplier: { id: 'supplier-1', name: '中央分供方', aliases: [], taxNo: '9144 **** 0001', supplierCategory: '材料供应商', credentialStatus: 'incomplete' },
  projects: [],
  contracts: [],
  settlements: [],
  invoices: [],
  payments: [],
  summary: {
    projectCount: 0,
    contractCount: 0,
    settlementCount: 0,
    invoiceCount: 0,
    paymentCount: 0,
    contractAmount: metric('0.00', 'contract'),
    settlementAmount: metric('0.00', 'settlement'),
    invoiceAmount: metric('0.00', 'invoice'),
    paymentAmount: metric('0.00', 'payment-record'),
    payableAmount: metric('0.00', 'payment-record', false),
  },
}

const shell = defineComponent({
  props: ['title'],
  template: '<main><h1 data-entity-detail-title tabindex="-1">{{ title }}</h1><slot name="actions"/><slot name="summary"/><slot/></main>',
})
const tabs = defineComponent({
  props: ['modelValue', 'tabs'],
  emits: ['update:modelValue'],
  template: '<div><button v-for="tab in tabs" :key="tab.key" role="tab" :aria-selected="modelValue === tab.key" @click="$emit(\'update:modelValue\', tab.key)">{{ tab.label }} {{ tab.count }}</button></div>',
})
const metricStub = defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}：{{ value }}</span>' })

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useRouter', () => ({ replace: routerReplace }))
vi.stubGlobal('useTabTitle', () => {})

describe('分供方中央详情', () => {
  beforeEach(() => {
    route.query = {}
    routerReplace.mockReset()
    supplierStoreMock.detailState = { kind: 'ready', data: detail }
    supplierStoreMock.loadDetail.mockClear()
  })

  it('零金额仍可进入四类真实事实页签，应付金额保持不可点击', async () => {
    render(SupplierDetailScreen, {
      props: {
        supplierId: 'supplier-1',
        origin: 'real',
        includeDemo: false,
        returnTo: '/base/supplier?search=%E4%B8%AD%E5%A4%AE#supplier-row-real%3Asupplier-1',
      },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        Metric: metricStub,
        MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
        SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
        SupplierFactTable: defineComponent({ props: ['tab'], template: '<section data-testid="fact-tab">{{ tab }}</section>' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    await waitFor(() => expect(screen.getByRole('heading', { name: '中央分供方' })).toBe(document.activeElement))
    expect(screen.getByRole('link', { name: '证照附件' }).getAttribute('href'))
      .toBe('/base/supplier/credential/supplier-1?origin=real&returnTo=%2Fbase%2Fsupplier%3Fsearch%3D%25E4%25B8%25AD%25E5%25A4%25AE%23supplier-row-real%25253Asupplier-1')
    expect(screen.getByRole('button', { name: '查看累计合同金额明细' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看累计结算金额明细' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看累计收票金额明细' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看累计付款金额明细' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '查看应付金额明细' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '查看累计结算金额明细' }))
    expect(routerReplace).toHaveBeenLastCalledWith({ query: { tab: 'settlements' } })
    expect(screen.getByTestId('fact-tab').textContent).toBe('settlements')
  })

  it('从 query 恢复付款页签，并保留刷新失败前一版详情', () => {
    route.query = { tab: 'payments', from: 'list' }
    supplierStoreMock.detailState = {
      kind: 'error',
      previous: detail,
      problem: { code: 'unavailable', message: '中央服务暂时不可用', retryable: true, fieldErrors: {}, traceId: null },
    }
    render(SupplierDetailScreen, {
      props: { supplierId: 'supplier-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        Metric: metricStub,
        MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
        StatePanel: defineComponent({ props: ['description'], template: '<div role="alert">{{ description }}</div>' }),
        SupplierDetailOverview: defineComponent({ template: '<section>主档仍可见</section>' }),
        SupplierFactTable: defineComponent({ props: ['tab'], template: '<section data-testid="fact-tab">{{ tab }}</section>' }),
        NuxtLink: defineComponent({ template: '<a><slot/></a>' }),
      } },
    })

    expect(screen.getByTestId('fact-tab').textContent).toBe('payments')
    expect(screen.getByText('主档仍可见')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('中央服务暂时不可用')
  })
})
