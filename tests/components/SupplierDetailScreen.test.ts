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
  capabilities: ['supplier:list:read', 'supplier:write', 'subcontract-document:read'],
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
  props: ['title', 'backTo', 'backLabel'],
  template: '<main><a :href="backTo">{{ backLabel }}</a><h1 data-entity-detail-title tabindex="-1">{{ title }}</h1><slot name="actions"/><slot name="summary"/><slot name="navigation"/><slot/><slot name="aside"/></main>',
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
    const subcontractChanges = new URL(
      screen.getByRole('link', { name: '查看分包变洽签' }).getAttribute('href')!,
      'https://ruihang.invalid',
    )
    expect(subcontractChanges.pathname).toBe('/subcontract/change')
    expect(subcontractChanges.searchParams.get('supplier')).toBe('supplier-1')
    expect(subcontractChanges.searchParams.get('origin')).toBe('real')
    const supplierReturn = new URL(subcontractChanges.searchParams.get('returnTo')!, 'https://ruihang.invalid')
    expect(supplierReturn.pathname).toBe('/base/supplier/supplier-1')
    expect(supplierReturn.searchParams.get('origin')).toBe('real')
    expect(supplierReturn.searchParams.get('returnTo'))
      .toBe('/base/supplier?search=%E4%B8%AD%E5%A4%AE#supplier-row-real%253Asupplier-1')
    expect(supplierReturn.searchParams.get('subChangeJourney')).toMatch(/^origin_[\w-]+$/)
    expect(supplierReturn.hash).toBe('#supplier-subcontract-change-link')
    expect(screen.getByRole('button', { name: '查看累计合同金额明细' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看累计结算金额明细' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看累计收票金额明细' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看累计付款金额明细' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '查看应付金额明细' })).toBeNull()
    expect(screen.getByRole('tab', { name: '详细资料' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('主档')).not.toBeNull()
    expect(screen.queryByTestId('fact-tab')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '查看累计结算金额明细' }))
    expect(routerReplace).toHaveBeenLastCalledWith({ query: { tab: 'settlements' } })
    expect(screen.getByTestId('fact-tab').textContent).toBe('settlements')
    expect(screen.queryByText('主档')).toBeNull()
    expect(screen.getByRole('button', { name: '查看累计付款金额明细' })).not.toBeNull()
  })

  it('从 query 恢复付款页签，刷新失败保留记录并可返回详细资料', async () => {
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
    expect(screen.queryByText('主档仍可见')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('中央服务暂时不可用')
    await fireEvent.click(screen.getByRole('tab', { name: '详细资料' }))
    expect(screen.getByText('主档仍可见')).not.toBeNull()
    expect(screen.queryByTestId('fact-tab')).toBeNull()
    expect(routerReplace).toHaveBeenLastCalledWith({ query: { from: 'list' } })
  })

  it('缺少分包变洽签读取权限时不显示跨领域入口', () => {
    supplierStoreMock.detailState = {
      kind: 'ready',
      data: { ...detail, capabilities: ['supplier:list:read'] },
    }
    render(SupplierDetailScreen, {
      props: { supplierId: 'supplier-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        Metric: metricStub,
        MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
        SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
        SupplierFactTable: defineComponent({ template: '<section />' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    expect(screen.queryByRole('link', { name: '查看分包变洽签' })).toBeNull()
  })

  it('从材采合同进入指定事实页签，并返回原合同页签', () => {
    const listReturnTo = '/contract/material?projectId=project-1&origin=real&nav=origin_319_contract#material-contract-row-real%3Acontract-1'
    const contractReturnTo = `/contract/contract-1?origin=real&contractKind=material&tab=payments&returnTo=${encodeURIComponent(listReturnTo)}`
    route.query = { tab: 'contracts' }
    render(SupplierDetailScreen, {
      props: {
        supplierId: 'supplier-1',
        origin: 'real',
        includeDemo: false,
        returnTo: contractReturnTo,
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

    expect(screen.getByTestId('fact-tab').textContent).toBe('contracts')
    expect(screen.getByRole('link', { name: '返回材料采购合同' }).getAttribute('href')).toBe(contractReturnTo)
  })

  it('从匹配的项目分供方工作台进入时显式返回原页签', () => {
    const returnTo = '/project/project-1/supplier/supplier-1?origin=demo&tab=overview'
    render(SupplierDetailScreen, {
      props: {
        supplierId: 'supplier-1',
        origin: 'demo',
        includeDemo: true,
        returnTo,
      },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        Metric: metricStub,
        MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
        SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
        SupplierFactTable: defineComponent({ template: '<section />' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    expect(screen.getByRole('link', { name: '返回项目分供方工作台' }).getAttribute('href')).toBe(returnTo)
  })

  it('从分包变洽签详情进入时显式返回原单据，不退回分供方列表', () => {
    const returnTo = '/subcontract/change/sub-change-real-327?origin=real'
    render(SupplierDetailScreen, {
      props: {
        supplierId: 'supplier-1',
        origin: 'real',
        includeDemo: false,
        returnTo,
      },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        Metric: metricStub,
        MetricGrid: defineComponent({ template: '<div><slot/></div>' }),
        SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
        SupplierFactTable: defineComponent({ template: '<section />' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    expect(screen.getByRole('link', { name: '返回分包变洽签' }).getAttribute('href')).toBe(returnTo)
  })
})
