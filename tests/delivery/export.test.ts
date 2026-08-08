import type { DeliveryRecord } from '~/stores/delivery-record'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createDeliveryLedgerXlsx, deliveryLedgerRows } from '~/lib/delivery/export'

function record(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    id: 'delivery-export-1',
    projectId: 'project-1',
    supplierId: null,
    rawSiteText: '',
    orderNo: 'SH-001',
    deliveryDate: '2026-08-01',
    fileName: '',
    filePath: '',
    ocrStatus: 'reviewed',
    archived: true,
    stored: true,
    printBatchId: 'batch-1',
    printDisposition: 'pending',
    printedAt: '',
    printExcludedAt: '',
    reviewFlag: '',
    note: '',
    createdAt: '',
    updatedAt: '',
    hasSourceFile: false,
    lines: [{
      id: 'line-1',
      deliveryRecordId: 'delivery-export-1',
      materialName: '水泥',
      spec: 'P.O 42.5',
      unit: '吨',
      qty: 10,
      unitPrice: 380,
      amount: 3800,
      amountSource: 'calculated',
      note: '',
      sortOrder: 0,
    }],
    totalAmount: 3800,
    ...overrides,
  }
}

describe('送货单 Excel 导出', () => {
  it('按明细行展开并记录缺原件、未区分分供方等异常', () => {
    const rows = deliveryLedgerRows([record()], {
      projectName: id => id === 'project-1' ? '滨江壹号' : '未知项目',
      supplierName: () => '未区分分供方',
    })

    expect(rows).toEqual([expect.objectContaining({
      projectName: '滨江壹号',
      supplierName: '未区分分供方',
      materialName: '水泥',
      sourceFile: '—',
      exception: '缺少原件；未区分分供方',
    })])
  })

  it('生成可回读的工作簿，保留金额和异常列', () => {
    const rows = deliveryLedgerRows([record({ hasSourceFile: true, fileName: '送货单-001.pdf', supplierId: 'supplier-1' })], {
      projectName: () => '滨江壹号',
      supplierName: () => '华东建材',
    })
    const workbook = XLSX.read(createDeliveryLedgerXlsx(rows), { type: 'array', cellDates: true })
    const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['送货单明细']!, { header: 1 })

    expect(values[1]).toEqual(expect.arrayContaining(['项目', '材料名称', '金额', '原件名/页码', '异常说明']))
    expect(values[2]).toEqual(expect.arrayContaining(['滨江壹号', '水泥', 3800, '送货单-001.pdf / —', '']))
  })
})
