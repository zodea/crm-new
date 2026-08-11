import type { DeliveryRecord } from '~/stores/delivery-record'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { createDeliveryArchiveZip, createDeliveryLedgerXlsx, deliveryLedgerRows } from '~/lib/delivery/export'

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

function zipEntries(data: Uint8Array): { name: string, data: Uint8Array }[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  const entries: { name: string, data: Uint8Array }[] = []
  let offset = 0
  while (offset + 4 <= data.length && view.getUint32(offset, true) === 0x04034B50) {
    const compression = view.getUint16(offset + 8, true)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    expect(compression).toBe(0)
    const nameStart = offset + 30
    const payloadStart = nameStart + nameLength + extraLength
    entries.push({
      name: decoder.decode(data.subarray(nameStart, nameStart + nameLength)),
      data: data.slice(payloadStart, payloadStart + size),
    })
    offset = payloadStart + size
  }
  return entries
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

  it('按项目、分供方、日期、单号排序', () => {
    const rows = deliveryLedgerRows([
      record({ id: 'late', orderNo: 'SH-002', deliveryDate: '2026-08-02' }),
      record({ id: 'early', orderNo: 'SH-001', deliveryDate: '2026-08-01' }),
    ], {
      projectName: () => '滨江壹号',
      supplierName: () => '华东建材',
    })

    expect(rows.map(row => row.orderNo)).toEqual(['SH-001', 'SH-002'])
  })

  it('共用原件只加载和打包一次，并在 Excel 标记无法拆分', async () => {
    const first = record({ id: 'shared-1', hasSourceFile: true, fileName: '共用送货单.png', printBatchId: 'shared', supplierId: 'supplier-1' })
    const second = record({ id: 'shared-2', hasSourceFile: true, fileName: '共用送货单.png', printBatchId: 'shared', orderNo: 'SH-002', supplierId: 'supplier-1' })
    const source = {
      fileName: '共用送货单.png',
      mimeType: 'image/png',
      fileSize: 4,
      bytes: new Uint8Array([1, 2, 3, 4]),
    }
    const loadSource = vi.fn(async () => source)
    const result = await createDeliveryArchiveZip([first, second], {
      projectName: () => '滨江壹号',
      supplierName: () => '华东建材',
    }, {
      convertImagesToPdf: false,
      loadSource,
    })

    expect(loadSource).toHaveBeenCalledOnce()
    expect(result.sources).toHaveLength(1)
    expect(result.rows.every(row => row.sourceFile === '共用送货单.png / 共用原件')).toBe(true)
    expect(result.rows.every(row => row.exception === '多单共用原件/无法拆分')).toBe(true)
    const entries = zipEntries(result.data)
    expect(entries.map(entry => entry.name)).toContain('原件/图片/共用送货单.png')
    expect(entries.map(entry => entry.name)).toContain('导出说明.txt')
    expect(entries.map(entry => entry.name)).not.toContain('图片原件合并.pdf')
  })

  it('图片未勾选转 PDF 时保留原图，缺原件只写入 Excel 异常', async () => {
    const withImage = record({ id: 'image', hasSourceFile: true, fileName: '送货单.jpg' })
    const missing = record({ id: 'missing', hasSourceFile: false, fileName: '', printBatchId: 'missing' })
    const result = await createDeliveryArchiveZip([withImage, missing], {
      projectName: () => '滨江壹号',
      supplierName: () => '华东建材',
    }, {
      convertImagesToPdf: false,
      loadSource: async () => ({
        fileName: '送货单.jpg',
        mimeType: 'image/jpeg',
        fileSize: 2,
        bytes: new Uint8Array([0xFF, 0xD8]),
      }),
    })

    expect(result.missingRecordIds).toEqual(['missing'])
    const entries = zipEntries(result.data)
    expect(entries.map(entry => entry.name)).toContain('原件/图片/送货单.jpg')
    expect(result.rows.find(row => row.sourceFile === '—')?.exception).toContain('缺少原件')
    const explanation = entries.find(entry => entry.name === '导出说明.txt')
    expect(new TextDecoder().decode(explanation?.data)).toContain('missing')
    expect(entries.map(entry => entry.name)).not.toContain('图片原件合并.pdf')
  })

  it('多页共用 PDF 以原始字节整份保留且只进入 ZIP 一次', async () => {
    const first = record({
      id: 'shared-pdf-1',
      hasSourceFile: true,
      fileName: '共用多页送货单.pdf',
      printBatchId: 'shared-pdf',
      supplierId: 'supplier-1',
    })
    const second = record({
      id: 'shared-pdf-2',
      hasSourceFile: true,
      fileName: '共用多页送货单.pdf',
      printBatchId: 'shared-pdf',
      orderNo: 'SH-002',
      supplierId: 'supplier-1',
    })
    const originalBytes = new TextEncoder().encode('%PDF-1.7\n% original multipage bytes /Count 2\n%%EOF')
    const loadSource = vi.fn(async () => ({
      fileName: '共用多页送货单.pdf',
      mimeType: 'application/pdf',
      fileSize: originalBytes.length,
      bytes: originalBytes,
    }))

    const result = await createDeliveryArchiveZip([first, second], {
      projectName: () => '滨江壹号',
      supplierName: () => '华东建材',
    }, {
      convertImagesToPdf: true,
      loadSource,
    })
    const entries = zipEntries(result.data)
    const originals = entries.filter(entry => entry.name === '原件/PDF/共用多页送货单.pdf')

    expect(loadSource).toHaveBeenCalledOnce()
    expect(result.sources).toHaveLength(1)
    expect(originals).toHaveLength(1)
    expect([...originals[0]!.data]).toEqual([...originalBytes])
    expect(entries.map(entry => entry.name)).not.toContain('送货单合并.pdf')
    expect(entries.map(entry => entry.name)).not.toContain('图片原件合并.pdf')
    const explanation = entries.find(entry => entry.name === '导出说明.txt')
    expect(new TextDecoder().decode(explanation?.data)).toContain('PDF 原件未重建或合并')
  })
})
