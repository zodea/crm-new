import { describe, expect, it } from 'vitest'
import {
  classifyProjectSupplierImportFile,
  inferProjectSupplierFileCategory,
  inferProjectSupplierName,
  normalizeSupplierImportRow,
  withSupplierImportCreateDefaults,
} from '~/lib/supplier/import'

describe('分供方导入行归一', () => {
  it('把中文资料状态、别名文本和数值文本转为 store 可写数据', () => {
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
      credentialStatus: 'qualified',
      aliases: ['华东', '东建', 'HD', '板东'],
      registeredCapital: 280.5,
    })
  })

  it('非法类别归一为其他，空资料状态回落为资料缺失', () => {
    expect(normalizeSupplierImportRow({
      name: '测试供应方',
      supplierCategory: '未知类别',
      credentialStatus: '',
    })).toMatchObject({
      supplierCategory: '其他',
      credentialStatus: 'incomplete',
    })
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

  it('仅新增边界为未映射类别与资料状态补合法默认值', () => {
    const normalized = normalizeSupplierImportRow({
      name: '只有名称的分供方',
      externalRef: 'OLD-MINIMAL-001',
    })

    expect(normalized).not.toHaveProperty('supplierCategory')
    expect(normalized).not.toHaveProperty('credentialStatus')
    expect(withSupplierImportCreateDefaults(normalized)).toMatchObject({
      supplierCategory: '其他',
      credentialStatus: 'incomplete',
      aliases: [],
    })
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

  it('按文件名中的最长公司名称或别名匹配现有分供方', () => {
    expect(classifyProjectSupplierImportFile(
      '瑞航中心-华东建设工程有限公司-施工合同.pdf',
      suppliers,
      '瑞航中心',
    )).toMatchObject({
      supplierId: 'sup-full',
      supplierName: '华东建设工程有限公司',
      matchSource: 'name',
      category: '合同',
    })

    expect(classifyProjectSupplierImportFile(
      '华东建设_付款回单_20260730.pdf',
      suppliers,
    )).toMatchObject({
      supplierId: 'sup-full',
      matchSource: 'alias',
      category: '付款',
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
    expect(inferProjectSupplierFileCategory('供应商营业执照.png')).toBe('资质')
    expect(inferProjectSupplierFileCategory('现场照片.jpg')).toBe('其他')
    expect(inferProjectSupplierName('合同.pdf')).toBe('待确认分供方')
  })
})
