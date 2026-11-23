/** 合成入口测试；只使用内存中生成的工作簿。 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { prepareInvoiceWorkbook } from '../../server/utils/production-invoice-workbook'

function fixture(fileName: string, sheetName: string, rawSnapshot: Record<string, string> = {}, bytes = Buffer.from('SYNTHETIC-WORKBOOK-NOT-TO-BE-PARSED')) {
  const fileDigest = createHash('sha256').update(bytes).digest('hex')
  const source = { fileName, fileDigest, sheetName, rowNumber: 2, rawSnapshot }
  const workbook = { fileName, fileSize: bytes.length, payloadBase64: bytes.toString('base64') }
  return { source, workbook }
}

function validWorkbook(sheetName: string) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['发票号码', '合成列'], ['SYN-UNICODE', '真实值']]), sheetName)
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array)
}

describe('新工作簿来源文本可无损保存', () => {
  it.each([
    ['高代理文件名', '\uD800.xlsx', '合成表'],
    ['低代理文件名', '\uDC00.xlsx', '合成表'],
    ['高代理工作表', '合成.xlsx', '\uD800'],
    ['低代理工作表', '合成.xlsx', '\uDC00'],
  ])('%s 在任何解析和持久化前明确拒绝', async (_label, fileName, sheetName) => {
    const input = fixture(fileName, sheetName)
    const original = JSON.stringify(input)
    await expect(prepareInvoiceWorkbook(input.workbook, input.source)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('无法可靠保存') } })
    expect(JSON.stringify(input)).toBe(original)
  })

  it.each([
    ['中文.xlsx', '合成表'],
    ['票据😀.xlsx', '合成😀表'],
    ['票据\'()*!😀.xlsx', '合成表'],
  ])('合法来源 %s 通过严格 XML 核验并保持原样', async (fileName, sheetName) => {
    const input = fixture(fileName, sheetName, { 发票号码: 'SYN-UNICODE', 合成列: '真实值' }, validWorkbook(sheetName))
    await expect(prepareInvoiceWorkbook(input.workbook, input.source)).resolves.toMatchObject({ fileName, row: input.source.rawSnapshot })
    expect(input.source.fileName).toBe(fileName)
    expect(input.source.sheetName).toBe(sheetName)
  })

  it('json 快照中的原始码元不作为单独 TEXT 身份而被改写或额外拦截', async () => {
    const input = fixture('合成.xlsx', '合成表', { 发票号码: 'SYN-UNICODE', 合成列: '\uD800' }, validWorkbook('合成表'))
    await expect(prepareInvoiceWorkbook(input.workbook, input.source)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('快照与工作簿正文不一致') } })
    expect(input.source.rawSnapshot['合成列']).toBe('\uD800')
  })
})
