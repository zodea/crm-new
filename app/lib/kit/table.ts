// KitTable(#51 vxe-table 三件套封装)的纯逻辑:列配置归一化、单元格格式化、
// 列头筛选选项推导、客户端分页。抽到此处便于 node 环境 vitest 直接断言(不依赖 DOM)。
// 金额口径复用 lib/util/money.ts 的 yuan(),不在表格层再造格式化。

import { yuan } from '~/lib/util/money'

export type KitColumnType = 'seq' | 'checkbox' | 'text' | 'money' | 'date' | 'action'

export interface KitFilterOption {
  label: string
  value: unknown
}

export interface KitTableColumn {
  /** 数据字段名;seq / action 列可省。 */
  field?: string
  title: string
  /** 列语义类型,决定默认宽度/对齐/格式化;缺省 'text'。 */
  type?: KitColumnType
  width?: number
  minWidth?: number
  fixed?: 'left' | 'right'
  align?: 'left' | 'center' | 'right'
  /**
   * 列头筛选:true → 从当前数据行推导选项(适合非分页小表);
   * 显式 KitFilterOption[] → 受控分页下由调用方从全量数据推导(deriveFilterOptions)。
   */
  filterable?: boolean | KitFilterOption[]
  /** 自定义单元格插槽名;action 列缺省用 'action' 插槽。 */
  slot?: string
}

export interface NormalizedKitColumn extends KitTableColumn {
  type: KitColumnType
  align: 'left' | 'center' | 'right'
  filterable: boolean | KitFilterOption[]
  /** vxe 列 className;money → 'col--money'(vxe-theme.css 等宽右对齐钩子)。 */
  className?: string
}

/** 各类型列的默认形状(显式传入的字段一律优先)。 */
export function normalizeKitColumn(col: KitTableColumn): NormalizedKitColumn {
  const type = col.type ?? 'text'
  const out: NormalizedKitColumn = {
    ...col,
    type,
    align: col.align ?? (type === 'money' ? 'right' : type === 'seq' || type === 'checkbox' ? 'center' : 'left'),
    filterable: col.filterable ?? false,
  }
  if (type === 'money')
    out.className = 'col--money'
  if (col.width == null && col.minWidth == null) {
    if (type === 'seq')
      out.width = 52
    else if (type === 'checkbox')
      out.width = 40
    else if (type === 'date')
      out.width = 110
    else if (type === 'action')
      out.width = 130
    else
      out.minWidth = 120
  }
  if (type === 'action')
    out.fixed = col.fixed ?? 'right'
  return out
}

/**
 * 从数据行为某字段推导列头筛选选项(vxe filters 形状):
 * 按首次出现顺序去重;null / undefined / 空串不产出选项,
 * NaN 也不产出(NaN === NaN 恒 false,选项永远筛不出行)。
 * 注意:选项只来自传入的 rows——受控分页下传当前页切片会得到不完整选项,
 * 应对全量数据调用本函数并经列配置 filterable 显式传入。
 */
export function deriveFilterOptions(rows: Record<string, unknown>[], field: string): KitFilterOption[] {
  const seen = new Set<unknown>()
  const out: KitFilterOption[] = []
  for (const row of rows) {
    const v = row[field]
    if (v == null || v === '' || Number.isNaN(v) || seen.has(v))
      continue
    seen.add(v)
    out.push({ label: String(v), value: v })
  }
  return out
}

/** 单元格显示值:money 走 yuan(¥#,##0.00),其余原样转字符串;空值统一 — 占位。 */
export function formatCell(col: NormalizedKitColumn, value: unknown): string {
  if (col.type === 'money')
    return yuan(value as number | string | null | undefined)
  if (value == null || value === '')
    return '—'
  return String(value)
}

/** 总页数:向上取整,至少 1 页;pageSize 非法(≤0)按 1 页兜底,不产出 Infinity。 */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0)
    return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

/** 页码钳到 [1, 总页数]——筛选/删除收窄数据后当前页越界时回落。 */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize))
}

/** 客户端分页切片(1 起始页码);越界返回空数组。 */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize)
}
