import { describe, expect, it } from 'vitest'
import { ENTITY_ROUTES, resolveEntityLink } from '~/lib/kit/entity-link'

describe('entityLink 解析（specs §07：type→route 唯一映射 + 退化不做死链）', () => {
  it('已实装类型 + id + label → 蓝链，路由按映射表', () => {
    expect(resolveEntityLink({ type: 'project', id: 'p1', label: '合和新城' }))
      .toEqual({ kind: 'link', to: '/project/p1', text: '合和新城' })
    expect(resolveEntityLink({ type: 'supplier', id: 's6', label: '陈家班' }))
      .toEqual({ kind: 'link', to: '/base/supplier/s6', text: '陈家班' })
    expect(resolveEntityLink({ type: 'contract', id: 'fb01', label: '总包合同' }))
      .toEqual({ kind: 'link', to: '/contract/fb01', text: '总包合同' })
    expect(resolveEntityLink({ type: 'invoice', id: 'iv9', label: '票 00058760' }))
      .toEqual({ kind: 'link', to: '/finance/invoice/iv9', text: '票 00058760' })
    expect(resolveEntityLink({ type: 'customer', id: 'c1', label: '保利发展' }))
      .toEqual({ kind: 'link', to: '/base/customer/c1', text: '保利发展' })
  })

  it('未实装类型（crew/worker）退化纯文本，不做死链', () => {
    expect(resolveEntityLink({ type: 'crew', id: 'g1', label: '泥水一组' }))
      .toEqual({ kind: 'text', text: '泥水一组' })
  })

  it('有 label 无 id → 纯文本；label 解析为空 → 空态「—」', () => {
    expect(resolveEntityLink({ type: 'project', label: '车陂商业大楼' }))
      .toEqual({ kind: 'text', text: '车陂商业大楼' })
    expect(resolveEntityLink({ type: 'project', id: 'p1' })).toEqual({ kind: 'empty' })
    expect(resolveEntityLink({ type: 'project', id: 'p1', label: '' })).toEqual({ kind: 'empty' })
  })

  it('映射表只登记已实装详情页', () => {
    expect(Object.keys(ENTITY_ROUTES).sort()).toEqual(['contract', 'customer', 'invoice', 'project', 'supplier'])
  })
})
