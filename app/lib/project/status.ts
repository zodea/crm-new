// 项目状态枚举与语义色调——单一权威源（表单下拉 / 列表筛选 / 列表与详情的颜色映射共用）。
// 各页面的具体 class 系统不同（列表用 cell--status-*、详情用 chip-*），故只共享
// 「状态键集」与「语义色调」，class 由各页按色调映射，避免多处各抄一份状态清单而漂移。

/** 项目状态清单（业务枚举，顺序即下拉/筛选展示顺序） */
export const PROJECT_STATUSES = ['筹备中', '施工中', '停工', '已竣工', '已结算'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/**
 * 状态归一：合法枚举值原样保留，空值/未知值（如外部导入带的旧枚举「在建」「完工」）回落
 * schema 默认「筹备中」——挡住任意文本经导入写进非法阶段（否则列表 chip 落 muted 兜底、
 * 阶段筛选也筛不出）。这里只做「合法即留、非法回落」，不做同义词映射（阶段枚举定稿归 #66）。
 */
export function normalizeProjectStatus(raw: unknown): ProjectStatus {
  const value = String(raw ?? '')
  return (PROJECT_STATUSES as readonly string[]).includes(value)
    ? (value as ProjectStatus)
    : '筹备中'
}

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
