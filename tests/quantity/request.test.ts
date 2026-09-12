import { describe, expect, it } from 'vitest'
import { parseQuantityBatchReadQuery, parseQuantityCommand, parseQuantityPhotoReadQuery, parseQuantityReadQuery, parseQuantityUnitReadQuery } from '../../server/utils/quantity-request'

describe('工程量 HTTP 请求边界', () => {
  it('读取不能把缺省或演示来源、无效项目混入正式工程量', () => {
    expect(parseQuantityReadQuery({ projectId: 'p', origin: 'real', includeDemo: 'false' })).toEqual({ projectId: 'p', origin: 'real', includeDemo: false })
    expect(() => parseQuantityReadQuery({ projectId: 'p', origin: 'demo' })).toThrow('不接受其他')
    expect(() => parseQuantityReadQuery({ projectId: null, origin: 'real' })).toThrow('有效项目')
    expect(() => parseQuantityReadQuery({ projectId: 'p', origin: 'real', includeDemo: 'yes' })).toThrow('有效项目')
  })

  it('命令要求身份、能力和版本，并固化入口草稿', () => {
    const body = { workspaceId: 'w', actorId: 'a', commandId: 'c', projectId: 'p', baseVersion: 'quantity:p:0', requiredCapability: 'quantity:write', origin: 'real', action: { kind: 'create-building', draft: { code: '1', name: '1栋' } } }
    const command = parseQuantityCommand(body)
    body.action.draft.name = '后续输入'
    expect(command.action).toMatchObject({ draft: { name: '1栋' } })
    for (const patch of [{ actorId: '' }, { baseVersion: null }, { action: [] }, { origin: 'demo' }, { requiredCapability: 'project:write' }])
      expect(() => parseQuantityCommand({ ...body, ...patch })).toThrow('格式无效')
  })

  it('户、批量阶段和照片查询必须明确完整归属，拒绝空值、重复户和数组注入', () => {
    const query = { projectId: 'p', origin: 'real', includeDemo: false }
    expect(parseQuantityUnitReadQuery({ ...query, unitId: 'u' })).toEqual({ ...query, unitId: 'u' })
    expect(parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds: 'u' })).toEqual({ ...query, trade: '油漆工', unitIds: ['u'] })
    expect(parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds: ['u1', 'u2'] })).toEqual({ ...query, trade: '油漆工', unitIds: ['u1', 'u2'] })
    expect(parseQuantityPhotoReadQuery({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })).toEqual({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })
    for (const patch of [{ unitId: '' }, { unitId: ['u'] }])
      expect(() => parseQuantityUnitReadQuery({ ...query, ...patch })).toThrow()
    for (const unitIds of [[], ['u', 'u'], [''], { u: 'u' }])
      expect(() => parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds })).toThrow()
    expect(() => parseQuantityPhotoReadQuery({ ...query, unitId: 'u', photoId: 'f' })).toThrow()
  })
})
