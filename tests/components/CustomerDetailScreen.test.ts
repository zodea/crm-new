import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import CustomerDetailRelations from '~/components/master-data/CustomerDetailRelations.vue'
import CustomerDetailScreen from '~/components/master-data/CustomerDetailScreen.vue'
import StatePanel from '~/components/ui/StatePanel.vue'

const customerStoreMock = vi.hoisted(() => ({
  detailState: { kind: 'idle' } as any,
  loadDetail: vi.fn().mockResolvedValue(undefined),
}))
const customerProduction = vi.hoisted(() => ({ recover: vi.fn(), lifecycle: vi.fn(), change: vi.fn() }))

vi.mock('~/stores/customer-read', () => ({
  useCustomerReadStore: () => customerStoreMock,
}))
vi.mock('~/stores/customer-production', () => ({ useCustomerProductionStore: () => customerProduction }))

const route = reactive({
  query: {} as Record<string, string>,
})
const routerReplace = vi.fn()
const confirm = vi.fn()
const success = vi.fn()

const detail = {
  dataOrigin: 'real' as const,
  capabilities: ['customer:list:read', 'customer:write'],
  customer: {
    dataOrigin: 'real' as const,
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
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  projects: [{ id: 'project-1' }, { id: 'project-2' }],
  contracts: [{ id: 'contract-1' }],
  receipts: [{ id: 'receipt-1' }, { id: 'receipt-2' }, { id: 'receipt-3' }],
  summary: {
    projectCount: 2,
    contractCount: 1,
    effectiveContractAmount: '1000000.00',
    receiptCount: 3,
    effectiveReceiptAmount: '320000.00',
    outstandingAmount: '680000.00',
    draftReceiptCount: 0,
  },
}

const EntityDetailShellStub = defineComponent({
  props: ['title'],
  template: `
    <main>
      <h1 data-entity-detail-title tabindex="-1">{{ title }}</h1>
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
vi.stubGlobal('useKitUI', () => ({ confirm, success }))

describe('客户详情业务页签', () => {
  it('其他客户刷新共享状态时，不把其姓名写入当前详情或页签', () => {
    customerStoreMock.detailState = { kind: 'ready', data: { ...detail, customer: { ...detail.customer, id: 'customer-2', name: '另一客户' } } }
    const titles: Array<() => string | undefined> = []
    vi.stubGlobal('useTabTitle', (title: () => string | undefined) => titles.push(title))
    const view = render(CustomerDetailScreen, {
      props: { customerId: 'customer-1', origin: 'real', includeDemo: false },
      global: { components: { EntityDetailShell: EntityDetailShellStub, SegTab: SegTabStub }, stubs: ['CustomerDetailOverview', 'CustomerDetailRelations', 'MetricGrid', 'Metric', 'NuxtLink'] },
    })
    expect(view.queryByRole('heading', { name: '另一客户' })).toBeNull()
    expect(titles[0]?.()).toBeUndefined()
    vi.stubGlobal('useTabTitle', () => {})
  })

  beforeEach(() => {
    route.query = {}
    routerReplace.mockReset()
    customerStoreMock.detailState = { kind: 'ready', data: detail }
    customerStoreMock.loadDetail.mockClear()
    customerProduction.recover.mockReset()
    customerProduction.lifecycle.mockReset()
    customerProduction.change.mockReset()
    confirm.mockReset()
    success.mockReset()
  })

  it('从原回执恢复客户状态，确认后才按当前版本发起恢复并重读客户详情', async () => {
    customerStoreMock.detailState = { kind: 'ready', data: { ...detail, capabilities: [...detail.capabilities, 'customer:lifecycle:write'] } }
    const deleted = { id: 'customer-1', name: detail.customer.name, version: 'customer-v2', deletedAt: '2026-09-22' }
    customerProduction.recover.mockResolvedValue({ current: deleted, applied: true })
    customerProduction.change.mockResolvedValue({ current: { ...deleted, version: 'customer-v3', deletedAt: null }, recovered: false })
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(CustomerDetailScreen, {
      props: { customerId: deleted.id, origin: 'real', includeDemo: false },
      global: { components: { EntityDetailShell: EntityDetailShellStub, SegTab: SegTabStub }, stubs: ['CustomerDetailOverview', 'CustomerDetailRelations', 'MetricGrid', 'Metric', 'NuxtLink'] },
    })

    const restore = await screen.findByRole('button', { name: '恢复客户' })
    expect(customerProduction.recover).toHaveBeenCalledWith(deleted.id)
    expect(customerProduction.lifecycle).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('上次操作已保存，现已核对当前状态。')
    customerStoreMock.loadDetail.mockClear()
    await fireEvent.click(restore)
    expect(customerProduction.change).not.toHaveBeenCalled()

    await fireEvent.click(restore)
    await screen.findByRole('button', { name: '删除客户' })
    expect(confirm).toHaveBeenLastCalledWith({ title: '恢复客户', message: `恢复“${deleted.name}”及其原有附件可见性？`, confirmLabel: '恢复客户' })
    expect(customerProduction.change).toHaveBeenCalledExactlyOnceWith(deleted)
    expect(customerStoreMock.loadDetail).toHaveBeenCalledWith({ id: deleted.id, origin: 'real', includeDemo: false })
    expect(success).toHaveBeenCalledWith('客户已恢复')
  })

  it.each(['forbidden', 'unavailable'] as const)('项目源 %s 时数量未知、不渲染假空列表，仅失败可重试', async (code) => {
    customerStoreMock.detailState = {
      kind: 'ready',
      data: {
        ...detail,
        projects: [],
        projectsProblem: { code, message: '项目源暂不可读', retryable: code === 'unavailable', fieldErrors: {}, traceId: null },
        summary: { ...detail.summary, projectCount: null },
      },
    }
    render(CustomerDetailScreen, {
      props: { customerId: 'customer-1', origin: 'real', includeDemo: false },
      global: {
        components: {
          EntityDetailShell: EntityDetailShellStub,
          SegTab: SegTabStub,
          StatePanel,
          CustomerDetailRelations,
          CustomerDetailOverview: defineComponent({ template: '<section />' }),
          KitTable: defineComponent({ template: '<section data-testid="project-table">暂无名下项目</section>' }),
          MetricGrid: defineComponent({ template: '<div><slot /></div>' }),
          Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}：{{ value }}</span>' }),
          NuxtLink: defineComponent({ template: '<a><slot /></a>' }),
        },
      },
    })
    expect(screen.getByRole('tab', { name: '名下项目' })).not.toBeNull()
    expect(screen.getByText('名下项目：—')).not.toBeNull()
    expect(screen.queryByTestId('project-table')).toBeNull()
    expect(screen.getByRole(code === 'forbidden' ? 'status' : 'alert', { name: code === 'forbidden' ? '无权查看关联项目' : '关联项目加载失败' })).not.toBeNull()
    if (code === 'unavailable') {
      customerStoreMock.loadDetail.mockClear()
      await fireEvent.click(screen.getByRole('button', { name: '重新加载关联项目' }))
      expect(customerStoreMock.loadDetail).toHaveBeenCalledWith({ id: 'customer-1', origin: 'real', includeDemo: false })
    }
    else {
      expect(screen.queryByRole('button', { name: '重新加载关联项目' })).toBeNull()
    }
  })

  it.each(['forbidden', 'unavailable'] as const)('合同源 %s 时派生金额未知，禁止假空态且只在允许时重试', async (code) => {
    route.query = { tab: 'contracts' }
    customerStoreMock.detailState = {
      kind: 'ready',
      data: {
        ...detail,
        contracts: [],
        contractsProblem: { code, message: '合同源暂不可读', retryable: code === 'unavailable', fieldErrors: {}, traceId: null },
        summary: { ...detail.summary, contractCount: null, effectiveContractAmount: null, outstandingAmount: null },
      },
    }
    render(CustomerDetailScreen, {
      props: { customerId: 'customer-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: EntityDetailShellStub,
        SegTab: SegTabStub,
        StatePanel,
        CustomerDetailRelations,
        CustomerDetailOverview: defineComponent({ template: '<section />' }),
        KitTable: defineComponent({ template: '<section data-testid="contract-table">暂无施工合同</section>' }),
        MetricGrid: defineComponent({ template: '<div><slot /></div>' }),
        Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}：{{ value }}</span>' }),
        NuxtLink: defineComponent({ template: '<a><slot /></a>' }),
      } },
    })
    expect(screen.getByRole('tab', { name: '施工合同' })).not.toBeNull()
    for (const label of ['施工合同', '有效合同额', '待收差额'])
      expect(screen.getByText(`${label}：—`)).not.toBeNull()
    expect(screen.queryByTestId('contract-table')).toBeNull()
    expect(screen.getByRole(code === 'forbidden' ? 'status' : 'alert', { name: code === 'forbidden' ? '无权查看施工合同' : '施工合同加载失败' })).not.toBeNull()
    if (code === 'unavailable') {
      customerStoreMock.loadDetail.mockClear()
      await fireEvent.click(screen.getByRole('button', { name: '重新加载施工合同' }))
      expect(customerStoreMock.loadDetail).toHaveBeenCalledWith({ id: 'customer-1', origin: 'real', includeDemo: false })
    }
    else {
      expect(screen.queryByRole('button', { name: '重新加载施工合同' })).toBeNull()
    }
  })

  it.each(['forbidden', 'unavailable'] as const)('收款源 %s 显示未知与独立反馈，重试继续读取同一客户', async (code) => {
    route.query = { tab: 'receipts' }
    customerStoreMock.detailState = {
      kind: 'ready',
      data: {
        ...detail,
        receipts: [],
        receiptsProblem: { code, message: '收款来源不可读', retryable: code === 'unavailable', fieldErrors: {}, traceId: null },
        summary: { ...detail.summary, receiptCount: null, effectiveReceiptAmount: null, outstandingAmount: null, draftReceiptCount: null },
      },
    }
    render(CustomerDetailScreen, {
      props: { customerId: 'customer-1', origin: 'real', includeDemo: false },
      global: { components: {
        EntityDetailShell: EntityDetailShellStub,
        SegTab: SegTabStub,
        StatePanel,
        CustomerDetailRelations,
        CustomerDetailOverview: defineComponent({ template: '<section />' }),
        KitTable: defineComponent({ template: '<section data-testid="receipt-table">暂无收款记录</section>' }),
        MetricGrid: defineComponent({ template: '<div><slot /></div>' }),
        Metric: defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}：{{ value }}</span>' }),
        NuxtLink: defineComponent({ template: '<a><slot /></a>' }),
      } },
    })
    expect(screen.getByRole('tab', { name: '收款明细' })).not.toBeNull()
    expect(screen.getByText('有效收款：—')).not.toBeNull()
    expect(screen.getByText('待收差额：—')).not.toBeNull()
    expect(screen.queryByTestId('receipt-table')).toBeNull()
    expect(screen.getByRole(code === 'forbidden' ? 'status' : 'alert', { name: code === 'forbidden' ? '无权查看收款明细' : '收款明细加载失败' })).not.toBeNull()
    if (code === 'unavailable') {
      customerStoreMock.loadDetail.mockClear()
      await fireEvent.click(screen.getByRole('button', { name: '重新加载收款明细' }))
      expect(customerStoreMock.loadDetail).toHaveBeenCalledWith({ id: 'customer-1', origin: 'real', includeDemo: false })
    }
    else {
      expect(screen.queryByRole('button', { name: '重新加载收款明细' })).toBeNull()
    }
  })

  it('从 query 恢复页签，展示真实数量并在切换时保留其他 query', async () => {
    route.query = { tab: 'contracts', from: 'list' }
    render(CustomerDetailScreen, {
      props: { customerId: 'customer-1', origin: 'real', includeDemo: false },
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
    await waitFor(() => expect(screen.getByRole('heading', { name: '合和地产集团' })).toBe(document.activeElement))

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
      props: { customerId: 'customer-1', origin: 'real', includeDemo: false },
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

  it('刷新失败时保留上一版详情并展示紧凑错误', () => {
    customerStoreMock.detailState = {
      kind: 'error',
      previous: detail,
      problem: { code: 'unavailable', message: '中央服务暂时不可用', retryable: true, fieldErrors: {}, traceId: null },
    }
    render(CustomerDetailScreen, {
      props: { customerId: 'customer-1', origin: 'real', includeDemo: false },
      global: {
        components: {
          EntityDetailShell: EntityDetailShellStub,
          SegTab: SegTabStub,
          StatePanel: defineComponent({
            props: ['title', 'description'],
            template: '<div role="alert">{{ title }}：{{ description }}</div>',
          }),
          CustomerDetailOverview: defineComponent({ template: '<section>客户概览仍可见</section>' }),
          CustomerDetailRelations: defineComponent({ template: '<section />' }),
          MetricGrid: defineComponent({ template: '<div><slot /></div>' }),
          Metric: defineComponent({ template: '<span />' }),
          NuxtLink: defineComponent({ template: '<a><slot /></a>' }),
        },
      },
    })

    expect(screen.getByText('客户概览仍可见')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('刷新客户详情失败：中央服务暂时不可用')
  })
})
