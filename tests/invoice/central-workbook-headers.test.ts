import type { InvoiceImportSheet } from '~/lib/invoice/excel'
import { describe, expect, it } from 'vitest'
import { centralInvoiceHeaderStatus } from '~/lib/invoice/central-workbook-headers'

const sheet = (columns: string[]) => ({ name: '票据', columns }) as InvoiceImportSheet
const evidence = (headers: string[]) => [{ sheetName: '票据', columns: headers.map((rawHeader, index) => ({ index, rawHeader })) }]

describe('中央预览原始表头证据', () => {
  it('拒绝缺失、不完整、重复工作表、错误位置与不一致的列名', () => {
    const value = sheet(['发票号码', '__EMPTY_2', '__EMPTY_2_1'])
    const headers = evidence(['发票号码', '', '__EMPTY_2'])
    expect(centralInvoiceHeaderStatus(undefined, value)).toBe('missing')
    expect(centralInvoiceHeaderStatus([], value)).toBe('missing')
    expect(centralInvoiceHeaderStatus([...headers, ...headers], value)).toBe('missing')
    expect(centralInvoiceHeaderStatus(evidence(['发票号码']), value)).toBe('missing')
    expect(centralInvoiceHeaderStatus([{ sheetName: '票据', columns: [{ index: 1, rawHeader: '发票号码' }] }], sheet(['发票号码']))).toBe('missing')
    expect(centralInvoiceHeaderStatus(evidence(['发票号码', '', '其他']), value)).toBe('missing')
    expect(centralInvoiceHeaderStatus(headers, value)).toBe('collision')
  })

  it('不把普通重复表头或非碰撞占位列当作冲突', () => {
    expect(centralInvoiceHeaderStatus(evidence(['税额', '税额']), sheet(['税额', '税额_1']))).toBe('valid')
    expect(centralInvoiceHeaderStatus(evidence(['', '__EMPTY_2']), sheet(['__EMPTY_1', '__EMPTY_2']))).toBe('valid')
  })
})
