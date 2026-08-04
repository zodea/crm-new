import type { Invoice } from '~/stores/invoice'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createInvoiceLedgerXlsx, invoiceLedgerRows } from '~/lib/invoice/excel'

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-test',
    fileName: '',
    filePath: '',
    fileSize: '',
    pageCount: 0,
    invoiceType: '增值税普通发票',
    invoiceNumber: '12345678',
    invoiceDate: '2026-08-04',
    buyer: '',
    buyerTaxNo: '',
    seller: '广州建材有限公司',
    sellerTaxNo: '',
    amount: 10,
    taxAmount: 0,
    totalAmount: 10,
    taxRate: '',
    remark: '',
    projectId: 'project-1',
    projectName: '瑞航项目',
    supplierId: null,
    ocrStatus: 'done',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    dupStatus: 'normal',
    source: 'excel',
    printRotation: 0,
    ocrConfidence: null,
    confirmedAt: null,
    ownerKind: 'project',
    contractId: null,
    printCount: 0,
    archivedAt: null,
    items: [],
    fieldConfidence: {},
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('发票台账 Excel 导出', () => {
  it('保留业务值并写入标题合并、重复值合并和金额格式', () => {
    const rows = [
      invoice(),
      invoice({ id: 'inv-test-2', invoiceNumber: '87654321', totalAmount: 20 }),
      invoice({ id: 'inv-test-3', invoiceNumber: '11112222', projectName: '个人开支' }),
    ]

    expect(invoiceLedgerRows(rows)[0]).toMatchObject({
      invoiceNumber: '12345678',
      totalAmount: 10,
      source: 'Excel 导入',
    })

    const workbook = XLSX.read(createInvoiceLedgerXlsx(rows), { type: 'array', cellNF: true })
    const worksheet = workbook.Sheets['发票台账']!

    expect(worksheet.A1?.v).toBe('发票台账')
    expect(worksheet.E3?.v).toBe(10)
    expect(worksheet.E3?.z).toBe('0.00_);[Red]\\(0.00\\)')
    expect(worksheet.E6?.v).toBe(40)
    expect(worksheet['!merges']).toEqual(expect.arrayContaining([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 2, c: 2 }, e: { r: 4, c: 2 } },
      { s: { r: 2, c: 5 }, e: { r: 3, c: 5 } },
    ]))
  })
})
