// 分供方类别与资料状态枚举与语义色调——单一权威源（表单下拉 / 列表筛选 / 列表与详情的颜色映射共用）。
// 各页面的具体 class 系统不同（列表用 cell--status-*、详情用 chip-*），故只共享
// 「状态键集」与「语义色调」，class 由各页按色调映射，避免多处各抄一份状态清单而漂移（对称 ~/lib/project/status）。
// 权威口径：CONTEXT.md「分供方」词条（2026-07-09）。

/** 分供方类别清单（权威 6 类，顺序即下拉/筛选展示顺序）。此前表单枚举缺「专业分包商」，导致部分存量数据选不中，本次补齐。 */
export const SUPPLIER_CATEGORIES = ['材料供应商', '劳务分包商', '专业分包商', '设备供应商', '个人', '其他'] as const

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number]

/** 资料状态清单（credential_status，资质准入态；非 approval_status 审批流，见 #89 Out of Scope）。 */
export const CREDENTIAL_STATUSES = ['incomplete', 'reviewing', 'qualified', 'rejected'] as const

export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]

export const CREDENTIAL_STATUS_LABEL: Record<string, string> = {
  incomplete: '资料缺失',
  reviewing: '审核中',
  qualified: '合格',
  rejected: '退回',
}

/** 状态语义色调（与具体 class 解耦） */
export type StatusTone = 'warn' | 'brand' | 'ok' | 'danger'

/** 资料状态 → 语义色调（新增状态只需在此登记一次，各页颜色随之生效） */
export const CREDENTIAL_STATUS_TONE: Record<string, StatusTone> = {
  incomplete: 'warn',
  reviewing: 'brand',
  qualified: 'ok',
  rejected: 'danger',
}
