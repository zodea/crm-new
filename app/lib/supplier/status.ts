// 分供方类别和资料状态由表单、列表筛选、状态标签及导出共用。
// 权威口径：CONTEXT.md「分供方」词条（2026-07-09）。

/** 分供方类别清单（权威 7 类，顺序即下拉/筛选展示顺序）。 */
export const SUPPLIER_CATEGORIES = ['材料供应商', '劳务分包商', '专业分包商', '设备供应商', '检测供应商', '个人', '其他'] as const

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number]

/** 已有档案表单可选的纳税人类型；历史其他值由查询 facet 继续提供。 */
export const SUPPLIER_TAXPAYER_TYPES = ['未核验', '一般纳税人', '小规模纳税人'] as const

/** 资料状态清单（credential_status，资质准入态；非 approval_status 审批流，见 #89 Out of Scope）。 */
export const CREDENTIAL_STATUSES = ['incomplete', 'reviewing', 'qualified', 'rejected'] as const

export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]

export const CREDENTIAL_STATUS_LABEL: Record<string, string> = {
  incomplete: '资料缺失',
  reviewing: '齐全待核验',
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
