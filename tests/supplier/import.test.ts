import { describe, expect, it } from 'vitest'
import {
  classifyProjectSupplierImportFile,
  inferProjectSupplierFileCategory,
  inferProjectSupplierName,
  normalizeSupplierImportRow,
} from '~/lib/supplier/import'

describe('分供方导入行归一', () => {
  it('忽略外部资料状态，只归一可导入的主数据字段', () => {
    expect(normalizeSupplierImportRow({
      name: '  华东建材有限公司  ',
      supplierCategory: '专业分包商',
      credentialStatus: '合格',
      aliases: '华东，东建; HD、板东',
      registeredCapital: '280.5',
      externalRef: 'OLD-SUP-001',
    })).toMatchObject({
      name: '华东建材有限公司',
      externalRef: 'OLD-SUP-001',
      supplierCategory: '专业分包商',
      aliases: ['华东', '东建', 'HD', '板东'],
      registeredCapital: 280.5,
    })
    expect(normalizeSupplierImportRow({
      name: '华东建材有限公司',
      credentialStatus: '合格',
    })).not.toHaveProperty('credentialStatus')
  })

  it('非法类别归一为其他，外部资料状态不进入自动状态机', () => {
    const normalized = normalizeSupplierImportRow({
      name: '测试供应方',
      supplierCategory: '未知类别',
      credentialStatus: '',
    })
    expect(normalized).toMatchObject({
      supplierCategory: '其他',
    })
    expect(normalized).not.toHaveProperty('credentialStatus')
  })

  it('未映射的可选字段保持缺席，供重导更新保留既有资料', () => {
    const patch = normalizeSupplierImportRow({
      name: '华东建材有限公司',
      externalRef: 'OLD-SUP-001',
      contact: '新联系人',
    })
    const existing = {
      name: '华东建材有限公司',
      externalRef: 'OLD-SUP-001',
      contact: '旧联系人',
      aliases: ['华东'],
      bank: '中国银行广州支行',
      registeredCapital: 500,
    }

    expect(patch).toEqual({
      name: '华东建材有限公司',
      externalRef: 'OLD-SUP-001',
      contact: '新联系人',
      source: 'excel',
    })
    expect({ ...existing, ...patch }).toMatchObject({
      contact: '新联系人',
      aliases: ['华东'],
      bank: '中国银行广州支行',
      registeredCapital: 500,
    })
  })

  it('导入行归一不补造未映射的类别与资料状态', () => {
    const normalized = normalizeSupplierImportRow({
      name: '只有名称的分供方',
      externalRef: 'OLD-MINIMAL-001',
    })

    expect(normalized).not.toHaveProperty('supplierCategory')
    expect(normalized).not.toHaveProperty('credentialStatus')
  })

  it('公司全称为空时拒绝该行', () => {
    expect(() => normalizeSupplierImportRow({ name: '  ' }))
      .toThrow('公司全称不能为空')
  })
})

describe('项目分供方文件分类', () => {
  const suppliers = [
    { id: 'sup-full', name: '华东建设工程有限公司', aliases: ['华东建设', '华建'] },
    { id: 'sup-short', name: '华建', aliases: [] },
  ]

  it.each([
    { case: '\'瑞航中心-华东建设工程有限公司-施工合同.pdf\' / suppliers / \'瑞航中心\'', input: '瑞航中心-华东建设工程有限公司-施工合同.pdf', argument2: suppliers, argument3: '瑞航中心', expected: {
      supplierId: 'sup-full',
      supplierName: '华东建设工程有限公司',
      matchSource: 'name',
      category: '合同',
    } },
    { case: '\'华东建设_付款回单_20260730.pdf\' / suppliers', input: '华东建设_付款回单_20260730.pdf', argument2: suppliers, argument3: undefined, expected: {
      supplierId: 'sup-full',
      matchSource: 'alias',
      category: '付款',
    } },
  ])('先匹配公司全称，没有全称时才匹配别名 / classifyProjectSupplierImportFile：$case', ({ input, argument2, argument3, expected }) => {
    expect(classifyProjectSupplierImportFile(input, argument2, argument3)).toMatchObject(expected)
  })

  describe('全称命中优先于更长别名，同层仍取最长匹配', () => {
    const candidates = [
      { id: 'alias', name: '另一家公司', aliases: ['华建合同', '华东', '华东建设'] },
      { id: 'short-name', name: '华建', aliases: [] },
      { id: 'long-name', name: '华建集团', aliases: [] },
    ]
    it.each([
      { case: '\'华建合同.pdf\' / candidates', input: '华建合同.pdf', argument2: candidates, expected: { supplierId: 'short-name', matchSource: 'name' } },
      { case: '\'华建集团-华建合同.pdf\' / candidates', input: '华建集团-华建合同.pdf', argument2: candidates, expected: { supplierId: 'long-name', matchSource: 'name' } },
      { case: '\'华东建设付款.pdf\' / [ { id: \'short-alias\', name: \'其他企业\', aliases: [\'华东\'] }, candidates[0], ]', input: '华东建设付款.pdf', argument2: [
        { id: 'short-alias', name: '其他企业', aliases: ['华东'] },
        candidates[0],
      ], expected: { supplierId: 'alias', matchSource: 'alias' } },
    ])('classifyProjectSupplierImportFile：$case', ({ input, argument2, expected }) => {
      expect(classifyProjectSupplierImportFile(structuredClone(input), structuredClone(argument2))).toMatchObject(expected)
    })
  })

  it('未匹配时只从文件名推导待确认名称，不宣称读取文件内容', () => {
    expect(classifyProjectSupplierImportFile(
      '瑞航中心-南方机电-结算资料.zip',
      suppliers,
      '瑞航中心',
    )).toEqual({
      supplierId: '',
      supplierName: '南方机电 资料',
      matchSource: 'unmatched',
      category: '结算',
    })
  })

  it('覆盖文件类别关键词与空候选名兜底', () => {
    expect(inferProjectSupplierName('合同.pdf')).toBe('待确认分供方')
  })

  it.each([
    { case: '\'供应商营业执照.png\'', input: '供应商营业执照.png', expected: '资质' },
    { case: '\'现场照片.jpg\'', input: '现场照片.jpg', expected: '其他' },
  ])('覆盖文件类别关键词与空候选名兜底 / inferProjectSupplierFileCategory：$case', ({ input, expected }) => {
    expect(inferProjectSupplierFileCategory(input)).toBe(expected)
  })
})
