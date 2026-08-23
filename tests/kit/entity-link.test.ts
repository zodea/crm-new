import { describe, expect, it } from 'vitest'
import { resolveEntityLink } from '~/lib/kit/entity-link'
import { registeredTargetKeys } from '~/lib/nav/target-registry'

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

  it('未实装类型（crew/worker）退化纯文本，不做死链', () => {
    expect(resolveEntityLink({ type: 'crew', id: 'g1', label: '泥水一组' }))
      .toEqual({ state: 'not-connected', label: '泥水一组', message: '详情待接入' })
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
      'customer:detail',
      'invoice:detail',
      'payment-application:detail',
      'project:detail',
      'project:supplier-workbench',
      'receipt:detail',
      'supplier:detail',
    ])
  })
})
