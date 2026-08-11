import { round2 } from '~/lib/util/number'

export type DeliveryAmountSource = 'calculated' | 'ocr' | 'manual'

export interface DeliveryAmountLine {
  id: string
  qty: number | null
  unitPrice: number | null
  amount: number | null
  amountSource: DeliveryAmountSource
}

export interface DeliveryAmountSummary {
  total: number
  mismatchedLineIds: string[]
  statedBalanced: boolean | null
  balanced: boolean
}

export interface DeliveryReviewConfirmations {
  humanReviewed: boolean
  amountReviewed: boolean
  noOrderNoConfirmed: boolean
  qualityReviewed: boolean
}

/** 送货单当前值之外的原始/修订留痕，不参与金额或材料事实计算。 */
export interface DeliveryReviewProvenance {
  sourceId: string
  sourceFileName?: string
  originalOcr?: Readonly<Record<string, unknown>> | null
  revisions?: readonly {
    field: string
    from: unknown
    to: unknown
    reason: string
    at: string
  }[]
}

export interface DeliveryReviewInput {
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  docType: string
  note: string
  statedTotal?: number | null
  items: readonly (DeliveryAmountLine & {
    name: string
    unit: string
  })[]
  confirmations?: Partial<DeliveryReviewConfirmations>
  /** 存在时必须是识别完成态；手工录入可不传。 */
  ocrStatus?: string
  /** 导入/去重或数据库唯一键发现的送货单自然键冲突。 */
  naturalKeyDuplicate?: boolean
  provenance?: DeliveryReviewProvenance
}

export interface DeliveryReviewPolicy {
  nonMaterial?: boolean
  requiresAmountReview?: boolean
  requiresQualityReview?: boolean
}

export type DeliveryReviewIssueKey = 'non-material' | 'ocr-status' | 'duplicate' | 'project' | 'supplier' | 'date' | 'order-no' | 'items' | 'amount' | 'quality' | 'human-reviewed'

export interface DeliveryReviewIssue {
  key: DeliveryReviewIssueKey
  label: string
}

export function calculatedDeliveryAmount(line: Pick<DeliveryAmountLine, 'qty' | 'unitPrice'>): number | null {
  if (line.qty == null || line.unitPrice == null)
    return null
  return round2(line.qty * line.unitPrice)
}

export function editDeliveryAmountLine<T extends DeliveryAmountLine>(
  line: T,
  field: 'qty' | 'unitPrice' | 'amount',
  value: number,
): T {
  const numeric = Number.isFinite(value) ? value : null
  if (field === 'amount') {
    return {
      ...line,
      amount: numeric == null ? null : round2(numeric),
      amountSource: 'manual',
    }
  }
  const next = { ...line, [field]: numeric }
  if (line.amountSource === 'calculated')
    next.amount = calculatedDeliveryAmount(next)
  return next
}

export function summarizeDeliveryAmounts(
  lines: readonly DeliveryAmountLine[],
  statedTotal: number | null,
): DeliveryAmountSummary {
  const total = round2(lines.reduce((sum, line) => sum + (line.amount ?? 0), 0))
  const mismatchedLineIds = lines
    .filter((line) => {
      if (line.amount == null)
        return false
      const calculated = calculatedDeliveryAmount(line)
      return calculated != null && Math.abs(calculated - line.amount) > 0.01
    })
    .map(line => line.id)
  const statedBalanced = statedTotal == null
    ? null
    : Math.abs(total - statedTotal) <= 1
  return {
    total,
    mismatchedLineIds,
    statedBalanced,
    balanced: lines.length > 0 && mismatchedLineIds.length === 0 && statedBalanced !== false,
  }
}

export function hasDeliveryPricePending(
  lines: readonly Pick<DeliveryAmountLine, 'unitPrice' | 'amount'>[],
): boolean {
  return lines.some(line => line.unitPrice == null || line.amount == null)
}

export function deliveryReviewIssues(
  input: DeliveryReviewInput,
  policy: DeliveryReviewPolicy = {},
): string[] {
  return deliveryReviewIssueDetails(input, policy).map(issue => issue.label)
}

export function deliveryReviewIssueDetails(
  input: DeliveryReviewInput,
  policy: DeliveryReviewPolicy = {},
): DeliveryReviewIssue[] {
  const confirmations = input.confirmations ?? {}
  const issues: DeliveryReviewIssue[] = []

  if (policy.nonMaterial)
    issues.push({ key: 'non-material', label: '当前文件属于非材料/待处理，必须人工改判为材料到货后才能归档' })
  if (input.ocrStatus && input.ocrStatus !== 'done')
    issues.push({ key: 'ocr-status', label: '送货单识别尚未完成，不能进入归档终态' })
  if (input.naturalKeyDuplicate)
    issues.push({ key: 'duplicate', label: '送货单自然键重复，需先完成重复记录复核' })
  if (!input.projectId)
    issues.push({ key: 'project', label: '必须选择所属项目' })
  if (!input.supplierId)
    issues.push({ key: 'supplier', label: '必须人工选择已有分供方，或先确认新增分供方' })
  if (!input.deliveryDate)
    issues.push({ key: 'date', label: '缺少送货日期，必须依据原件人工补录' })
  if (!input.orderNo && !confirmations.noOrderNoConfirmed)
    issues.push({ key: 'order-no', label: '缺少送货单号；只有确认原件确实无单号后才能归档' })

  const invalidLines = input.items.filter(item =>
    !item.name.trim() || !item.unit.trim() || item.qty == null || item.qty <= 0,
  )
  if (invalidLines.length)
    issues.push({ key: 'items', label: '每条明细必须人工确认材料名称、单位和非零数量' })
  if (!input.items.length)
    issues.push({ key: 'items', label: '至少保留一条材料明细' })

  const invalidAmountLines = input.items.filter(item =>
    (item.amount != null && (!Number.isFinite(item.amount) || item.amount < 0))
    || (item.unitPrice != null && (!Number.isFinite(item.unitPrice) || item.unitPrice < 0)),
  )
  if (invalidAmountLines.length) {
    issues.push({ key: 'amount', label: '单价或金额存在异常数值，必须人工修正后才能归档' })
    if (!input.note.trim())
      issues.push({ key: 'amount', label: '单价或金额异常必须记录保留票面值或修正值的原因' })
  }

  const summary = summarizeDeliveryAmounts(input.items, input.statedTotal ?? null)
  if (policy.requiresAmountReview || summary.mismatchedLineIds.length || summary.statedBalanced === false) {
    if (!confirmations.amountReviewed)
      issues.push({ key: 'amount', label: '金额异常必须人工复核并确认' })
    if (!input.note.trim())
      issues.push({ key: 'amount', label: '金额复核必须记录保留票面金额或修正金额的原因' })
  }
  if (policy.requiresQualityReview && !confirmations.qualityReviewed)
    issues.push({ key: 'quality', label: '手写、模糊或低置信内容必须人工复核确认' })
  if (!confirmations.humanReviewed)
    issues.push({ key: 'human-reviewed', label: '请先查看原件并确认 OCR 草稿，再点击归档' })

  return issues.filter((issue, index, all) => all.findIndex(candidate => candidate.key === issue.key && candidate.label === issue.label) === index)
}
