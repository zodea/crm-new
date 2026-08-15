export interface ProjectLedgerSource {
  name: string
  status: string
  contractAmount: number | string | null
  operationType: string
  startDate: string | null
  plannedEnd: string | null
  actualEnd: string | null
  plannedDuration: number | null
  manager: string
  execManager: string
  builder: string
  developer: string
  developer2: string
  contractName: string
  contractor: string
  region: string
  riskLevel: string
  address: string
}

// 项目台账导出的纯逻辑（ADR 0004）：列标签映射与逐项目导出行投影，node 可测。
// 实际写盘/xlsx 序列化在 ProjectListScreen（依赖 xlsx 与 KitUI exportFile），本层只产出
// 「与设计稿一致的列 + 每个项目一行」的纯数据，供直接保存单文件与配置页签分类导出共用。

export interface ProjectExportColumn {
  /** Project 字段名 */
  key: keyof ProjectLedgerSource
  /** 导出表头（中文，红圈台账口径） */
  label: string
}

/** 台账导出列（顺序即导出表头顺序，红圈「项目信息」台账对齐）。 */
export const PROJECT_EXPORT_COLUMNS: readonly ProjectExportColumn[] = [
  { key: 'name', label: '项目名称' },
  { key: 'status', label: '业务流程阶段' },
  { key: 'contractAmount', label: '合同金额（万元）' },
  { key: 'operationType', label: '经营类型' },
  { key: 'startDate', label: '计划开工' },
  { key: 'plannedEnd', label: '计划竣工' },
  { key: 'actualEnd', label: '实际竣工' },
  { key: 'plannedDuration', label: '计划工期（天）' },
  { key: 'manager', label: '项目经理' },
  { key: 'execManager', label: '执行经理' },
  { key: 'builder', label: '施工员' },
  { key: 'developer', label: '客户' },
  { key: 'developer2', label: '客户2' },
  { key: 'contractName', label: '项目合同名称' },
  { key: 'contractor', label: '承包单位' },
  { key: 'region', label: '工程地域' },
  { key: 'riskLevel', label: '项目风险级别' },
  { key: 'address', label: '工程详细地址' },
]

/** 空值统一转空串（null 数值列 → 空，避免导出出现 "null" 文本）。 */
function cell(value: unknown): string | number {
  if (value == null)
    return ''
  return typeof value === 'number' ? value : String(value)
}

/** 把项目集投影为导出行（每个项目一行，键为中文表头）。 */
export function projectLedgerRows(
  projects: readonly ProjectLedgerSource[],
): Record<string, string | number>[] {
  return projects.map(p => Object.fromEntries(
    PROJECT_EXPORT_COLUMNS.map(col => [col.label, cell(p[col.key])]),
  ))
}
