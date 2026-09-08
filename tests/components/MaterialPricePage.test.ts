import type { DeliveryPriceRecordInput } from '~/lib/material/price-analysis'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, shallowReactive } from 'vue'
import MaterialPricePage from '~/pages/material/price.vue'

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
  lines: [{ id: 'line-1', materialName: '水泥', spec: 'P.O 42.5', unit: '吨', unitPrice: 410, amount: 410, currentValueConfirmed: true }],
}]

function renderPage() {
  return render(MaterialPricePage, {
    global: { components: { NuxtLink: defineComponent({ template: '<a><slot /></a>' }) } },
  })
}

beforeEach(() => {
  runtime.stores = Object.fromEntries(Object.entries({
    delivery: records,
    supplier: [{ id: 'supplier-1', name: '甲厂' }],
    project: [{ id: 'project-1', name: '项目甲' }],
    contract: [],
  }).map(([key, list]) => [key, shallowReactive({ list, loading: false, load: vi.fn(async () => undefined) })]))
})

describe('材料单价分析读取周期', () => {
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
    await fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await flushPromises()
    expect(screen.getByText('尚无可分析的材料价格')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
