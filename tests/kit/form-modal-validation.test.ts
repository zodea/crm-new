import type { FieldDef, FormValues } from '~/lib/kit/form-modal'
import { describe, expect, it } from 'vitest'
import { findMissingRequired, initValues } from '~/lib/kit/form-modal'

const FIELDS: FieldDef[] = [
  { key: 'name', label: '公司全称', required: true },
  { key: 'category', label: '类别', type: 'select', required: true, options: ['材料', '劳务'] },
  { key: 'capital', label: '注册资本', type: 'number', required: true },
  { key: 'taxNo', label: '统一社会信用代码' }, // 非必填
  { key: 'remark', label: '备注', type: 'textarea', value: '默认备注' },
]

describe('formModal 必填校验：findMissingRequired', () => {
  it('全部必填项为空 → 列出所有必填 key', () => {
    const values: FormValues = { name: '', category: '', capital: '' }
    expect(findMissingRequired(FIELDS, values)).toEqual(['name', 'category', 'capital'])
  })

  it('必填项填齐 → 返回空数组', () => {
    const values: FormValues = { name: '瑞航建材', category: '材料', capital: 500 }
    expect(findMissingRequired(FIELDS, values)).toEqual([])
  })

  it('字符串按 trim 判空：纯空格算缺失', () => {
    const values: FormValues = { name: '   ', category: '材料', capital: 500 }
    expect(findMissingRequired(FIELDS, values)).toEqual(['name'])
  })

  it('数字 0 算已填（合法值），不判缺失', () => {
    const values: FormValues = { name: '瑞航建材', category: '材料', capital: 0 }
    expect(findMissingRequired(FIELDS, values)).toEqual([])
  })

  it('非必填项留空不影响校验', () => {
    const values: FormValues = { name: '瑞航建材', category: '材料', capital: 500, taxNo: '' }
    expect(findMissingRequired(FIELDS, values)).toEqual([])
  })

  it('缺失的键（undefined）也算缺失', () => {
    const values: FormValues = { name: '瑞航建材' }
    expect(findMissingRequired(FIELDS, values)).toEqual(['category', 'capital'])
  })
})

describe('formModal 草稿初始化：initValues', () => {
  it('用字段初始值构造草稿，无初始值的填空串', () => {
    expect(initValues(FIELDS)).toEqual({
      name: '',
      category: '',
      capital: '',
      taxNo: '',
      remark: '默认备注',
    })
  })
})
