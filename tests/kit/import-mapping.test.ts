import type { ImportTemplateField } from '~/lib/kit/import-mapping'
import { describe, expect, it } from 'vitest'
import {
  autoMatchColumns,
  buildImportRows,
  computeFieldStatus,
  EXTERNAL_REF_FIELD,
  importStepperSteps,
  listMissingRequiredFields,
} from '~/lib/kit/import-mapping'

const template: ImportTemplateField[] = [
  { key: 'name', label: '名称', required: true, aliases: ['分供方名称', '供应商名称'] },
  { key: 'category', label: '合作类别', required: true, aliases: ['类别'] },
  { key: 'contact', label: '联系人' },
  { key: 'phone', label: '联系电话', aliases: ['手机号'] },
  EXTERNAL_REF_FIELD,
]

describe('导入映射：智能预匹配', () => {
  it('源列与模板标签精确一致时匹配为已确认', () => {
    expect(autoMatchColumns(['名称', '合作类别'], template)).toEqual({
      name: { column: '名称', confidence: 'confirmed' },
      category: { column: '合作类别', confidence: 'confirmed' },
    })
  })

  it('别名与大小写空白差异按精确匹配处理', () => {
    expect(autoMatchColumns([' 分供方名称 ', '手机号'], template)).toEqual({
      name: { column: ' 分供方名称 ', confidence: 'confirmed' },
      phone: { column: '手机号', confidence: 'confirmed' },
    })
  })

  it('包含关系只算待确认的建议匹配', () => {
    expect(autoMatchColumns(['分供方联系人'], template)).toEqual({
      contact: { column: '分供方联系人', confidence: 'suggested' },
    })
  })

  it('联系电话精确匹配电话字段，不误映射联系人字段', () => {
    expect(autoMatchColumns(['联系电话'], template)).toEqual({
      phone: { column: '联系电话', confidence: 'confirmed' },
    })
  })

  it('先出现的建议字段与后出现的精确字段竞争同一列时精确匹配优先', () => {
    const competing: ImportTemplateField[] = [
      { key: 'contact', label: '联系人' },
      { key: 'phone', label: '联系电话', aliases: ['联系人电话'] },
    ]

    expect(autoMatchColumns(['联系人电话'], competing.slice(0, 1))).toEqual({
      contact: { column: '联系人电话', confidence: 'suggested' },
    })
    expect(autoMatchColumns(['联系人电话'], competing)).toEqual({
      phone: { column: '联系人电话', confidence: 'confirmed' },
    })
  })

  it('无法匹配的字段不出现在映射结果中', () => {
    expect(autoMatchColumns(['无关列'], template)).toEqual({})
  })

  it('已被精确认领的源列不再参与其他字段的建议匹配', () => {
    const competing: ImportTemplateField[] = [
      { key: 'invoiceDate', label: '开票日期' },
      { key: 'date', label: '日期' },
    ]

    expect(autoMatchColumns(['开票日期'], competing)).toEqual({
      invoiceDate: { column: '开票日期', confidence: 'confirmed' },
    })
  })

  it('外部旧ID列按别名「匹配标识」预匹配', () => {
    expect(autoMatchColumns(['匹配标识'], template)).toEqual({
      externalRef: { column: '匹配标识', confidence: 'confirmed' },
    })
  })
})

describe('导入映射：三色态与必填门控', () => {
  it('已确认=matched、建议=pending、必填未映=required-missing、可选未映=unmapped', () => {
    const mapping = {
      name: { column: '名称', confidence: 'confirmed' as const },
      contact: { column: '联络人', confidence: 'suggested' as const },
    }

    expect(computeFieldStatus(mapping, template)).toEqual({
      name: 'matched',
      category: 'required-missing',
      contact: 'pending',
      phone: 'unmapped',
      externalRef: 'unmapped',
    })
  })

  it('必填全部映上时门控放行', () => {
    const mapping = {
      name: { column: '名称', confidence: 'confirmed' as const },
      category: { column: '类别', confidence: 'suggested' as const },
    }

    expect(listMissingRequiredFields(mapping, template)).toEqual([])
  })

  it('必填缺失时列出缺失字段供拦截提示', () => {
    const mapping = {
      name: { column: '名称', confidence: 'confirmed' as const },
    }

    expect(listMissingRequiredFields(mapping, template).map(f => f.key)).toEqual(['category'])
  })
})

describe('导入映射：按映射构建入库行', () => {
  it('把源行按映射投影为模板字段行，未映射字段不出现', () => {
    const mapping = {
      name: { column: '分供方名称', confidence: 'confirmed' as const },
      externalRef: { column: '匹配标识', confidence: 'suggested' as const },
    }

    expect(buildImportRows(mapping, [
      { 分供方名称: '华东建材', 匹配标识: 'HQ-001', 无关列: 'x' },
      { 分供方名称: '南方设备' },
    ])).toEqual([
      { name: '华东建材', externalRef: 'HQ-001' },
      { name: '南方设备' },
    ])
  })

  it('列名撞上原型键时不把继承值投影进行数据', () => {
    const mapping = {
      name: { column: 'toString', confidence: 'confirmed' as const },
    }

    expect(buildImportRows(mapping, [{ 分供方名称: '华东建材' }])).toEqual([{}])
  })

  it('人工确认同一源列映射给多个字段时仍按两个字段投影', () => {
    const mapping = {
      contact: { column: '联系人电话', confidence: 'confirmed' as const },
      phone: { column: '联系人电话', confidence: 'confirmed' as const },
    }

    expect(buildImportRows(mapping, [{ 联系人电话: '合成内容' }])).toEqual([
      { contact: '合成内容', phone: '合成内容' },
    ])
  })
})

describe('导入映射：向导步态投影', () => {
  it('上传步激活时后续步待处理', () => {
    expect(importStepperSteps({ currentStep: 'upload', runPhase: 'idle' })).toEqual([
      { id: 'upload', label: '上传', status: 'active' },
      { id: 'mapping', label: '映射', status: 'pending' },
      { id: 'preview-import', label: '预览导入', status: 'pending' },
    ])
  })

  it('映射步激活时上传步已完成', () => {
    expect(importStepperSteps({ currentStep: 'mapping', runPhase: 'idle' })).toEqual([
      { id: 'upload', label: '上传', status: 'completed' },
      { id: 'mapping', label: '映射', status: 'active' },
      { id: 'preview-import', label: '预览导入', status: 'pending' },
    ])
  })

  it('导入运行、失败与完成映射到第三步状态', () => {
    expect(importStepperSteps({ currentStep: 'preview-import', runPhase: 'running' }).at(-1))
      .toEqual({ id: 'preview-import', label: '预览导入', status: 'active' })
    expect(importStepperSteps({ currentStep: 'preview-import', runPhase: 'failed' }).at(-1))
      .toEqual({ id: 'preview-import', label: '预览导入', status: 'failed' })
    expect(importStepperSteps({ currentStep: 'preview-import', runPhase: 'completed' }))
      .toEqual([
        { id: 'upload', label: '上传', status: 'completed' },
        { id: 'mapping', label: '映射', status: 'completed' },
        { id: 'preview-import', label: '预览导入', status: 'completed' },
      ])
  })
})

describe('外部旧ID保留列', () => {
  it('标准字段定义与红圈匹配标识对齐', () => {
    expect(EXTERNAL_REF_FIELD).toMatchObject({
      key: 'externalRef',
      label: '外部旧ID / 匹配标识',
      required: false,
    })
  })
})
