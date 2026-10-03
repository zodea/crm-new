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

  it('发票实体已登记：票号和价税合计必填，支持真实票据列名', () => {
    const entity = getImportEntity('invoice')

    expect(entity?.label).toBe('发票台账')
    expect(entity?.fields.filter(field => field.required).map(field => field.key)).toEqual([
      'invoiceNumber',
      'totalAmount',
    ])
    expect(entity?.fields.find(field => field.key === 'projectName')?.aliases).toEqual(expect.arrayContaining(['使用工地']))
    expect(entity?.fields).toContainEqual(expect.objectContaining({ key: 'externalRef', label: '外部旧ID / 匹配标识' }))
  })

  it('项目实体已登记：项目名称必填、含外部旧ID 对账列', () => {
    const entity = getImportEntity('project')

    expect(entity?.label).toBe('施工项目')
    const nameField = entity?.fields.find(f => f.key === 'name')
    expect(nameField?.required).toBe(true)
    expect(entity?.fields).toContainEqual(EXTERNAL_REF_FIELD)
    // 客户名称先唯一解析为 customerId，不能再写已停用的 developer 文本列。
    expect(entity?.fields.map(f => f.key)).toContain('customerName')
    expect(entity?.fields.find(f => f.key === 'customerName')?.required).toBe(true)
    expect(entity?.fields.map(f => f.key)).not.toContain('developer')
    expect(entity?.fields.map(f => f.key)).toContain('execManager')
    expect(entity?.fields.map(f => f.key)).toContain('builder')
  })

  it('分供方实体已登记：公司全称必填，资料状态不接受外部直接写入', () => {
    const entity = getImportEntity('supplier')

    expect(entity?.label).toBe('分供方')
    expect(entity?.fields.find(field => field.key === 'name')?.required).toBe(true)
    expect(entity?.fields.map(field => field.key)).toEqual(expect.arrayContaining([
      'supplierCategory',
      'aliases',
      'registeredCapital',
    ]))
    expect(entity?.fields.map(field => field.key)).not.toContain('credentialStatus')
    expect(entity?.fields).toContainEqual(EXTERNAL_REF_FIELD)
  })

  it('未登记的实体返回 undefined', () => {
    expect(getImportEntity('unknown-entity')).toBeUndefined()
  })

  it.each([
    { case: '\'constructor\'', input: 'constructor' },
    { case: '\'toString\'', input: 'toString' },
  ])('原型键不沿原型链误命中 / getImportEntity：$case', ({ input }) => {
    expect(getImportEntity(input)).toBeUndefined()
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
