import type { DeliveryPriceRecordInput } from '~/lib/material/price-analysis'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, shallowReactive } from 'vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { attachOriginReadMeta } from '~/lib/read-model/meta'
import MaterialPricePage from '~/pages/material/price.vue'
import { useProductionAccessStore } from '~/stores/production-access'
import { publicReadMeta } from '../helpers/public-read-meta'

const runtime = vi.hoisted(() => ({ stores: {} as Record<string, any> }))
vi.mock('~/stores/delivery-record', () => ({ useDeliveryRecordStore: () => runtime.stores.delivery }))
vi.mock('~/stores/supplier', () => ({ useSupplierStore: () => runtime.stores.supplier }))
vi.mock('~/stores/project', () => ({ useProjectStore: () => runtime.stores.project }))
vi.mock('~/stores/contract', () => ({ useContractStore: () => runtime.stores.contract }))

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

const records: DeliveryPriceRecordInput[] = [{
  id: 'delivery-1',
  projectId: 'project-1',
  supplierId: 'supplier-1',
  orderNo: 'XS-001',
  deliveryDate: '2026-04-01',
  archived: true,
  reviewStatus: 'reviewed',
  ocrStatus: 'reviewed',
  naturalKeyDuplicate: false,
  currentValuesConfirmed: true,
  hasSourceFile: true,
  lines: [{ id: 'line-1', materialName: '水泥', spec: 'P.O 42.5', unit: '吨', unitPrice: 410, amount: 410, currentValueConfirmed: true }],
}]

function renderPage(pinia = createPinia()) {
  return render(MaterialPricePage, {
    global: { plugins: [pinia], components: { SectionHeader, NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }) } },
  })
}

beforeEach(() => {
  // These existing tests isolate delivery/contract lifecycle; the independent quotation owner is explicitly empty.
  const asOf = '2026-10-05T00:00:00.000Z'
  const capabilities = ['material-quotation:read']
  const meta = publicReadMeta({ schemaVersion: 'material-quotation-read-v1', dataOrigin: 'real', asOf, sourceVersion: 'fixture-quotations:0', capabilities, scope: {}, requested: true })
  vi.stubGlobal('useMaterialQuotationRepository', () => ({ list: vi.fn(async () => ({ records: [], meta, asOf, sourceVersion: meta.sourceVersion, capabilities })) }))
  runtime.stores = Object.fromEntries(Object.entries({
    delivery: records,
    supplier: [{ id: 'supplier-1', name: '甲厂' }],
    project: [{ id: 'project-1', name: '项目甲' }],
    contract: [],
  }).map(([key, list]) => [key, shallowReactive({ list, loading: false, load: vi.fn(async () => undefined) })]))
})
afterEach(() => vi.unstubAllGlobals())

describe('材料单价分析读取周期', () => {
  it('送货缺源不遮住同owner已核实合同价；合同价撤权清除该来源，不借送货价格补税', async () => {
    Object.assign(runtime.stores.delivery, { mode: 'central', origin: 'real', context: { projects: [], suppliers: [] } })
    runtime.stores.delivery.load.mockRejectedValue(new Error('送货owner未接通'))
    const prices = vi.fn().mockResolvedValue({ items: [{ dataOrigin: 'real', contractId: 'verified-contract', lineId: 'verified-line', parentContractId: null, contractName: '已核实约定合同', contractNo: 'V01', supplierId: 'verified-supplier', supplierName: '真实分供方', projectId: null, projectName: null, date: '2026-10-04', materialName: '方管', spec: '40×40×2', materialGrade: '304', unit: '吨', quantity: 1, taxInclusiveUnitPrice: 18000, applicableTaxRate: null }] })
    const list = vi.fn().mockRejectedValue(new Error('其他关联不可读'))
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractRead: { list, prices } } }))
    renderPage()
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('送货owner未接通')
    expect(screen.getByRole('region', { name: '合同约定单价' }).textContent).toContain('已核实约定合同')
    expect(within(screen.getByRole('region', { name: '合同约定单价' })).getByRole('link', { name: '已核实约定合同' }).getAttribute('href')).toBe('/contract/verified-contract?contractKind=material&origin=real')
    expect(within(screen.getByRole('region', { name: '三来源原价与比较' })).getByRole('link', { name: '已核实约定合同' }).getAttribute('href')).toBe('/contract/verified-contract?contractKind=material&origin=real')
    expect(document.querySelector('[data-testid="contract-price-tax"]')?.textContent).toBe('—')
    prices.mockRejectedValueOnce(new Error('合同价格读取权限已撤销'))
    await fireEvent.click(screen.getByRole('button', { name: '重试', exact: true }))
    await flushPromises()
    expect(screen.queryByRole('region', { name: '合同约定单价' })).toBeNull()
    expect(screen.getAllByRole('alert').some(row => row.textContent?.includes('合同价格读取权限已撤销'))).toBe(true)
  })

  it('中央送货价格、主档与材采合同使用同源公开读取，权限刷新失败撤下旧分析', async () => {
    Object.assign(runtime.stores.delivery, {
      mode: 'central',
      origin: 'real',
      list: records.map(record => ({ ...record, id: 'd:1', dataOrigin: 'real' })),
      context: { projects: [{ id: 'project-1', name: '中央项目' }], suppliers: [{ id: 'supplier-1', name: '中央厂家' }] },
    })
    for (const key of ['supplier', 'project', 'contract'])
      Object.defineProperty(runtime.stores, key, { get: () => { throw new Error('不应读取本机主档') } })
    const asOf = '2026-09-11T08:00:00.000Z'
    const capabilities = ['material-contract:read']
    const fixtureMeta = (origin: 'real' | 'demo') => publicReadMeta({ schemaVersion: 'material-contract-read-v2', dataOrigin: origin, asOf, sourceVersion: 'fixture-contracts-v1', capabilities, scope: { projectId: null }, requested: origin === 'real' })
    const list = vi.fn().mockResolvedValue(attachOriginReadMeta({ items: [{ id: 'c:1', dataOrigin: 'real', name: '中央合同', no: 'CG', project: { state: 'resolved', id: 'project-1' }, supplier: { state: 'resolved', id: 'supplier-1' }, amounts: { contract: '12.35' }, signDate: '2026-09-11' }], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 }, asOf, sourceVersion: null, capabilities }, { real: fixtureMeta('real'), demo: fixtureMeta('demo') }))
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractRead: { list } } }))
    renderPage()
    await flushPromises()
    expect(screen.getByRole('heading', { name: '水泥 · P.O 42.5' })).not.toBeNull()
    expect(screen.getByRole('link', { name: '中央合同' }).getAttribute('href')).toBe('/contract/c%3A1?contractKind=material&origin=real')
    await fireEvent.click(screen.getByText('查看全部 1 个价格来源'))
    const sourceLinks = within(screen.getByRole('region', { name: '已归档送货单价格分析' })).getAllByRole('link', { name: /XS-001/ })
    expect(sourceLinks).toHaveLength(2)
    expect(sourceLinks.every(link => link.getAttribute('href') === '/material/delivery/archive/d%3A1?origin=real')).toBe(true)
    list.mockRejectedValueOnce(new Error('合同关联权限已撤销'))
    await fireEvent.click(screen.getByRole('button', { name: '刷新分析' }))
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('权限已撤销')
    expect(screen.queryByText('中央合同')).toBeNull()
    expect(screen.queryByRole('heading', { name: '水泥 · P.O 42.5' })).toBeNull()
  })

  it('首次读取保留加载态，同源后台刷新及页面刷新保留分析，完整成功后才能发布空快照', async () => {
    const initial = deferred()
    runtime.stores.delivery.load.mockReturnValueOnce(initial.promise)
    renderPage()
    expect(screen.getByRole('status').textContent).toContain('正在读取')
    expect(screen.queryByText('尚无可分析的材料价格')).toBeNull()

    initial.resolve()
    await flushPromises()
    const search = screen.getByRole('searchbox', { name: '搜索材料名称、规格或单位' })
    expect(screen.getByRole('heading', { name: '水泥 · P.O 42.5' })).not.toBeNull()

    runtime.stores.supplier.loading = true
    runtime.stores.delivery.list = []
    await flushPromises()
    expect(screen.getByRole('searchbox', { name: '搜索材料名称、规格或单位' })).toBe(search)
    expect(screen.getByRole('heading', { name: '水泥 · P.O 42.5' })).not.toBeNull()

    const refresh = deferred()
    runtime.stores.delivery.load.mockReturnValueOnce(refresh.promise)
    await fireEvent.click(screen.getByRole('button', { name: '刷新分析' }))
    expect(screen.getByRole('heading', { name: '水泥 · P.O 42.5' })).not.toBeNull()
    expect(screen.getByText(/下方为上次读取的送货价格，仅供查看/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: '三来源原价与比较' })).toBeNull()
    expect(screen.getByRole('button', { name: '刷新分析' }).hasAttribute('disabled')).toBe(true)
    refresh.resolve()
    await flushPromises()
    expect(screen.getByText('尚无可分析的材料价格')).not.toBeNull()
  })

  it('任一来源首次失败都不是成功空态，等待其他来源结束后支持真实重试', async () => {
    const pending = deferred()
    runtime.stores.delivery.list = []
    runtime.stores.delivery.load.mockReturnValueOnce(pending.promise)
    runtime.stores.supplier.load.mockRejectedValueOnce(new Error('分供方暂不可读取'))
    renderPage()
    await flushPromises()
    expect(screen.getByRole('status').textContent).toContain('正在读取')
    pending.resolve()
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('分供方暂不可读取')
    expect(screen.queryByText('尚无可分析的材料价格')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await flushPromises()
    expect(runtime.stores.supplier.load).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('尚无可分析的材料价格')).not.toBeNull()
  })

  it('刷新失败保留上次完整分析，重试成功后才替换', async () => {
    renderPage()
    await flushPromises()
    runtime.stores.delivery.list = []
    runtime.stores.contract.load.mockRejectedValueOnce(new Error('合同暂不可读取'))
    await fireEvent.click(screen.getByRole('button', { name: '刷新分析' }))
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('合同暂不可读取')
    expect(screen.getByRole('heading', { name: '水泥 · P.O 42.5' })).not.toBeNull()
    expect(screen.getByText(/下方为上次读取的送货价格，仅供查看/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: '三来源原价与比较' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await flushPromises()
    expect(screen.getByText('尚无可分析的材料价格')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('实际访问事件使旧价格立即失效，刷新迟到结果不能重新发布或成为比较候选', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    let accessStatus = { mode: 'production' as const, authenticated: true, ownerId: 'price-fixture-owner', purpose: 'verification' as const, expiresAt: '2026-10-06T00:00:00.000Z' }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionAccess: { status: async () => accessStatus } } }))
    const access = useProductionAccessStore()
    await access.check()
    renderPage(pinia)
    await flushPromises()
    expect(screen.getByRole('heading', { name: '水泥 · P.O 42.5' })).toBeTruthy()
    const late = deferred()
    runtime.stores.delivery.load.mockReturnValueOnce(late.promise)
    await fireEvent.click(screen.getByRole('button', { name: '刷新分析' }))
    accessStatus = { ...accessStatus, authenticated: false }
    await access.check()
    expect(screen.queryByRole('region', { name: '已归档送货单价格分析' })).toBeNull()
    expect(screen.queryByRole('region', { name: '三来源原价与比较' })).toBeNull()
    late.resolve()
    await flushPromises()
    expect(screen.queryByRole('heading', { name: '水泥 · P.O 42.5' })).toBeNull()
    expect(screen.queryByRole('region', { name: '三来源原价与比较' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('登录已失效')
  })
})
