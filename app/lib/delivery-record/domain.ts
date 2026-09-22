import type { DeliveryDraft, DeliveryDraftLine } from './contract'
import { isISODateDTO } from '../../types/read-model'
import { calculatedDeliveryAmount, hasDeliveryPricePending, normalizeDeliveryOrderNo, summarizeDeliveryAmounts } from '../delivery/review'
import { deliveryProblem } from './contract'

/** 旧核对标记只有在当前必需事实完整时才有效；不改写缺失或异常原值。 */
export function hasCompleteDeliveryValues(record: {
  supplierId: unknown
  deliveryDate: unknown
  lines: readonly { materialName: unknown, unit: unknown, qty: unknown, unitPrice?: unknown, amount?: unknown }[]
}): boolean {
  return typeof record.supplierId === 'string' && !!record.supplierId.trim()
    && isISODateDTO(record.deliveryDate) && record.lines.length > 0
    && record.lines.every(line => typeof line.materialName === 'string' && !!line.materialName.trim()
      && typeof line.unit === 'string' && !!line.unit.trim()
      && typeof line.qty === 'number' && Number.isFinite(line.qty) && line.qty > 0
      && [line.unitPrice, line.amount].every(value => value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)))
}

export function normalizeDeliveryDraft(draft: DeliveryDraft): DeliveryDraft {
  const fail = (message: string): never => {
    throw deliveryProblem('validation-failed', message)
  }
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.lines))
    fail('送货字段格式无效')
  if (!draft.projectId?.trim())
    fail('送货单必须选择项目')
  if (!draft.supplierId?.trim())
    fail('请依据原件人工选择分供方')
  if (!isISODateDTO(draft.deliveryDate))
    fail('请依据原件人工填写送货日期')
  const lines = draft.lines.map((line): DeliveryDraftLine => {
    if (!line.materialName?.trim() || !line.unit?.trim() || typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty <= 0)
      fail('每条明细必须确认材料名称、单位和非零数量')
    for (const amount of [line.unitPrice, line.amount]) {
      if (amount !== undefined && amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0))
        fail('单价或金额存在异常数值')
    }
    const amountSource = line.amountSource ?? (line.amount === undefined ? 'calculated' : 'manual')
    if (!['calculated', 'manual', 'ocr'].includes(amountSource))
      fail('金额来源无效')
    return { ...(line.id ? { id: line.id } : {}), materialName: line.materialName.trim(), spec: line.spec?.trim() ?? '', unit: line.unit.trim(), qty: line.qty, unitPrice: line.unitPrice ?? null, amount: line.amount === undefined ? calculatedDeliveryAmount(line) : line.amount, amountSource, note: line.note?.trim() ?? '' }
  })
  if (!lines.length)
    fail('至少添加一条材料明细')
  const flags = (draft.reviewFlag ?? '').split(/[；;]/).map(value => value.trim()).filter(value => value && !['原件无单号', '价格待补录'].includes(value))
  const orderNo = normalizeDeliveryOrderNo(draft.orderNo ?? '')
  if (!orderNo) {
    if (draft.confirmations?.noOrderNoConfirmed !== true)
      fail('请先确认原件确实无单号')
    flags.push('原件无单号')
  }
  const amountLines = lines.map((line, index) => ({ ...line, id: line.id ?? String(index), amount: line.amount ?? null, amountSource: line.amountSource! }))
  if (hasDeliveryPricePending(amountLines)) {
    if (draft.confirmations?.pricePendingConfirmed !== true)
      fail('请先确认按价格待补录归档')
    flags.push('价格待补录')
  }
  if (summarizeDeliveryAmounts(amountLines, null).mismatchedLineIds.length && (!draft.confirmations?.amountReviewed || !draft.note?.trim()))
    fail('金额异常必须人工确认并记录原因')
  return { projectId: draft.projectId.trim(), supplierId: draft.supplierId!.trim(), deliveryDate: draft.deliveryDate, orderNo, note: draft.note?.trim() ?? '', rawSiteText: draft.rawSiteText ?? '', reviewFlag: [...new Set(flags)].join('；'), confirmations: { noOrderNoConfirmed: draft.confirmations?.noOrderNoConfirmed === true, pricePendingConfirmed: draft.confirmations?.pricePendingConfirmed === true, amountReviewed: draft.confirmations?.amountReviewed === true }, lines }
}
