import { describe, expect, it } from 'vitest'
import { validateConstructionContractReturnTo } from '~/lib/construction-contract/return-context'
import { resolveEntityLink } from '~/lib/kit/entity-link'
import { registeredTargetKeys, resolveNavigationTarget } from '~/lib/nav/target-registry'

describe('entityLink 解析（specs §07：type→route 唯一映射 + 退化不做死链）', () => {
  it.each([
    { case: '{ type: \'project\', id: \'p1\', label: \'合和新城\' }', input: { type: 'project', id: 'p1', label: '合和新城' }, expected: { state: 'resolved', to: '/project/p1', label: '合和新城' } },
    { case: '{ type: \'supplier\', id: \'s6\', label: \'陈家班\' }', input: { type: 'supplier', id: 's6', label: '陈家班' }, expected: { state: 'resolved', to: '/base/supplier/s6', label: '陈家班' } },
    { case: '{ type: \'contract\', id: \'fb01\', label: \'总包合同\' }', input: { type: 'contract', id: 'fb01', label: '总包合同' }, expected: { state: 'resolved', to: '/contract/fb01', label: '总包合同' } },
    { case: '{ type: \'invoice\', id: \'iv9\', label: \'票 00058760\' }', input: { type: 'invoice', id: 'iv9', label: '票 00058760' }, expected: { state: 'resolved', to: '/finance/invoice/iv9', label: '票 00058760' } },
    { case: '{ type: \'customer\', id: \'c1\', label: \'保利发展\' }', input: { type: 'customer', id: 'c1', label: '保利发展' }, expected: { state: 'resolved', to: '/base/customer/c1', label: '保利发展' } },
  ])('已实装类型 + id + label → 蓝链，路由按映射表 / resolveEntityLink：$case', ({ input, expected }) => {
    expect(resolveEntityLink(input)).toEqual(expected)
  })

  it.each([
    { case: '{ type: \'project\', id: \'p1\', label: \'测试项目\', dataOrigin: \'demo\', }', input: {
      type: 'project',
      id: 'p1',
      label: '测试项目',
      dataOrigin: 'demo',
    }, expected: { state: 'resolved', to: '/project/p1?origin=demo', label: '测试项目' } },
    { case: '{ type: \'project\', id: \'p1\', label: \'正式项目\', dataOrigin: \'real\', }', input: {
      type: 'project',
      id: 'p1',
      label: '正式项目',
      dataOrigin: 'real',
    }, expected: { state: 'resolved', to: '/project/p1?origin=real', label: '正式项目' } },
  ])('项目来源感知链接始终显式携带来源身份 / resolveEntityLink：$case', ({ input, expected }) => {
    expect(resolveEntityLink(input)).toEqual(expected)
  })

  it.each([
    { case: '{ type: \'customer\', id: \'c-demo\', label: \'演示客户\', dataOrigin: \'demo\', }', input: {
      type: 'customer',
      id: 'c-demo',
      label: '演示客户',
      dataOrigin: 'demo',
    }, expected: { state: 'resolved', to: '/base/customer/c-demo?origin=demo', label: '演示客户' } },
    { case: '{ type: \'customer\', id: \'c-real\', label: \'正式客户\', dataOrigin: \'real\', }', input: {
      type: 'customer',
      id: 'c-real',
      label: '正式客户',
      dataOrigin: 'real',
    }, expected: { state: 'resolved', to: '/base/customer/c-real?origin=real', label: '正式客户' } },
  ])('客户详情消费来源策略后，来源感知关联保留身份 / resolveEntityLink：$case', ({ input, expected }) => {
    expect(resolveEntityLink(input)).toEqual(expected)
  })

  it.each([
    { case: '{ type: \'crew\', id: \'g1\', label: \'泥水一组\' }', input: { type: 'crew', id: 'g1', label: '泥水一组' }, expected: { state: 'resolved', to: '/base/crew/g1', label: '泥水一组' } },
    { case: '{ type: \'worker\', id: \'w1\', label: \'张三\', dataOrigin: \'demo\' }', input: { type: 'worker', id: 'w1', label: '张三', dataOrigin: 'demo' }, expected: { state: 'resolved', to: '/base/worker/w1?origin=demo', label: '张三' } },
  ])('班组与工人使用稳定 ID 进入中央详情，并保留来源身份 / resolveEntityLink：$case', ({ input, expected }) => {
    expect(resolveEntityLink(input)).toEqual(expected)
  })

  it('班组—工人业务事实使用稳定事实 ID 穿透到责任单元、工资单和扣罚单', () => {
    expect(registeredTargetKeys()).toEqual(expect.arrayContaining([
      'quantity-unit:detail',
      'wage-statement:detail',
      'subcontract-document:penalty-detail',
    ]))
  })

  it.each([
    { case: '{ kind: \'entity-detail\', subject: { state: \'resolved\', entity: \'quantity-unit\', id: \'u1\', label: \'201户\', no: null }, variant:', input: {
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'quantity-unit', id: 'u1', label: '201户', no: null },
      variant: 'detail',
      view: null,
      filters: { projectId: 'p1', dataOrigin: 'real' },
    }, expected: { state: 'resolved', to: '/subcontract/quantity/p1/u1?origin=real', label: '201户' } },
    { case: '{ kind: \'entity-detail\', subject: { state: \'resolved\', entity: \'wage-statement\', id: \'ws1\', label: \'7月工资单\', no: null }, varia', input: {
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'wage-statement', id: 'ws1', label: '7月工资单', no: null },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'real' },
    }, expected: { state: 'resolved', to: '/subcontract/payroll/ws1?origin=real', label: '7月工资单' } },
    { case: '{ kind: \'entity-detail\', subject: { state: \'resolved\', entity: \'subcontract-document\', id: \'f1\', label: \'FK-1\', no: null }, v', input: {
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'subcontract-document', id: 'f1', label: 'FK-1', no: null },
      variant: 'penalty-detail',
      view: null,
      filters: { dataOrigin: 'real' },
    }, expected: { state: 'unverified-target', label: 'FK-1', message: '目标待核验' } },
  ])('班组—工人业务事实使用稳定事实 ID 穿透到责任单元、工资单和扣罚单 / resolveNavigationTarget：$case', ({ input, expected }) => {
    expect(resolveNavigationTarget(input)).toEqual(expected)
  })

  it('中央班组工人事实链携带来源主体和经校验的返回上下文', () => {
    const target = resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'wage-statement', id: 'ws1', label: '7月工资单', no: null },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo', ownerKind: 'worker', ownerId: 'w1' },
    }, { returnTo: '/base/worker/w1?origin=demo' })

    expect(target).toEqual({
      state: 'resolved',
      label: '7月工资单',
      to: '/subcontract/payroll/ws1?origin=demo&ownerKind=worker&ownerId=w1&returnTo=%2Fbase%2Fworker%2Fw1%3Forigin%3Ddemo',
    })
  })

  describe('补充协议只用稳定事实 ID 生成合同类别对应的 canonical 聚焦地址', () => {
    const intent = (contractKind: '施工' | '分包', view: string | null) => ({
      kind: 'entity-subview' as const,
      subject: { state: 'resolved' as const, entity: 'contract' as const, id: 'contract-1', label: '主合同', no: 'HT-1' },
      variant: 'supplement' as const,
      view,
      filters: { dataOrigin: 'real' as const, contractKind },
    })
    it.each([
      { case: 'intent(\'施工\', \'supplement-1\')', input: intent('施工', 'supplement-1'), expected: {
        state: 'resolved',
        to: '/contract/contract-1?origin=real&contractKind=construction&tab=supplements&focus=supplement-1',
      } },
      { case: 'intent(\'分包\', \'supplement-1\')', input: intent('分包', 'supplement-1'), expected: {
        state: 'resolved',
        to: '/contract/contract-1?origin=real&contractKind=subcontract&tab=changes&focus=supplement-1',
      } },
      { case: 'intent(\'施工\', null)', input: intent('施工', null), expected: { state: 'error' } },
      { case: 'intent(\'施工\', \'targetless focus\')', input: intent('施工', 'targetless focus'), expected: { state: 'error' } },
      { case: '{ ...intent(\'施工\', \'supplement-1\'), filters: { dataOrigin: \'real\' }, }', input: {
        ...intent('施工', 'supplement-1'),
        filters: { dataOrigin: 'real' },
      }, expected: { state: 'error' } },
      { case: '{ ...intent(\'施工\', \'supplement-1\'), filters: { contractKind: \'施工\' }, }', input: {
        ...intent('施工', 'supplement-1'),
        filters: { contractKind: '施工' },
      }, expected: { state: 'error' } },
      { case: '{ ...intent(\'施工\', \'supplement-1\'), filters: { dataOrigin: \'real\', contractKind: \'材采\' }, }', input: {
        ...intent('施工', 'supplement-1'),
        filters: { dataOrigin: 'real', contractKind: '材采' },
      }, expected: { state: 'error' } },
    ])('resolveNavigationTarget：$case', ({ input, expected }) => {
      expect(resolveNavigationTarget(structuredClone(input))).toMatchObject(expected)
    })
  })

  it('补充协议 canonical 目标仅携带经来源校验的合同列表返回上下文', () => {
    const returnTo = '/contract/construction?origin=real&search=主合同&nav=origin_322_focus#construction-contract-row-real%3Acontract-1'
    const target = resolveNavigationTarget({
      kind: 'entity-subview',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-1', label: '主合同', no: 'HT-1' },
      variant: 'supplement',
      view: 'supplement-1',
      filters: { dataOrigin: 'real', contractKind: '施工' },
    }, { returnTo })
    const canonicalReturnTo = validateConstructionContractReturnTo(returnTo, 'real')!

    expect(target).toMatchObject({
      state: 'resolved',
      to: `/contract/contract-1?origin=real&contractKind=construction&tab=supplements&focus=supplement-1&returnTo=${encodeURIComponent(canonicalReturnTo)}`,
    })
  })

  it.each([
    { case: '{ type: \'project\', label: \'车陂商业大楼\' }', input: { type: 'project', label: '车陂商业大楼' }, expected: { state: 'missing', label: '车陂商业大楼', message: '未记录稳定身份' } },
    { case: '{ type: \'project\', id: \'p1\' }', input: { type: 'project', id: 'p1' }, expected: { state: 'empty', label: null } },
    { case: '{ type: \'project\', id: \'p1\', label: \'\' }', input: { type: 'project', id: 'p1', label: '' }, expected: { state: 'empty', label: null } },
  ])('有 label 无 id → 纯文本；label 解析为空 → 空态「—」 / resolveEntityLink：$case', ({ input, expected }) => {
    expect(resolveEntityLink(input)).toEqual(expected)
  })

  it.each([
    { entity: 'material-quotation', id: 'quote-actual-1', label: '实际独立报价', variant: 'detail', to: '/material/quotations/quote-actual-1?origin=real' },
    { entity: 'settlement', id: 'other-actual-1', label: '实际原费用结算', variant: 'other_settlement', to: '/contract/other-settlement/other-actual-1?origin=real' },
  ])('实际详情$entity保稳定ID及真实来源，错误来源和缺ID不能生成蓝链', ({ entity, id, label, variant, to }) => {
    const intent = { kind: 'entity-detail', subject: { state: 'resolved', entity, id, label, no: null }, variant, view: null, filters: { dataOrigin: 'real' } }
    expect(resolveNavigationTarget(intent)).toEqual({ state: 'resolved', label, to })
    expect(resolveNavigationTarget({ ...intent, filters: { dataOrigin: 'demo' } })).toMatchObject({ state: 'error' })
    expect(resolveNavigationTarget({ ...intent, filters: {} })).toMatchObject({ state: 'error' })
    expect(resolveNavigationTarget({ ...intent, subject: { state: 'missing', entity, id: null, label, reason: 'not-recorded' } })).toMatchObject({ state: 'missing' })
  })

  it('映射表只登记已实装详情页', () => {
    expect(registeredTargetKeys()).toEqual([
      'attendance:matrix',
      'contract:boq',
      'contract:company_expense',
      'contract:detail',
      'contract:other_expense',
      'contract:owner-document-source',
      'contract:subcontract-document-source',
      'contract:supplement',
      'crew:detail',
      'customer:detail',
      'daywork:ledger',
      'delivery-record:detail',
      'invoice:detail',
      'material-quotation:detail',
      'owner-document:acceptance',
      'owner-document:change',
      'owner-document:final-settlement',
      'owner-document:penalty',
      'owner-document:report',
      'owner-document:warranty',
      'payment-application:detail',
      'process-library:detail',
      'project:detail',
      'project:supplier-workbench',
      'quantity-unit:detail',
      'quantity-unit:hollow-record',
      'receipt:detail',
      'settlement:other_settlement',
      'subcontract-document:change',
      'subcontract-document:penalty',
      'subcontract-document:penalty-detail',
      'subcontract-document:settlement',
      'supplier:credentials',
      'supplier:detail',
      'target-cost:detail',
      'wage-actual:detail',
      'wage-adjustment:detail',
      'wage-statement:detail',
      'worker:detail',
    ])
  })
})
