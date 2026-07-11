// 项目状态枚举与语义色调——单一权威源（表单下拉 / 列表筛选 / 列表与详情的颜色映射共用）。
// 各页面的具体 class 系统不同（列表用 cell--status-*、详情用 chip-*），故只共享
// 「状态键集」与「语义色调」，class 由各页按色调映射，避免多处各抄一份状态清单而漂移。

/** 项目状态清单（业务枚举，顺序即下拉/筛选展示顺序） */
export const PROJECT_STATUSES = ['筹备中', '施工中', '停工', '已竣工', '已结算'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 状态语义色调（与具体 class 解耦） */
export type StatusTone = 'warn' | 'brand' | 'muted' | 'ok'

/** 状态 → 语义色调（新增状态只需在此登记一次，各页颜色随之生效） */
export const PROJECT_STATUS_TONE: Record<string, StatusTone> = {
  筹备中: 'warn',
  施工中: 'brand',
  停工: 'muted',
  已竣工: 'ok',
  已结算: 'ok',
}
