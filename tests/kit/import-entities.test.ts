import { describe, expect, it } from 'vitest'
import { getImportEntity } from '~/lib/kit/import-entities'
import { EXTERNAL_REF_FIELD } from '~/lib/kit/import-mapping'

describe('导入实体注册表', () => {
  it('演示实体存在且模板包含必填字段与外部旧ID列', () => {
    const entity = getImportEntity('demo-supplier')

    expect(entity?.label).toBe('演示·分供方')
    expect(entity?.fields.some(field => field.required)).toBe(true)
    expect(entity?.fields).toContainEqual(EXTERNAL_REF_FIELD)
  })

  it('未登记的实体返回 undefined', () => {
    expect(getImportEntity('unknown-entity')).toBeUndefined()
  })

  it('原型键不沿原型链误命中', () => {
    expect(getImportEntity('constructor')).toBeUndefined()
    expect(getImportEntity('toString')).toBeUndefined()
  })

  it('演示写入：FAIL 行首次失败、重试成功，普通行直接成功', async () => {
    const entity = getImportEntity('demo-supplier')!

    await expect(entity.importRow({ name: '华东建材', externalRef: 'HQ-001' }))
      .resolves
      .toBeUndefined()

    const failing = { name: '故障行', externalRef: `FAIL-${Math.random().toString(36).slice(2)}` }
    await expect(entity.importRow(failing)).rejects.toThrow('演示写入失败')
    await expect(entity.importRow(failing)).resolves.toBeUndefined()
  })
})
