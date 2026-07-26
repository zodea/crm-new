import type { BoqChangeOrderView, BoqChangeStatus } from './read-model'

export const BOQ_CHANGE_TYPE_LABEL: Record<BoqChangeOrderView['changeType'], string> = {
  add: '新增',
  qty: '调量',
  price: '调价',
  mixed: '混合',
}

export const BOQ_CHANGE_STATUS_LABEL: Record<BoqChangeStatus, string> = {
  draft: '草稿',
  submitted: '已上报',
  rejected: '已打回',
  approved: '已签证',
}

export const BOQ_MONTHLY_STATUS_LABEL: Record<'draft' | 'adjusted' | 'exported', string> = {
  draft: '自动草稿',
  adjusted: '已手调',
  exported: '已导出',
}
