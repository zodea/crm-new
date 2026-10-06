import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import SupplierDetailScreen from '~/components/supplier/SupplierDetailScreen.vue'
import ReadOnlySection from '~/components/ui/ReadOnlySection.vue'

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
    knownValue: value,
    unit: 'CNY',
    quantityUnit: null,
    status: 'complete',
    missingSources: [],
    participatingCount: 0,
    missingCount: 0,
    asOf: '2026-08-23T00:00:00.000Z',
    drilldown: clickable ? { kind: 'entity-subview', subject: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '中央分供方', no: null }, variant: { 'contract': 'contracts', 'settlement': 'settlements', 'invoice': 'invoices', 'payment-record': 'payments' }[entity], view: null, filters: { dataOrigin: 'real' } } : null,
  }
}
const detail = {
  meta: { sources: [{ key: 'contracts', state: 'readable', sourceVersion: 'unified-contract-source-1', asOf: '2026-08-23T00:00:00.000Z' }] },
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
  template: '<main><a :href="backTo">{{ backLabel }}</a><h1 data-entity-detail-title tabindex="-1">{{ title }}</h1><div data-testid="detail-status"><slot name="status"/></div><slot name="actions"/><slot name="summary"/><slot name="navigation"/><slot/><slot name="aside"/></main>',
})
const tabs = defineComponent({
  props: ['modelValue', 'tabs'],
  emits: ['update:modelValue'],
  template: '<div><button v-for="tab in tabs" :key="tab.key" role="tab" :aria-selected="modelValue === tab.key" @click="$emit(\'update:modelValue\', tab.key)">{{ tab.label }} {{ tab.count }}</button></div>',
})
const metricStub = defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}：{{ value }}</span>' })

function renderContractSourceScope() {
  return render(SupplierDetailScreen, {
    props: { supplierId: 'supplier-1', origin: 'real', includeDemo: false },
    global: { components: {
      EntityDetailShell: shell,
      SegTab: tabs,
      ReadOnlySection,
      SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
      SupplierFactTable: defineComponent({ props: ['tab'], template: '<section data-testid="known-contract-facts">{{ tab }}</section>' }),
      AuxiliaryContractJourney: defineComponent({ props: ['supplierId'], template: '<section data-testid="auxiliary-contract-source">{{ supplierId }}</section>' }),
      NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
    } },
  })
}

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

  it.each(['unavailable', 'forbidden', undefined])('已核材采空集合而其他合同来源%s时不挂载该领域，不把完整金额或数量写成零', (state) => {
    route.query = { tab: 'contracts' }
    supplierStoreMock.detailState = { kind: 'ready', data: {
      ...detail,
      meta: { sources: [
        { key: 'contracts', state: 'readable', sourceVersion: 'material-contracts-0', asOf: '2026-08-23T00:00:00.000Z' },
        { key: 'material-contracts', state: 'readable', sourceVersion: 'material-contract-command-0', asOf: '2026-08-23T00:00:00.000Z' },
        ...(state ? [{ key: 'other-contract-domains', state, sourceVersion: null, asOf: null }] : []),
      ] },
      summary: { ...detail.summary, contractCount: null, contractAmount: { ...metric('0.00', 'contract'), value: null, status: 'partial', missingCount: null, missingSources: state ? ['other-contract-domains'] : [] } },
    } }
    renderContractSourceScope()
    expect(screen.queryByTestId('auxiliary-contract-source')).toBeNull()
    expect(screen.getByTestId('known-contract-facts').textContent).toBe('contracts')
    expect(screen.getByRole('status', { name: '合同来源范围' }).textContent).toContain('其他合同来源当前不可读取')
    const summary = screen.getByRole('button', { name: '查看累计合同金额明细' }).parentElement!.parentElement!
    expect(within(summary).getByText('—')).not.toBeNull()
    expect(within(summary).getByText('已核对金额 ¥0.00')).not.toBeNull()
    expect(screen.getByRole('tab', { name: '支出合同' }).textContent?.trim()).toBe('支出合同')
  })

  it('缺少可信合同来源不能仅凭主档能力开启其他合同入口', () => {
    supplierStoreMock.detailState = { kind: 'ready', data: { ...detail, meta: { sources: [] } } }
    renderContractSourceScope()
    expect(screen.queryByTestId('auxiliary-contract-source')).toBeNull()
  })

  it.each(['real', 'demo'])('统一可信合同来源仍保留%s原领域规则', (dataOrigin) => {
    supplierStoreMock.detailState = { kind: 'ready', data: { ...detail, dataOrigin } }
    renderContractSourceScope()
    expect(screen.queryByTestId('auxiliary-contract-source')?.textContent ?? null).toBe(dataOrigin === 'real' ? 'supplier-1' : null)
    expect(screen.queryByRole('status', { name: '合同来源范围' })).toBeNull()
  })

  it.each([
    ['incomplete', '资料缺失', 'warn'],
    ['reviewing', '齐全待核验', 'brand'],
    ['qualified', '合格', 'ok'],
    ['rejected', '退回', 'danger'],
    ['unrecognized', '未知状态', 'neutral'],
  ])('资料状态 %s 在标题和档案中保持同一业务含义', (credentialStatus, label, tone) => {
    supplierStoreMock.detailState = {
      kind: 'ready',
      data: { ...detail, supplier: { ...detail.supplier, credentialStatus } },
    }
    render(SupplierDetailScreen, {
      props: { supplierId: 'supplier-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        ReadOnlySection,
        SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
        SupplierFactTable: defineComponent({ template: '<section />' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    const status = within(screen.getByTestId('detail-status')).getByText(label)
    expect(status.getAttribute('data-tone')).toBe(tone)
    expect(within(screen.getByRole('region', { name: '档案信息' })).getByText(label)).not.toBeNull()
    expect(screen.queryByText('资料待完善')).toBeNull()
  })

  it('当前正式来源的合同和结算小计显示核对金额，完整未知仍为横线；已确认付款显示真实零', async () => {
    supplierStoreMock.detailState = { kind: 'ready', data: { ...detail, unavailableSources: ['projects', 'invoices'], summary: { ...detail.summary, projectCount: null, contractCount: null, settlementCount: null, invoiceCount: null, contractAmount: { ...metric('100.00', 'contract'), value: null, status: 'partial', missingCount: null, participatingCount: 1, missingSources: ['other-contract-domains'] }, settlementAmount: { ...metric('70.00', 'settlement'), value: null, status: 'partial', missingCount: null, participatingCount: 2, missingSources: ['other-settlement-domains'] }, invoiceAmount: { ...metric('0.00', 'invoice'), value: null, knownValue: null, status: 'partial', participatingCount: null, missingCount: null, missingSources: ['invoices'] }, payableAmount: { ...metric('0.00', 'payment-record', false), value: null, knownValue: null, status: 'partial', participatingCount: null, missingCount: null, missingSources: ['other-contract-domains'] } },
    } }
    render(SupplierDetailScreen, {
      props: { supplierId: 'supplier-1', origin: 'real', includeDemo: false },
      global: { components: { EntityDetailShell: shell, SegTab: tabs, ReadOnlySection, SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }), SupplierFactTable: defineComponent({ props: ['tab'], template: '<section data-testid="actual-fact-tab">{{ tab }}</section>' }), NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }) } },
    })
    const summary = within(screen.getByTestId('supplier-summary'))
    expect(summary.getByRole('button', { name: '查看累计合同金额明细' }).textContent?.trim()).toBe('—')
    expect(summary.getByRole('button', { name: '查看累计结算金额明细' }).textContent?.trim()).toBe('—')
    expect(summary.getByRole('button', { name: '查看累计付款金额明细' }).textContent?.trim()).toBe('¥0.00')
    expect(summary.getByText('已核对金额 ¥100.00')).not.toBeNull()
    expect(summary.getByText('已核对金额 ¥70.00')).not.toBeNull()
    expect(summary.queryByRole('button', { name: '查看合作项目明细' })).toBeNull()
    await fireEvent.click(summary.getByRole('button', { name: '查看累计结算金额明细' }))
    expect(screen.getByTestId('actual-fact-tab').textContent).toBe('settlements')
    expect(screen.getByRole('tab', { name: '支出结算' }).getAttribute('aria-selected')).toBe('true')
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

  it('缺金额的合同和结算显示未知占位，仍可进入源记录核对', () => {
    supplierStoreMock.detailState = {
      // 原断言保护未知金额及源核对入口；读取已成功，partial 留在独立金额完整性上。
      kind: 'ready',
      data: {
        ...detail,
        summary: {
          ...detail.summary,
          contractAmount: { ...metric('100.00', 'contract'), value: null, status: 'partial', missingSources: ['contract'], participatingCount: 2, missingCount: 1 },
          settlementAmount: { ...metric('0.00', 'settlement'), knownValue: null, value: null, status: 'partial', missingSources: ['settlement'], participatingCount: 1, missingCount: 1 },
          payableAmount: { ...metric('0.00', 'payment-record', false), knownValue: null, value: null, status: 'partial', missingSources: ['contract'], participatingCount: null, missingCount: null },
        },
      },
    }
    render(SupplierDetailScreen, {
      props: { supplierId: 'supplier-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
        SupplierFactTable: defineComponent({ template: '<section />' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })
    expect(screen.getByRole('button', { name: '查看累计合同金额明细' }).textContent).toBe('—')
    expect(screen.getByRole('button', { name: '查看累计结算金额明细' }).textContent).toBe('—')
    const payable = within(screen.getByTestId('supplier-summary')).getByText('应付金额').parentElement!
    expect(payable.textContent).toContain('—')
    expect(payable.textContent).not.toContain('¥0.00')
    expect(screen.getByText('已核对金额 ¥100.00 · 1 份记录金额未知')).not.toBeNull()
    expect(screen.getByText('来源未就绪，金额待核对')).not.toBeNull()
  })

  it('无权项目保留必要占位，但汇总与标签都不从关系数组推断总数', () => {
    supplierStoreMock.detailState = {
      kind: 'ready',
      data: {
        ...detail,
        projects: [
          { projectRef: { state: 'resolved', entity: 'project', id: 'visible-project', label: '可查看项目', no: null } },
          { projectRef: { state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied' } },
        ],
        summary: { ...detail.summary, projectCount: null },
      },
    }
    render(SupplierDetailScreen, {
      props: { supplierId: 'supplier-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: shell,
        SegTab: tabs,
        SupplierDetailOverview: defineComponent({ template: '<section>主档</section>' }),
        SupplierFactTable: defineComponent({ template: '<section />' }),
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' }),
      } },
    })

    expect(screen.getByRole('tab', { name: '合作项目' }).textContent?.trim()).toBe('合作项目')
    expect(screen.queryByRole('tab', { name: '合作项目 2' })).toBeNull()
    expect(screen.getByRole('tab', { name: '支出合同 0' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看合作项目明细' }).textContent).toBe('—')
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
