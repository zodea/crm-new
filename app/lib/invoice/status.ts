// 发票文档工作流状态派生(唯一权威)——文档管理表与识别工作台左栏共用同一优先级判定,
// 各视图只做「状态 → 文案/样式」的本地映射,不再各写一套判定(此前两套优先级互相矛盾:
// 文档表先判 duplicate、工作台先判 pending,failed 还漏了分支落到「待校对」)。
// 优先级:识别中(会话态,压过一切) > 待识别/识别失败(内容未产出,谈不上重复) >
//        重复(已产出但被排除) > 待校对 > 已校对。

export type InvoiceDocStatus = 'recognizing' | 'pending' | 'failed' | 'duplicate' | 'unreviewed' | 'reviewed'

export function invoiceDocStatus(
  inv: { ocrStatus: string, dupStatus: string, reviewStatus: string },
  recognizing = false,
): InvoiceDocStatus {
  if (recognizing)
    return 'recognizing'
  if (inv.ocrStatus === 'pending')
    return 'pending'
  if (inv.ocrStatus === 'failed')
    return 'failed'
  if (inv.dupStatus === 'duplicate')
    return 'duplicate'
  if (inv.reviewStatus === 'unreviewed')
    return 'unreviewed'
  return 'reviewed'
}
