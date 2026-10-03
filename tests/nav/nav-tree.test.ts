import { describe, expect, it } from 'vitest'
import {
  activeNavKey,
  DEFAULT_OPEN_GROUPS,
  ensureActiveGroupOpen,
  filterNavTree,
  NAV_TREE,
  toggleExclusiveGroup,
} from '~/lib/nav/nav-tree'

function leaves() {
  return NAV_TREE.flatMap(node => node.type === 'group' ? node.items : [node])
}

describe('侧栏导航树', () => {
  it('每个导航叶子都有可静态提取的 Lucide 图标', () => {
    expect(leaves().every(item => item.icon.startsWith('i-lucide-'))).toBe(true)
  })

  it('按名称或副提示搜索，并返回真实导航入口', () => {
    const byLabel = filterNavTree(NAV_TREE, '付款申请')
    const payment = byLabel.flatMap(node => node.type === 'group' ? node.items : [node])
    expect(payment).toHaveLength(1)
    expect(payment[0]).toMatchObject({
      key: 'payApply',
      to: '/finance/payment',
    })

    const pendingPayment = filterNavTree(NAV_TREE, '待支付工作台')
      .flatMap(node => node.type === 'group' ? node.items : [node])
    expect(pendingPayment).toHaveLength(1)
    expect(pendingPayment[0]).toMatchObject({
      key: 'payManage',
      to: '/finance/payment-management',
    })

    const byHint = filterNavTree(NAV_TREE, 'OCR 处理区')
    const delivery = byHint.flatMap(node => node.type === 'group' ? node.items : [node])
    expect(delivery.map(item => item.key)).toEqual(['delivery'])
  })

  it('分组名称命中时仍只返回真正匹配的叶子', () => {
    const results = filterNavTree(NAV_TREE, '分包')
      .flatMap(node => node.type === 'group' ? node.items : [node])

    expect(results.map(item => item.key)).toEqual([
      'subContract',
      'subChange',
      'subSettle',
    ])
    expect(results.every(item => `${item.label} ${item.hint}`.includes('分包'))).toBe(true)
  })

  it('空关键词返回完整导航树', () => {
    expect(filterNavTree(NAV_TREE, '')).toBe(NAV_TREE)
  })

  it('目录使用单开手风琴，恢复旧状态时只保留当前路由所属分组', () => {
    expect(DEFAULT_OPEN_GROUPS).toEqual([])
  })

  it.each([
    { case: '[] / \'project\'', input: [], argument2: 'project', expected: ['g-project'] },
    { case: '[\'g-project\'] / \'project\'', input: ['g-project'], argument2: 'project', expected: ['g-project'] },
    { case: '[\'g-owner\', \'g-material\', \'g-settings\'] / \'project\'', input: ['g-owner', 'g-material', 'g-settings'], argument2: 'project', expected: ['g-project'] },
    { case: '[\'g-owner\', \'g-material\'] / null', input: ['g-owner', 'g-material'], argument2: null, expected: ['g-material'] },
  ])('目录使用单开手风琴，恢复旧状态时只保留当前路由所属分组 / ensureActiveGroupOpen：$case', ({ input, argument2, expected }) => {
    expect(ensureActiveGroupOpen(input, argument2)).toEqual(expected)
  })

  it.each([
    { case: '[\'g-project\'] / \'g-owner\'', input: ['g-project'], argument2: 'g-owner', expected: ['g-owner'] },
    { case: '[\'g-owner\'] / \'g-owner\'', input: ['g-owner'], argument2: 'g-owner', expected: [] },
  ])('点击一级目录时关闭前一个，再次点击当前目录则收起 / toggleExclusiveGroup：$case', ({ input, argument2, expected }) => {
    expect(toggleExclusiveGroup(input, argument2)).toEqual(expected)
  })

  it('送货单归档库入口可导航，列表与详情都点亮归档库', () => {
    expect(leaves().find(item => item.key === 'deliveryArchive')?.to).toBe('/material/delivery/archive')
  })

  it.each([
    { case: '\'/material/delivery/archive\'', input: '/material/delivery/archive', expected: 'deliveryArchive' },
    { case: '\'/material/delivery/archive/del_1\'', input: '/material/delivery/archive/del_1', expected: 'deliveryArchive' },
    { case: '\'/material/delivery\'', input: '/material/delivery', expected: 'delivery' },
  ])('送货单归档库入口可导航，列表与详情都点亮归档库 / activeNavKey：$case', ({ input, expected }) => {
    expect(activeNavKey(input)).toBe(expected)
  })

  it('施工进度入口与新建子路由都点亮排程导航', () => {
    expect(leaves().find(item => item.key === 'schedule')?.to).toBe('/schedule')
  })

  it.each([
    { case: '\'/schedule\'', input: '/schedule', expected: 'schedule' },
    { case: '\'/schedule/new\'', input: '/schedule/new', expected: 'schedule' },
  ])('施工进度入口与新建子路由都点亮排程导航 / activeNavKey：$case', ({ input, expected }) => {
    expect(activeNavKey(input)).toBe(expected)
  })

  it('f1 客户与目标成本入口已启用并保持子路由点亮', () => {
    expect(leaves().find(item => item.key === 'customer')?.to).toBe('/base/customer')
    expect(leaves().find(item => item.key === 'targetCost')?.to).toBe('/project/target-cost')
  })

  it.each([
    { case: '\'/base/customer/form/customer_1\'', input: '/base/customer/form/customer_1', expected: 'customer' },
    { case: '\'/project/target-cost/form/target_1\'', input: '/project/target-cost/form/target_1', expected: 'targetCost' },
  ])('f1 客户与目标成本入口已启用并保持子路由点亮 / activeNavKey：$case', ({ input, expected }) => {
    expect(activeNavKey(input)).toBe(expected)
  })

  it('boq 工作区与专用拆表页开放入口并点亮各自导航', () => {
    expect(leaves().find(item => item.key === 'boqList')?.to).toBe('/contract/boq')
    expect(leaves().find(item => item.key === 'boqImport')?.to).toBe('/contract/boq/import')
  })

  it.each([
    { case: '\'/contract/boq\'', input: '/contract/boq', expected: 'boqList' },
    { case: '\'/contract/boq/import\'', input: '/contract/boq/import', expected: 'boqImport' },
  ])('boq 工作区与专用拆表页开放入口并点亮各自导航 / activeNavKey：$case', ({ input, expected }) => {
    expect(activeNavKey(input)).toBe(expected)
  })

  it('f2 三类新增台账入口已启用，表单子路由保持来源导航点亮', () => {
    expect(leaves().find(item => item.key === 'companyExp')?.to).toBe('/contract/company-expense')
    expect(leaves().find(item => item.key === 'otherExp')?.to).toBe('/contract/other-expense')
    expect(leaves().find(item => item.key === 'otherSettle')?.to).toBe('/contract/other-settlement')
  })

  it.each([
    { case: '\'/contract/company-expense/form/company_1\'', input: '/contract/company-expense/form/company_1', expected: 'companyExp' },
    { case: '\'/contract/other-expense/form/contract_1\'', input: '/contract/other-expense/form/contract_1', expected: 'otherExp' },
    { case: '\'/contract/other-settlement/form/settlement_1\'', input: '/contract/other-settlement/form/settlement_1', expected: 'otherSettle' },
  ])('f2 三类新增台账入口已启用，表单子路由保持来源导航点亮 / activeNavKey：$case', ({ input, expected }) => {
    expect(activeNavKey(input)).toBe(expected)
  })

  it.each(Array.from([
    ['receipt', '/finance/receipt'],
    ['invApply', '/finance/billing'],
    ['current', '/finance/current'],
    ['payRecord', '/finance/records'],
    ['reimburse', '/finance/reimbursement'],
    ['payApply', '/finance/payment'],
  ] as const))('f3 六类资金表单入口已启用，新增和编辑路由保持来源导航点亮：输入案例 %#', (key, route) => {
    expect(leaves().find(item => item.key === key)?.to).toBe(route)
    expect(activeNavKey(`${route}/new`)).toBe(key)
    expect(activeNavKey(`${route}/form/f3_1`)).toBe(key)
  })

  it.each(Array.from([
    ['matRequisition', '/material/requisition'],
    ['matArrival', '/material/arrival'],
    ['matUse', '/material/use'],
    ['matSettle', '/material/settlement'],
    ['stockCheck', '/material/stock-check'],
    ['omTotal', '/owner-material/control'],
    ['omRequisition', '/owner-material/requisition'],
    ['omArrival', '/owner-material/arrival'],
    ['omUse', '/owner-material/use'],
    ['omDirect', '/owner-material/direct'],
  ] as const))('f4 乙供材与甲供材入口全部启用，整页表单保持来源导航点亮：输入案例 %#', (key, route) => {
    expect(leaves().find(item => item.key === key)?.to).toBe(route)
    expect(activeNavKey(`${route}/new`)).toBe(key)
    expect(activeNavKey(`${route}/f4_1`)).toBe(key)
    expect(activeNavKey('/material/delivery/archive/form')).toBe('deliveryArchive')
    expect(activeNavKey('/material/delivery/archive/form/delivery_1')).toBe('deliveryArchive')
  })

  it('付款管理工作台入口已启用，且不会被付款申请前缀误点亮', () => {
    expect(leaves().find(item => item.key === 'payManage')?.to)
      .toBe('/finance/payment-management')
  })

  it.each([
    { case: '\'/finance/payment-management\'', input: '/finance/payment-management', expected: 'payManage' },
    { case: '\'/finance/payment/payment_1\'', input: '/finance/payment/payment_1', expected: 'payApply' },
  ])('付款管理工作台入口已启用，且不会被付款申请前缀误点亮 / activeNavKey：$case', ({ input, expected }) => {
    expect(activeNavKey(input)).toBe(expected)
  })

  it.each(Array.from([
    ['ownerChange', '/owner/change'],
    ['ownerReport', '/owner/report'],
    ['acceptance', '/owner/acceptance'],
    ['finalSettle', '/owner/final-settlement'],
    ['ownerPenalty', '/owner/penalty'],
    ['subChange', '/subcontract/change'],
    ['subSettle', '/subcontract/settlement'],
    ['projPenalty', '/project/penalty'],
  ] as const))('f5 八类甲方与分包单据入口全部启用，新增和编辑路由保持来源导航点亮：输入案例 %#', (key, route) => {
    expect(leaves().find(item => item.key === key)?.to).toBe(route)
    expect(activeNavKey(`${route}/new`)).toBe(key)
    expect(activeNavKey(`${route}/f5_1`)).toBe(key)
  })
})
