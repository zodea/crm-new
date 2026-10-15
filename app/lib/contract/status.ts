// 合同域枚举与语义色调——单一权威源（三列表 SegTab 视图 / 表单下拉 / KitStatusTag 共用）。
// 蓝本：DC重构设计源码/kit/{ConContract,SubContract,MatContract,ContractDetail}Screen.jsx（issue #90 批A）。
// 状态事实由领域维护，视觉由 KitStatusTag 承接。

import type { KitStatusTone } from '~/components/ui/KitStatusTag.vue'
import type { StatusTone } from '~/lib/project/status'

/** 合同类别（kind）：施工=收入侧（甲方=项目 developer），分包/材采=支出侧（乙方=分供方） */
export const CONTRACT_KINDS = ['施工', '分包', '材采'] as const

export type ContractKind = (typeof CONTRACT_KINDS)[number]

/** 分包合同子类（subKind，仅 kind=分包） */
export const CONTRACT_SUB_KINDS = ['劳务', '专业'] as const

/** 合同业务态（顺序即 SegTab 视图/下拉展示顺序，草稿与审批入口固定可见） */
export const CONTRACT_STATUSES = ['草稿', '审批中', '履约中', '已签订', '已结算', '已结清'] as const

export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

/** 状态 → 语义色调（设计稿 STATUS_TONE：履约中 brand / 已签订 neutral / 已结算 warn / 已结清 ok） */
export const CONTRACT_STATUS_TONE: Record<string, StatusTone> = {
  草稿: 'muted',
  审批中: 'warn',
  履约中: 'brand',
  已签订: 'muted',
  已结算: 'warn',
  已结清: 'ok',
}

/** 未知及空状态保留原文或调用点空值文案，使用中性展示。 */
export function contractStatusTone(status: string | null | undefined): KitStatusTone {
  const value = status ?? ''
  const tone = Object.hasOwn(CONTRACT_STATUS_TONE, value) ? CONTRACT_STATUS_TONE[value] : undefined
  return !tone || tone === 'muted' ? 'neutral' : tone
}

/** 收入/支出侧口径文案：施工=开票/收款/应收，支出侧（分包/材采）=收票/支付/应付 */
export function kindLabels(kind: ContractKind) {
  const isCon = kind === '施工'
  return {
    invoiced: isCon ? '累计开票' : '累计收票',
    paid: isCon ? '累计收款' : '累计支付',
    balance: isCon ? '按结算应收余额' : '按结算应付余额',
    party: isCon ? '甲方（客户）' : '乙方（分供方）',
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** 派生列「按结算应收/应付余额」= 累计结算 − 累计收款/支付（正数标红，不入表单不入库） */
export function contractBalance(c: { settled: number | null, paid: number | null }): number {
  return round2((c.settled ?? 0) - (c.paid ?? 0))
}
