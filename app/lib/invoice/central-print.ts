import type { CentralInvoiceRecord } from './central-contract'
import { hasPrintableCentralOriginal } from './print-layout'

/** 与中央打印命令及原件门槛一致；未通过的记录只用于说明，不进入排版。 */
export function centralInvoicePrintReason(record: CentralInvoiceRecord): string | null {
  if (record.deletedAt !== null || record.accountStatus !== 'archived')
    return '发票未归档或已删除，不能打印'
  if (record.sourceKind === 'excel' && !record.original)
    return 'Excel 导入的发票没有原件，不能打印'
  if (record.sourceKind !== 'scan' && record.sourceKind !== 'excel')
    return '当前票据来源不支持打印'
  if (!hasPrintableCentralOriginal(record.sourceKind, record.original))
    return '发票未关联原件，不能打印'
  if (record.sourceKind === 'excel' && !record.originalVerificationId)
    return 'Excel 发票须先确认原件核验'
  if (record.sourceKind === 'scan' && record.ocrStatus !== 'done')
    return '识别尚未完成，不能打印'
  if (record.reviewStatus !== 'reviewed')
    return '当前字段尚未完成人工确认，不能打印'
  if (record.duplicateStatus !== 'normal')
    return '重复票据已排除，不能打印'
  if (record.fields.totalAmount === null)
    return '价税合计未填写，不能打印'
  if (!Number.isFinite(record.fields.totalAmount) || record.fields.totalAmount <= 0)
    return '价税合计不是有效正数，不能打印'
  return null
}
