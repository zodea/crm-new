import { describe, expect, it } from 'vitest'
import { ReceiptRepositoryProblem } from '~/lib/receipt/contract'
import { parseReceiptCommand } from '../../server/utils/receipt-command-request'
import { command } from './fixtures'

describe('收款 HTTP 写入边界', () => {
  it.each([{ label: '未填写金额', amount: null }, { label: '明确零金额', amount: '0.00' }])('完整载荷解析后保持$label', ({ amount }) => {
    expect(parseReceiptCommand(command())).toEqual(command())
    const request = command()
    request.draft = { ...request.draft, amount, customerId: null, projectId: null }
    expect(parseReceiptCommand(request).draft).toMatchObject({ amount, customerId: null, projectId: null })
  })

  it.each([
    { label: '空命令', input: null, message: '收款命令格式无效' },
    { label: '空草稿', input: { ...command(), draft: null }, message: '收款命令格式无效' },
    { label: '演示来源', input: { ...command(), origin: 'demo' }, message: '收款命令格式无效' },
    { label: '不存在的操作', input: { ...command(), action: 'confirm' }, message: '收款命令格式无效' },
    { label: '数字版本', input: { ...command(), baseVersion: 1 }, message: '收款命令格式无效' },
    { label: '数字金额', input: { ...command(), draft: { ...command().draft, amount: 120.35 } }, message: '收款字段格式无效', field: 'amount' },
    { label: '客户数组', input: { ...command(), draft: { ...command().draft, customerId: ['customer-a'] } }, message: '收款字段格式无效', field: 'customerId' },
    { label: '缺少收款日期', input: { ...command(), draft: { ...command().draft, receiptDate: undefined } }, message: '收款字段格式无效', field: 'receiptDate' },
    { label: '空移除附件编号', input: { ...command(), attachments: { removeIds: [null] } }, message: '附件变更格式无效' },
    { label: '空附件', input: { ...command(), attachments: { add: [null] } }, message: '附件变更字段格式无效' },
    { label: '数字附件名', input: { ...command(), attachments: { add: [{ fileName: 1 }] } }, message: '附件变更字段格式无效' },
    { label: '数字附件内容', input: { ...command(), attachments: { add: [{ fileName: '文件', payloadBase64: 1 }] } }, message: '附件变更字段格式无效' },
  ])('拒绝非法 HTTP 格式：$label', ({ input, message, field }) => {
    let error: unknown
    try {
      parseReceiptCommand(input)
    }
    catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(ReceiptRepositoryProblem)
    expect(error).toMatchObject({ problem: { code: 'validation-failed', message, fieldErrors: field ? { [field]: ['请重新核对该字段'] } : {} } })
  })
})
