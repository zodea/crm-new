import { describe, expect, it } from 'vitest'
import { resolveEntityLink } from '~/lib/kit/entity-link'
import { registeredTargetKeys, resolveNavigationTarget } from '~/lib/nav/target-registry'

describe('entityLink 解析（specs §07：type→route 唯一映射 + 退化不做死链）', () => {
  it('已实装类型 + id + label → 蓝链，路由按映射表', () => {
    expect(resolveEntityLink({ type: 'project', id: 'p1', label: '合和新城' }))
      .toEqual({ state: 'resolved', to: '/project/p1', label: '合和新城' })
    expect(resolveEntityLink({ type: 'supplier', id: 's6', label: '陈家班' }))
      .toEqual({ state: 'resolved', to: '/base/supplier/s6', label: '陈家班' })
    expect(resolveEntityLink({ type: 'contract', id: 'fb01', label: '总包合同' }))
      .toEqual({ state: 'resolved', to: '/contract/fb01', label: '总包合同' })
    expect(resolveEntityLink({ type: 'invoice', id: 'iv9', label: '票 00058760' }))
      .toEqual({ state: 'resolved', to: '/finance/invoice/iv9', label: '票 00058760' })
    expect(resolveEntityLink({ type: 'customer', id: 'c1', label: '保利发展' }))
      .toEqual({ state: 'resolved', to: '/base/customer/c1', label: '保利发展' })
  })

  it('项目来源感知链接始终显式携带来源身份', () => {
    expect(resolveEntityLink({
      type: 'project',
      id: 'p1',
      label: '测试项目',
      dataOrigin: 'demo',
    })).toEqual({ state: 'resolved', to: '/project/p1?origin=demo', label: '测试项目' })
    expect(resolveEntityLink({
      type: 'project',
      id: 'p1',
      label: '正式项目',
      dataOrigin: 'real',
    })).toEqual({ state: 'resolved', to: '/project/p1?origin=real', label: '正式项目' })
  })

  it('客户详情消费来源策略后，来源感知关联保留身份', () => {
    expect(resolveEntityLink({
      type: 'customer',
      id: 'c-demo',
      label: '演示客户',
      dataOrigin: 'demo',
    })).toEqual({ state: 'resolved', to: '/base/customer/c-demo?origin=demo', label: '演示客户' })
    expect(resolveEntityLink({
      type: 'customer',
      id: 'c-real',
      label: '正式客户',
      dataOrigin: 'real',
    })).toEqual({ state: 'resolved', to: '/base/customer/c-real?origin=real', label: '正式客户' })
  })

  it('班组与工人使用稳定 ID 进入中央详情，并保留来源身份', () => {
    expect(resolveEntityLink({ type: 'crew', id: 'g1', label: '泥水一组' }))
      .toEqual({ state: 'resolved', to: '/base/crew/g1', label: '泥水一组' })
    expect(resolveEntityLink({ type: 'worker', id: 'w1', label: '张三', dataOrigin: 'demo' }))
      .toEqual({ state: 'resolved', to: '/base/worker/w1?origin=demo', label: '张三' })
  })

  it('班组—工人业务事实使用稳定事实 ID 穿透到责任单元、工资单和扣罚单', () => {
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'quantity-unit', id: 'u1', label: '201户', no: null },
      variant: 'detail',
      view: null,
      filters: { projectId: 'p1', dataOrigin: 'real' },
    })).toEqual({ state: 'resolved', to: '/subcontract/quantity/p1/u1', label: '201户' })
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'wage-statement', id: 'ws1', label: '7月工资单', no: null },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'real' },
    })).toEqual({ state: 'resolved', to: '/subcontract/payroll/ws1', label: '7月工资单' })
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'subcontract-document', id: 'f1', label: 'FK-1', no: null },
      variant: 'penalty-detail',
      view: null,
      filters: { dataOrigin: 'real' },
    })).toEqual({ state: 'unverified-target', label: 'FK-1', message: '目标待核验' })
    expect(registeredTargetKeys()).toEqual(expect.arrayContaining([
      'quantity-unit:detail',
      'wage-statement:detail',
      'subcontract-document:penalty-detail',
    ]))
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

  it('有 label 无 id → 纯文本；label 解析为空 → 空态「—」', () => {
    expect(resolveEntityLink({ type: 'project', label: '车陂商业大楼' }))
      .toEqual({ state: 'missing', label: '车陂商业大楼', message: '未记录稳定身份' })
    expect(resolveEntityLink({ type: 'project', id: 'p1' })).toEqual({ state: 'empty', label: null })
    expect(resolveEntityLink({ type: 'project', id: 'p1', label: '' })).toEqual({ state: 'empty', label: null })
  })

  it('映射表只登记已实装详情页', () => {
    expect(registeredTargetKeys()).toEqual([
      'contract:detail',
      'crew:detail',
      'customer:detail',
      'invoice:detail',
      'payment-application:detail',
      'project:detail',
      'project:supplier-workbench',
      'quantity-unit:detail',
      'receipt:detail',
      'subcontract-document:penalty-detail',
      'supplier:detail',
      'wage-statement:detail',
      'worker:detail',
    ])
  })
})
