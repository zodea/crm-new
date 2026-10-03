import { describe, expect, it } from 'vitest'
import { parseReceiptCommand } from '../../server/utils/receipt-command-request'
import { command } from './fixtures'

describe('收款 HTTP 写入边界', () => {
  it.each(([null, '0.00']).map(input => ({ input })))('完整载荷按已声明字段解析，草稿缺值与明确零保持不同：输入案例 %#', ({ input: amount }) => {
    expect(parseReceiptCommand(command())).toEqual(command())
    const request = command()
    request.draft = { ...request.draft, amount, customerId: null, projectId: null }
    expect(parseReceiptCommand(request).draft).toMatchObject({ amount, customerId: null, projectId: null })
  })

  it.each([
    null,
    { ...command(), draft: null },
    { ...command(), origin: 'demo' },
    { ...command(), action: 'confirm' },
    { ...command(), baseVersion: 1 },
    { ...command(), draft: { ...command().draft, amount: 120.35 } },
    { ...command(), draft: { ...command().draft, customerId: ['customer-a'] } },
    { ...command(), draft: { ...command().draft, receiptDate: undefined } },
    { ...command(), attachments: { removeIds: [null] } },
    { ...command(), attachments: { add: [null] } },
    { ...command(), attachments: { add: [{ fileName: 1 }] } },
    { ...command(), attachments: { add: [{ fileName: '文件', payloadBase64: 1 }] } },
  ])('拒绝非法 HTTP 格式，不让强制类型转换跳过领域字段校验：%j', (input) => {
    expect(() => parseReceiptCommand(input)).toThrow()
  })
})
