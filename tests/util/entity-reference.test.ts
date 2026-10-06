import { describe, expect, it } from 'vitest'
import { isEntityRefDTO, isUnavailableEntityNavigationDTO } from '~/types/read-model'

describe('公共 EntityRef DTO 的身份边界', () => {
  it.each([
    { state: 'resolved', entity: 'project', id: 'project-visible', label: '可读项目', no: null },
    { state: 'missing', entity: 'customer', id: null, label: null, reason: 'not-configured' },
    { state: 'missing', entity: 'customer', id: null, label: null, reason: 'not-recorded' },
    { state: 'missing', entity: 'contract', id: null, label: null, reason: 'not-applicable' },
    { state: 'forbidden', entity: 'supplier', id: null, label: null, reason: 'permission-denied' },
    { state: 'unavailable', entity: 'customer', id: null, label: null, reason: 'source-unavailable' },
  ])('接受完整现行引用：$state/$entity/$reason', (reference) => {
    expect(isEntityRefDTO(reference)).toBe(true)
  })

  it.each([
    { state: 'forbidden', entity: 'project', id: 'restricted-project', label: null, reason: 'permission-denied' },
    { state: 'unavailable', entity: 'project', id: 'unverified-project', label: null, reason: 'source-unavailable' },
    { state: 'unavailable', entity: 'project', id: null, label: '旧缓存项目', reason: 'source-unavailable' },
    { state: 'forbidden', entity: 'project', id: null, label: null, reason: 'source-unavailable' },
    { state: 'missing', entity: 'project', id: null, label: null, reason: 'anything' },
    { state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied', targetId: 'restricted-project' },
    { state: 'resolved', entity: 'project', id: '', label: '空身份', no: null },
    { state: 'resolved', entity: 'project', id: 'p', label: '缺编号字段' },
    { state: 'resolved', entity: 'unregistered-entity', id: 'p', label: '无效类型', no: null },
  ])('拒绝受限身份、额外定位、伪原因或残缺对象：$state/$reason', (reference) => {
    expect(isEntityRefDTO(reference)).toBe(false)
  })

  it('限定期待实体，导航拒绝附加隐藏身份及错误状态原因', () => {
    const reference = { state: 'unavailable', entity: 'customer', id: null, label: null, reason: 'source-unavailable' } as const
    expect(isEntityRefDTO(reference, 'project')).toBe(false)
    expect(isUnavailableEntityNavigationDTO({ kind: 'unavailable', reason: 'not-connected' }, reference)).toBe(true)
    expect(isUnavailableEntityNavigationDTO({ kind: 'unavailable', reason: 'missing-id' }, reference)).toBe(false)
    expect(isUnavailableEntityNavigationDTO({ kind: 'unavailable', reason: 'not-connected', filters: { customerId: 'hidden' } }, reference)).toBe(false)
    expect(isUnavailableEntityNavigationDTO({ kind: 'unavailable', reason: 'not-connected', subject: { id: 'hidden' } }, reference)).toBe(false)
  })
})
