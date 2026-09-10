import type { KitStatusTone } from '~/components/ui/KitStatusTag.vue'

const FINANCE_STATUS_TONES: Readonly<Record<string, KitStatusTone>> = {
  draft: 'neutral',
  submitted: 'brand',
  approved: 'ok',
  rejected: 'danger',
  paid: 'ok',
  confirmed: 'ok',
  needs_review: 'warn',
  cancelled: 'neutral',
}

export function financeStatusTone(status: string): KitStatusTone {
  return FINANCE_STATUS_TONES[status] ?? 'neutral'
}

const FINANCE_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已审批',
  rejected: '已驳回',
  paid: '已支付',
  confirmed: '已确认',
  needs_review: '待核对',
  cancelled: '已取消',
}

/** 财务列表只在展示层翻译状态，数据库仍保存原始状态值。 */
export function financeStatusLabel(status: string): string {
  return FINANCE_STATUS_LABELS[status] ?? (status || '草稿')
}
