import { describe, expect, it } from 'vitest'
import { parseQuantityBatchReadQuery, parseQuantityCommand, parseQuantityPhotoReadQuery, parseQuantityReadQuery, parseQuantityUnitReadQuery } from '../../server/utils/quantity-request'

describe('工程量 HTTP 请求边界', () => {
  it('读取不能把缺省或演示来源、无效项目混入正式工程量', () => {
    expect(parseQuantityReadQuery({ projectId: 'p', origin: 'real', includeDemo: 'false' })).toEqual({ projectId: 'p', origin: 'real', includeDemo: false })
  })

  it.each([
    { case: '{ projectId: \'p\', origin: \'demo\' }', input: { projectId: 'p', origin: 'demo' }, expected: '不接受其他' },
    { case: '{ projectId: null, origin: \'real\' }', input: { projectId: null, origin: 'real' }, expected: '有效项目' },
    { case: '{ projectId: \'p\', origin: \'real\', includeDemo: \'yes\' }', input: { projectId: 'p', origin: 'real', includeDemo: 'yes' }, expected: '有效项目' },
  ])('读取不能把缺省或演示来源、无效项目混入正式工程量 / parseQuantityReadQuery：$case', ({ input, expected }) => {
    expect(() => parseQuantityReadQuery(input)).toThrow(expected)
  })

  it.each(([{ actorId: '' }, { baseVersion: null }, { action: [] }, { origin: 'demo' }, { requiredCapability: 'project:write' }]).map(input => ({ input })))('命令要求身份、能力和版本，并固化入口草稿：输入案例 %#', ({ input: patch }) => {
    const body = { workspaceId: 'w', actorId: 'a', commandId: 'c', projectId: 'p', baseVersion: 'quantity:p:0', requiredCapability: 'quantity:write', origin: 'real', action: { kind: 'create-building', draft: { code: '1', name: '1栋' } } }
    const command = parseQuantityCommand(body)
    body.action.draft.name = '后续输入'
    expect(command.action).toMatchObject({ draft: { name: '1栋' } })
    expect(() => parseQuantityCommand({ ...body, ...patch })).toThrow('格式无效')
  })

  describe('户、批量阶段和照片查询必须明确完整归属，拒绝空值、重复户和数组注入', () => {
    const query = { projectId: 'p', origin: 'real', includeDemo: false }
    it('关联事实保持原契约', () => {
      expect(parseQuantityUnitReadQuery({ ...query, unitId: 'u' })).toEqual({ ...query, unitId: 'u' })
      expect(parseQuantityPhotoReadQuery({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })).toEqual({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })
      expect(() => parseQuantityPhotoReadQuery({ ...query, unitId: 'u', photoId: 'f' })).toThrow()
    })

    it.each([
      { case: '{ ...query, trade: \'油漆工\', unitIds: \'u\' }', input: { ...query, trade: '油漆工', unitIds: 'u' }, expected: { ...query, trade: '油漆工', unitIds: ['u'] } },
      { case: '{ ...query, trade: \'油漆工\', unitIds: [\'u1\', \'u2\'] }', input: { ...query, trade: '油漆工', unitIds: ['u1', 'u2'] }, expected: { ...query, trade: '油漆工', unitIds: ['u1', 'u2'] } },
    ])('parseQuantityBatchReadQuery：$case', ({ input, expected }) => {
      expect(parseQuantityBatchReadQuery(structuredClone(input))).toEqual(expected)
    })
  })

  it.each(Array.from([{ unitId: '' }, { unitId: ['u'] }]).map(input => ({ input })))('户、批量阶段和照片查询必须明确完整归属，拒绝空值、重复户和数组注入：输入组合 1 案例 %#', ({ input: patch }) => {
    const query = { projectId: 'p', origin: 'real', includeDemo: false }
    expect(parseQuantityUnitReadQuery({ ...query, unitId: 'u' })).toEqual({ ...query, unitId: 'u' })
    expect(parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds: 'u' })).toEqual({ ...query, trade: '油漆工', unitIds: ['u'] })
    expect(parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds: ['u1', 'u2'] })).toEqual({ ...query, trade: '油漆工', unitIds: ['u1', 'u2'] })
    expect(parseQuantityPhotoReadQuery({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })).toEqual({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })
    expect(() => parseQuantityUnitReadQuery({ ...query, ...patch })).toThrow()
  })

  it.each(Array.from([[], ['u', 'u'], [''], { u: 'u' }]).map(input => ({ input })))('户、批量阶段和照片查询必须明确完整归属，拒绝空值、重复户和数组注入：输入组合 2 案例 %#', ({ input: unitIds }) => {
    const query = { projectId: 'p', origin: 'real', includeDemo: false }
    expect(parseQuantityUnitReadQuery({ ...query, unitId: 'u' })).toEqual({ ...query, unitId: 'u' })
    expect(parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds: 'u' })).toEqual({ ...query, trade: '油漆工', unitIds: ['u'] })
    expect(parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds: ['u1', 'u2'] })).toEqual({ ...query, trade: '油漆工', unitIds: ['u1', 'u2'] })
    expect(parseQuantityPhotoReadQuery({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })).toEqual({ ...query, unitId: 'u', completionId: 'c', photoId: 'f' })
    expect(() => parseQuantityBatchReadQuery({ ...query, trade: '油漆工', unitIds })).toThrow()
  })
})
