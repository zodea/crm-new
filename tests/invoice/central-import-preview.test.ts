import type { InvoiceImportPreview } from '~/lib/invoice/central-http'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { createInvoiceImportCatalogReader, previewCentralInvoiceWorkbook } from '~/lib/invoice/central-import-preview'

const securityFixture = vi.hoisted(() => ({ omitHeaders: false }))
// 仅合成测试替代未完成的安全解析器；原有行号、映射和权限断言保持不变。
vi.mock('~/lib/invoice/central-workbook-security', async () => {
  const { syntheticVerifiedInvoiceWorkbook } = await import('../helpers/central-invoice-preview-fixture')
  return {
    openVerifiedCentralInvoiceWorkbook: async (file: File) => {
      const verified = await syntheticVerifiedInvoiceWorkbook(file)
      return securityFixture.omitHeaders ? { ...verified, headers: undefined } : verified
    },
  }
})

function workbook() {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['发票号码', '发票日期', '销售方', '金额', '税额', '价税合计', '归属项目'],
    ['00000001', '2026-11-01', '合成公司', null, 0, 10, '同名项目'],
    [],
    ['00000002', '2026-11-02', '合成公司', 9, null, 9, '同名项目'],
  ]), '原始票据')
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], '合成.xlsx')
}

const mapping = Object.fromEntries(Object.entries({ invoiceNumber: '发票号码', invoiceDate: '发票日期', seller: '销售方', amount: '金额', taxAmount: '税额', totalAmount: '价税合计' }).map(([field, column]) => [field, { column, confidence: 'confirmed' as const }]))
const catalog = { projects: [{ id: 'project-1', label: '同名项目', version: '1', sourceVersion: 'projects:1' }, { id: 'project-2', label: '同名项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] }
const snapshot = { catalog, sourceVersions: { projects: 'projects:1', suppliers: 'suppliers:1' } }
const result = { sourceVersion: 'invoice-source-1', candidates: [] } as unknown as InvoiceImportPreview

describe('中央发票 Excel 只读预览', () => {
  it('缺少原始表头证据时不得读取目录或查重', async () => {
    const loadCatalog = vi.fn(async () => snapshot)
    const preview = vi.fn(async () => result)
    securityFixture.omitHeaders = true
    try {
      await expect(previewCentralInvoiceWorkbook({ file: workbook(), sheetName: '原始票据', mapping, loadCatalog, preview })).rejects.toThrow('原始表头证据不可核验')
      expect(loadCatalog).not.toHaveBeenCalled()
      expect(preview).not.toHaveBeenCalled()
    }
    finally {
      securityFixture.omitHeaders = false
    }
  })

  it('空列占位名与不同的真实表头不冲突，仍可正常预览', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['发票号码', '发票日期', '销售方', '价税合计', '', '__EMPTY_6'],
      ['00000001', '2026-11-01', '合成公司', 10, 1, 2],
    ]), '原始票据')
    const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成.xlsx')
    const preview = vi.fn(async () => result)
    const loadCatalog = vi.fn(async () => snapshot)
    const response = await previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping: { invoiceNumber: { column: '发票号码', confidence: 'confirmed' } }, loadCatalog, preview })
    expect(response.rows[0]!.source.rawSnapshot).toMatchObject({ __EMPTY_5: 1, __EMPTY_6: 2 })
    expect(loadCatalog).toHaveBeenCalled()
    expect(preview).toHaveBeenCalled()
  })
  it('保留工作表与跳过空行后的原行号，区分空值和真实零，不自动确定同名关联', async () => {
    const preview = vi.fn(async (_input: unknown) => result)
    const response = await previewCentralInvoiceWorkbook({ file: workbook(), sheetName: '原始票据', mapping, loadCatalog: async () => snapshot, preview })
    expect(response.rows.map(row => row.source.rowNumber)).toEqual([2, 4])
    expect(response.rows[0]).toMatchObject({ source: { fileName: '合成.xlsx', sheetName: '原始票据', rawSnapshot: { 金额: null, 税额: 0 } }, fields: { invoiceNumber: '00000001', amount: null, taxAmount: 0, totalAmount: 10 } })
    expect(response.rows[1]!.fields).toMatchObject({ amount: 9, taxAmount: null })
    expect(response.rows[0]!.source.fileDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(response.catalog.projects).toHaveLength(2)
    expect(response.rows[0]).not.toHaveProperty('projectId')
    expect(preview).toHaveBeenCalledTimes(3)
    expect(preview.mock.calls[2]![0]).toEqual(preview.mock.calls[1]![0])
  })

  it('原始行快照保留特殊表头并可安全序列化，真实零与空值不混淆', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['发票号码', '发票日期', '销售方', '价税合计', '__proto__', 'constructor', 'toString'],
      ['00000001', '2026-11-01', '合成公司', 10, '合成原始值', 0, null],
    ]), '原始票据')
    const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成.xlsx')
    const preview = vi.fn(async (_input: { source: { rawSnapshot: Record<string, string | number | boolean | null> } }) => result)
    const selected = Object.fromEntries(Object.entries(mapping).filter(([field]) => ['invoiceNumber', 'invoiceDate', 'seller', 'totalAmount'].includes(field)))
    const response = await previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping: selected, loadCatalog: async () => snapshot, preview })
    const raw = response.rows[0]!.source.rawSnapshot
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype)
    expect(Object.hasOwn(raw, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(raw, '__proto__')?.value).toBe('合成原始值')
    expect(raw.constructor).toBe(0)
    expect(raw.toString).toBeNull()
    const restored = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
    expect(Object.hasOwn(restored, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(restored, '__proto__')?.value).toBe('合成原始值')
    expect(preview.mock.calls[0]![0].source.rawSnapshot).toEqual(raw)
  })

  it('最后一条查重完成后发票来源变化时不展示过期结果', async () => {
    const order: string[] = []
    const preview = vi.fn(async (_input: unknown) => {
      order.push('preview')
      return order.filter(item => item === 'preview').length === 3 ? { ...result, sourceVersion: 'invoice-source-2' } : result
    })
    const loadCatalog = async () => {
      order.push('catalog')
      return snapshot
    }
    await expect(previewCentralInvoiceWorkbook({ file: workbook(), sheetName: '原始票据', mapping, loadCatalog, preview })).rejects.toThrow('发票来源在预览期间变化')
    expect(preview).toHaveBeenCalledTimes(3)
    expect(preview.mock.calls[2]![0]).toEqual(preview.mock.calls[1]![0])
    expect(order).toEqual(['catalog', 'preview', 'preview', 'catalog', 'preview'])
  })

  it('最终查重无法读取时不把旧结果当作完整预览', async () => {
    const preview = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('最终查重不可用'))
    await expect(previewCentralInvoiceWorkbook({ file: workbook(), sheetName: '原始票据', mapping, loadCatalog: async () => snapshot, preview })).rejects.toThrow('最终查重不可用')
  })

  it('目录权限失败、预览失败或读取期间来源变化均阻断，而不是显示无重复', async () => {
    const file = workbook()
    const preview = vi.fn(async () => result)
    await expect(previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping, loadCatalog: async () => {
      throw new Error('无权限')
    }, preview })).rejects.toThrow('无权限')
    expect(preview).not.toHaveBeenCalled()
    await expect(previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping, loadCatalog: async () => snapshot, preview: async () => {
      throw new Error('来源不可用')
    } })).rejects.toThrow('来源不可用')
    const changed = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, sourceVersion: 'invoice-source-2' })
    await expect(previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping, loadCatalog: async () => snapshot, preview: changed })).rejects.toThrow('来源在预览期间变化')
    const changedCatalog = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ ...snapshot, sourceVersions: { ...snapshot.sourceVersions, suppliers: 'suppliers:2' } })
    await expect(previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping, loadCatalog: changedCatalog, preview })).rejects.toThrow('目录在预览期间变化')
  })

  it('未确认映射不发送中央预览请求', async () => {
    const preview = vi.fn(async () => result)
    await expect(previewCentralInvoiceWorkbook({ file: workbook(), sheetName: '原始票据', mapping: { invoiceNumber: { column: '发票号码', confidence: 'suggested' } }, loadCatalog: async () => snapshot, preview })).rejects.toThrow('映射尚未确认')
    expect(preview).not.toHaveBeenCalled()
  })

  it.each([
    ['重复表头的别名', ['发票号码', '发票日期', '销售方', '价税合计', '税额', '税额', '税额_1']],
    ['空列占位名', ['发票号码', '发票日期', '销售方', '价税合计', '', '__EMPTY_5']],
  ] as Array<[string, string[]]>)('%s 与其他列同名时不读取目录或查重', async (_label, headers) => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ['00000001', '2026-11-01', '合成公司', 10, 1, 2, 3]]), '原始票据')
    const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成.xlsx')
    const preview = vi.fn(async () => result)
    const loadCatalog = vi.fn(async () => snapshot)
    await expect(previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping: { invoiceNumber: { column: '发票号码', confidence: 'confirmed' } }, loadCatalog, preview })).rejects.toThrow('工作表存在无法区分的列名')
    expect(loadCatalog).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
  })

  it('不同的重复表头别名仍可预览，但内部来源标识不能作为表格源列', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['发票号码', '发票日期', '销售方', '价税合计', '税额', '税额', '__importSource'],
      ['00000001', '2026-11-01', '合成公司', 10, 1, 2, '合成文本'],
    ]), '原始票据')
    const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成.xlsx')
    const preview = vi.fn(async () => result)
    const loadCatalog = vi.fn(async () => snapshot)
    const selected = { invoiceNumber: { column: '发票号码', confidence: 'confirmed' as const }, taxAmount: { column: '税额_1', confidence: 'confirmed' as const } }
    const response = await previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping: selected, loadCatalog, preview })
    expect(response.rows[0]!.fields.taxAmount).toBe(2)
    preview.mockClear()
    loadCatalog.mockClear()
    await expect(previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping: { ...selected, remark: { column: '__importSource', confidence: 'confirmed' } }, loadCatalog, preview })).rejects.toThrow('字段映射尚未确认或源列不存在')
    expect(loadCatalog).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
  })

  it('缺少票号或金额无法可靠解析时标为未查询，不伪装成没有重复', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['发票号码', '发票日期', '销售方', '价税合计'],
      ['', '2026-11-01', '合成公司', 10],
      ['00000002', '2026-11-02', '合成公司', '不明金额'],
    ]), '原始票据')
    const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成.xlsx')
    const preview = vi.fn(async () => result)
    const selected = Object.fromEntries(Object.entries(mapping).filter(([field]) => ['invoiceNumber', 'invoiceDate', 'seller', 'totalAmount'].includes(field)))
    const response = await previewCentralInvoiceWorkbook({ file, sheetName: '原始票据', mapping: selected, loadCatalog: async () => snapshot, preview })
    expect(response.rows.map(row => row.duplicatePreview)).toEqual([null, null])
    expect(response.rows[0]!.reviewReasons).toContain('缺少发票号码')
    expect(response.rows[1]!.reviewReasons).toContain('totalAmount 金额无法可靠解析')
    expect(preview).not.toHaveBeenCalled()
  })

  it('正式目录适配器保留空目录的版本，且拒绝不可读取或缺失版本', async () => {
    const identity = { workspaceId: 'workspace-1', actorId: 'actor-1' }
    const capabilities = ['finance-invoice:read', 'project:list:read', 'supplier:list:read']
    const context = async () => ({ ...identity, capabilities })
    const response = { context: { ...identity, capabilities }, asOf: '2026-11-04T00:00:00.000Z', sources: [{ key: 'projects', state: 'readable', sourceVersion: 'projects:3' }, { key: 'suppliers', state: 'readable', sourceVersion: 'suppliers:7' }], projects: [], suppliers: [], contracts: [] }
    const reader = createInvoiceImportCatalogReader({ identity, context, fetcher: async () => response })
    expect(await reader()).toEqual({ catalog: { projects: [], suppliers: [], contracts: [] }, sourceVersions: { projects: 'projects:3', suppliers: 'suppliers:7' } })
    const missing = createInvoiceImportCatalogReader({ identity, context, fetcher: async () => ({ ...response, sources: [{ key: 'projects', state: 'readable', sourceVersion: 'projects:3' }, { key: 'suppliers', state: 'unavailable', sourceVersion: null }] }) })
    await expect(missing()).rejects.toThrow('来源不可用')
  })
})
