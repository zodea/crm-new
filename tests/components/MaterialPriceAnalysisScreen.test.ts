import type { DeliveryPriceRecordInput } from '~/lib/material/price-analysis'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import MaterialPriceAnalysisScreen from '~/components/material/price/MaterialPriceAnalysisScreen.vue'

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

const global = {
  components: {
    NuxtLink: NuxtLinkStub,
  },
}

const records: DeliveryPriceRecordInput[] = [
  {
    id: 'delivery-1',
    projectId: 'project-a',
    supplierId: 'supplier-a',
    orderNo: 'XS-001',
    deliveryDate: '2026-04-01',
    archived: true,
    reviewStatus: 'reviewed',
    ocrStatus: 'reviewed',
    naturalKeyDuplicate: false,
    currentValuesConfirmed: true,
    hasSourceFile: true,
    lines: [
      { id: 'line-1', materialName: 'BV 电线', spec: '2.5 mm²', unit: 'm', unitPrice: 2.5, amount: 25, currentValueConfirmed: true },
      { id: 'line-2', materialName: '水泥', spec: 'P.O 42.5', unit: '吨', unitPrice: 410, amount: 410, currentValueConfirmed: true },
    ],
  },
  {
    id: 'delivery-2',
    projectId: 'project-b',
    supplierId: 'supplier-a',
    orderNo: 'XS-002',
    deliveryDate: '2026-05-01',
    archived: true,
    reviewStatus: 'reviewed',
    ocrStatus: 'reviewed',
    naturalKeyDuplicate: false,
    currentValuesConfirmed: true,
    hasSourceFile: true,
    lines: [
      { id: 'line-3', materialName: 'BV 电线', spec: '2.5 mm²', unit: 'm', unitPrice: 2.8, amount: 28, currentValueConfirmed: true },
    ],
  },
  {
    id: 'delivery-3',
    projectId: 'project-b',
    supplierId: 'supplier-b',
    orderNo: 'XS-003',
    deliveryDate: '2026-05-02',
    archived: true,
    reviewStatus: 'reviewed',
    ocrStatus: 'reviewed',
    naturalKeyDuplicate: false,
    currentValuesConfirmed: true,
    hasSourceFile: true,
    lines: [
      { id: 'line-4', materialName: '水泥', spec: 'P.O 42.5', unit: '吨', unitPrice: 430, amount: 430, currentValueConfirmed: true },
    ],
  },
]

const suppliers = [
  { id: 'supplier-a', name: '甲厂' },
  { id: 'supplier-b', name: '乙厂' },
]

const projects = [
  { id: 'project-a', name: '项目甲' },
  { id: 'project-b', name: '项目乙' },
]

const contracts = [
  {
    id: 'contract-1',
    kind: '材采',
    supplierId: 'supplier-a',
    projectId: 'project-a',
    name: '电线采购合同',
    no: 'CG-001',
    amount: 100000,
    signDate: '2026-01-01',
  },
]

describe('materialPriceAnalysisScreen', () => {
  it('没有已归档价格事实时显示明确空态且不伪造价格', () => {
    render(MaterialPriceAnalysisScreen, {
      props: {
        records: [],
        suppliers,
        projects,
        contracts,
      },
      global,
    })

    const empty = screen.getByRole('status')
    expect(empty.textContent).toContain('尚无可分析的材料价格')
    expect(empty.textContent).toContain('只读取已归档送货单明细')
    expect(screen.queryByText('厂家最新价对比')).toBeNull()
  })

  it('搜索选择材料后按价格事实切换趋势/厂家比较，并展示来源与合作合同', async () => {
    render(MaterialPriceAnalysisScreen, {
      props: {
        records,
        suppliers,
        projects,
        contracts,
      },
      global,
    })

    const search = screen.getByRole('searchbox', { name: '搜索材料名称、规格或单位' })
    await fireEvent.update(search, '电线')

    const catalog = screen.getByRole('listbox', { name: '可分析材料' })
    const wire = within(catalog).getByRole('option', { name: /BV 电线.*2\.5 mm².*m/ })
    await fireEvent.click(wire)

    expect(screen.getByRole('heading', { name: 'BV 电线 · 1×2.5 mm²' })).not.toBeNull()
    expect(screen.getByText('官方与市场趋势')).not.toBeNull()
    expect(screen.getByRole('img', { name: 'BV 电线 1×2.5 mm² 价格趋势图' })).not.toBeNull()
    expect(screen.getByRole('link', { name: /XS-002/ })).not.toBeNull()
    expect(
      screen.getByRole('link', { name: '查看广州官方价格信息' }).getAttribute('href'),
    ).toBe('https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/jgxx/')

    const official = screen.getByRole('region', { name: '官方信息价对比' })
    expect(within(official).getByText('280304800070120011')).not.toBeNull()
    expect(within(official).getByText('¥2,046.92/千米')).not.toBeNull()
    expect(within(official).getByText('已换算 ¥2.04692/m')).not.toBeNull()
    expect(within(official).getByText('+36.79%')).not.toBeNull()
    expect(within(official).getByText('信息价环比')).not.toBeNull()
    expect(within(official).getByText('-0.47%')).not.toBeNull()
    expect(within(official).getByText(/-¥0\.00958\/m · 较 2026-05/)).not.toBeNull()
    expect(within(official).getByText(/信息价是市场综合参考，不是政府定价/)).not.toBeNull()
    expect(screen.getAllByText('广州官方信息价')).toHaveLength(2)

    const contractsRegion = screen.getByRole('region', { name: '相关厂家合作合同' })
    expect(within(contractsRegion).getByText('项目甲')).not.toBeNull()
    expect(within(contractsRegion).getByRole('link', { name: '电线采购合同' })).not.toBeNull()

    await fireEvent.update(search, '水泥')
    await fireEvent.click(within(catalog).getByRole('option', { name: /水泥.*P\.O 42\.5.*吨/ }))

    expect(screen.getByText('厂家最新价对比')).not.toBeNull()
    expect(within(official).getByText(/当前材料暂无对应官方记录/)).not.toBeNull()
    expect(screen.getByText('最低价')).not.toBeNull()
    expect(screen.getAllByText('¥410.00').length).toBeGreaterThan(0)
    expect(screen.getByText('价差')).not.toBeNull()
  })

  it.each(['2.5mm2', '1×2.5 mm²'])('使用等价截面 %s 搜索时能找到同一电线材料', async (query) => {
    render(MaterialPriceAnalysisScreen, {
      props: {
        records,
        suppliers,
        projects,
        contracts,
      },
      global,
    })

    const search = screen.getByRole('searchbox', { name: '搜索材料名称、规格或单位' })

    await fireEvent.update(search, query)
    expect(
      screen.getByRole('option', { name: /BV 电线.*1×2\.5 mm².*m/ }),
    ).not.toBeNull()
  })

  it('支持按官方材料大类过滤材料，但分类不会伪造官方价格', async () => {
    render(MaterialPriceAnalysisScreen, {
      props: {
        records,
        suppliers,
        projects,
        contracts,
      },
      global,
    })

    await fireEvent.click(screen.getByRole('button', { name: '按官方材料大类筛选，已选 0 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: /电线电缆/ }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const catalog = screen.getByRole('listbox', { name: '可分析材料' })
    expect(within(catalog).getAllByRole('option')).toHaveLength(1)
    expect(within(catalog).getByText('电线电缆')).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '按官方材料大类筛选，已选 1 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: /水泥、砂石及混凝土制品/ }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(within(catalog).getAllByRole('option')).toHaveLength(2)
    expect(within(catalog).getAllByRole('option', { selected: true })).toHaveLength(1)
    await fireEvent.update(screen.getByRole('searchbox'), '水泥')
    expect(within(catalog).getAllByRole('option')).toHaveLength(1)
    expect(within(catalog).getByText('水泥、砂石及混凝土制品')).not.toBeNull()
    expect(screen.getByRole('heading', { name: '水泥 · P.O 42.5' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '按官方材料大类筛选，已选 2 项' }))
    expect(screen.getByRole('checkbox', { name: /电线电缆/ })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await fireEvent.update(screen.getByRole('searchbox'), '')
    expect(within(catalog).getAllByRole('option')).toHaveLength(2)
  })
})
