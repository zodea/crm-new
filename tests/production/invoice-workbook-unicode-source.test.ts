/** 合成入口测试；保留真实 XML fail-closed，不访问数据库、文件或服务。 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prepareInvoiceWorkbook } from '../../server/utils/production-invoice-workbook'

const bytes = Buffer.from('SYNTHETIC-WORKBOOK-NOT-TO-BE-PARSED')
const fileDigest = createHash('sha256').update(bytes).digest('hex')
function fixture(fileName: string, sheetName: string, rawSnapshot: Record<string, string> = {}) {
  const source = { fileName, fileDigest, sheetName, rowNumber: 2, rawSnapshot }
  const workbook = { fileName, fileSize: bytes.length, payloadBase64: bytes.toString('base64') }
  return { source, workbook }
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
  ])('合法来源 %s 不被额外拒绝，仍受 XML 门禁保护', async (fileName, sheetName) => {
    const input = fixture(fileName, sheetName)
    await expect(prepareInvoiceWorkbook(input.workbook, input.source)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('安全核验暂不可用') } })
    expect(input.source.fileName).toBe(fileName)
    expect(input.source.sheetName).toBe(sheetName)
  })

  it('json 快照中的原始码元不作为单独 TEXT 身份而被改写或额外拦截', async () => {
    const input = fixture('合成.xlsx', '合成表', { 合成列: '\uD800' })
    await expect(prepareInvoiceWorkbook(input.workbook, input.source)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('安全核验暂不可用') } })
    expect(input.source.rawSnapshot['合成列']).toBe('\uD800')
  })
})
