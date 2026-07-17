import type { Supplier } from '~/stores/supplier'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildConfiguredExportFiles } from '~/lib/kit/export'
import {
  createSupplierCategoryExport,
  createSupplierLedgerExport,
  localDateStamp,
  SUPPLIER_EXPORT_COLUMNS,
  supplierLedgerRows,
} from '~/lib/supplier/export'

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    name: '广州市大板东建材有限公司',
    externalRef: 'OLD-SUP-001',
    aliases: ['大板东', '板东建材'],
    uniqueCode: '91440101MA5CBX1234',
    taxNo: '91440101MA5CBX1234',
    businessType: '材料',
    supplierCategory: '材料供应商',
    rating: 'A',
    parentSupplierId: null,
    legalRep: '陈先生',
    registeredCapital: 500,
    registeredDate: '2018-06-01',
    address: '广州市白云区',
    taxpayerType: '一般纳税人',
    mainBusiness: '建筑材料',
    invoiceName: '广州市大板东建材有限公司',
    invoiceAddress: '广州市白云区',
    bank: '中国建设银行广州支行',
    bankAccount: '440000000000000001',
    phone: '020-88886666',
    contact: '陈经理',
    contactPhone: '13800138000',
    credentialStatus: 'qualified',
    approvalStatus: 'approved',
    source: 'manual',
    note: '长期合作',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('分供方台账导出行', () => {
  it('每家分供方产出一行，别名与资料状态使用可读文本', () => {
    const [row] = supplierLedgerRows([makeSupplier()])

    expect(row['公司全称']).toBe('广州市大板东建材有限公司')
    expect(row['外部旧ID / 匹配标识']).toBe('OLD-SUP-001')
    expect(row['简称/别名']).toBe('大板东、板东建材')
    expect(row['分供方类别']).toBe('材料供应商')
    expect(row['资料状态']).toBe('合格')
    expect(row['注册资金（万元）']).toBe(500)
  })

  it('空数值与空别名导出空串，不出现 null 或数组文本', () => {
    const [row] = supplierLedgerRows([makeSupplier({ aliases: [], registeredCapital: null })])

    expect(row['简称/别名']).toBe('')
    expect(row['注册资金（万元）']).toBe('')
  })

  it('列数与列定义一致，行数与分供方数一致', () => {
    const rows = supplierLedgerRows([makeSupplier(), makeSupplier({ id: 'sup-2' })])

    expect(rows).toHaveLength(2)
    expect(Object.keys(rows[0]!)).toHaveLength(SUPPLIER_EXPORT_COLUMNS.length)
  })

  it('单文件请求使用本地日历日并生成可读工作簿', () => {
    const request = createSupplierLedgerExport(
      [makeSupplier()],
      new Date(2026, 6, 17, 0, 30),
    )
    const workbook = XLSX.read(request.data)
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['分供方台账']!)

    expect(localDateStamp(new Date(2026, 6, 17, 0, 30))).toBe('2026-07-17')
    expect(request.defaultName).toBe('分供方台账_2026-07-17.xlsx')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      '公司全称': '广州市大板东建材有限公司',
      '简称/别名': '大板东、板东建材',
      '资料状态': '合格',
    })
  })

  it('分类请求生成类别/资料状态目录与逐户 xlsx', () => {
    const request = createSupplierCategoryExport([
      makeSupplier(),
      makeSupplier({ id: 'sup-2', name: '广州固力劳务', supplierCategory: '劳务分包商' }),
    ])
    const files = buildConfiguredExportFiles(request)

    expect(files.map(file => file.relativePath)).toEqual([
      '材料供应商/合格/广州市大板东建材有限公司.xlsx',
      '劳务分包商/合格/广州固力劳务.xlsx',
    ])
    const workbook = XLSX.read(files[1]!.data)
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['分供方']!)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.公司全称).toBe('广州固力劳务')
  })
})
