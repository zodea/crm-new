import { describe, expect, it } from 'vitest'
import { activeNavKey, ensureActiveGroupOpen, filterNavTree, NAV_TREE } from '~/lib/nav/nav-tree'

function leaves() {
  return NAV_TREE.flatMap(node => node.type === 'group' ? node.items : [node])
}

describe('侧栏导航树', () => {
  it('每个导航叶子都有可静态提取的 Lucide 图标', () => {
    expect(leaves().every(item => item.icon.startsWith('i-lucide-'))).toBe(true)
  })

  it('按名称或副提示搜索，并保留待建项的不可导航状态', () => {
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
    expect(pendingPayment[0]).toMatchObject({ key: 'payManage' })
    expect(pendingPayment[0]).not.toHaveProperty('to')

    const byHint = filterNavTree(NAV_TREE, 'OCR 处理区')
    const delivery = byHint.flatMap(node => node.type === 'group' ? node.items : [node])
    expect(delivery.map(item => item.key)).toEqual(['delivery'])
  })

  it('空关键词返回完整导航树', () => {
    expect(filterNavTree(NAV_TREE, '')).toBe(NAV_TREE)
  })

  it('本地状态恢复后仍展开当前叶子所属分组', () => {
    expect(ensureActiveGroupOpen([], 'project')).toEqual(['g-project'])
    expect(ensureActiveGroupOpen(['g-project'], 'project')).toEqual(['g-project'])
  })

  it('送货单归档库入口可导航，列表与详情都点亮归档库', () => {
    expect(leaves().find(item => item.key === 'deliveryArchive')?.to).toBe('/material/delivery/archive')
    expect(activeNavKey('/material/delivery/archive')).toBe('deliveryArchive')
    expect(activeNavKey('/material/delivery/archive/del_1')).toBe('deliveryArchive')
    expect(activeNavKey('/material/delivery')).toBe('delivery')
  })

  it('施工进度入口与新建子路由都点亮排程导航', () => {
    expect(leaves().find(item => item.key === 'schedule')?.to).toBe('/schedule')
    expect(activeNavKey('/schedule')).toBe('schedule')
    expect(activeNavKey('/schedule/new')).toBe('schedule')
  })

  it('f1 客户与目标成本入口已启用并保持子路由点亮', () => {
    expect(leaves().find(item => item.key === 'customer')?.to).toBe('/base/customer')
    expect(activeNavKey('/base/customer/form/customer_1')).toBe('customer')
    expect(leaves().find(item => item.key === 'targetCost')?.to).toBe('/project/target-cost')
    expect(activeNavKey('/project/target-cost/form/target_1')).toBe('targetCost')
  })

  it('boq 工作区与专用拆表页开放入口并点亮各自导航', () => {
    expect(leaves().find(item => item.key === 'boqList')?.to).toBe('/contract/boq')
    expect(leaves().find(item => item.key === 'boqImport')?.to).toBe('/contract/boq/import')
    expect(activeNavKey('/contract/boq')).toBe('boqList')
    expect(activeNavKey('/contract/boq/import')).toBe('boqImport')
  })

  it('f2 三类新增台账入口已启用，表单子路由保持来源导航点亮', () => {
    expect(leaves().find(item => item.key === 'companyExp')?.to).toBe('/contract/company-expense')
    expect(leaves().find(item => item.key === 'otherExp')?.to).toBe('/contract/other-expense')
    expect(leaves().find(item => item.key === 'otherSettle')?.to).toBe('/contract/other-settlement')
    expect(activeNavKey('/contract/company-expense/form/company_1')).toBe('companyExp')
    expect(activeNavKey('/contract/other-expense/form/contract_1')).toBe('otherExp')
    expect(activeNavKey('/contract/other-settlement/form/settlement_1')).toBe('otherSettle')
  })

  it('f3 六类资金表单入口已启用，新增和编辑路由保持来源导航点亮', () => {
    const routes = [
      ['receipt', '/finance/receipt'],
      ['invApply', '/finance/billing'],
      ['current', '/finance/current'],
      ['payRecord', '/finance/records'],
      ['reimburse', '/finance/reimbursement'],
      ['payApply', '/finance/payment'],
    ] as const

    for (const [key, route] of routes) {
      expect(leaves().find(item => item.key === key)?.to).toBe(route)
      expect(activeNavKey(`${route}/new`)).toBe(key)
      expect(activeNavKey(`${route}/form/f3_1`)).toBe(key)
    }
  })
})
