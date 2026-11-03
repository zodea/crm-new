import type { ImportTemplateField } from '../kit/import-mapping'
import type { CrewExcelDraft } from './excel-import-contract'

export const CREW_EXCEL_FIELDS: readonly ImportTemplateField[] = [
  { key: 'name', label: '班组名称', required: true },
  { key: 'trade', label: '工种' },
  { key: 'contactName', label: '负责人' },
  { key: 'contactPhone', label: '联系电话' },
  { key: 'defaultPayRatio', label: '默认工资比例', aliases: ['发放比例'] },
  { key: 'rentSubsidyEnabled', label: '启用房租补贴' },
  { key: 'rentSubsidyPrice', label: '房租补贴单价' },
  { key: 'mgmtFeeEnabled', label: '启用管理提成' },
  { key: 'mgmtFeePrice', label: '管理提成单价' },
  { key: 'assignmentLevel', label: '分配层级' },
  { key: 'capabilityTrades', label: '可承接工种' },
  { key: 'capabilityItems', label: '可承接工程量分项' },
  { key: 'note', label: '备注' },
]

/** 仅转换映射列；空开关表示未提供，不把未知解释为否。 */
export function normalizeCrewExcelRow(row: Record<string, unknown>): CrewExcelDraft {
  const draft: Record<string, unknown> = {}
  for (const { key } of CREW_EXCEL_FIELDS) {
    if (!Object.hasOwn(row, key))
      continue
    const raw = row[key]
    const value = String(raw ?? '').trim()
    if (['defaultPayRatio', 'rentSubsidyPrice', 'mgmtFeePrice'].includes(key)) {
      if (!value) {
        draft[key] = null
        continue
      }
      const percent = key === 'defaultPayRatio' && value.endsWith('%')
      const number = Number(percent ? value.slice(0, -1).trim() : value)
      const normalized = percent ? number / 100 : number
      if (!Number.isFinite(normalized) || normalized < 0 || (key === 'defaultPayRatio' && normalized > 1))
        throw new Error(`${key === 'defaultPayRatio' ? '默认工资比例须在 0–1 或 0%–100%' : '补贴或提成单价须为非负数'}`)
      draft[key] = normalized
    }
    else if (['rentSubsidyEnabled', 'mgmtFeeEnabled'].includes(key)) {
      if (!value)
        continue
      if (!['是', '否', 'true', 'false', '1', '0'].includes(value.toLowerCase()))
        throw new Error('补贴和提成开关须填写是或否')
      draft[key] = ['是', 'true', '1'].includes(value.toLowerCase())
    }
    else if (key === 'capabilityTrades' || key === 'capabilityItems') {
      draft[key] = value.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean)
    }
    else if (key === 'assignmentLevel') {
      if (!value)
        continue
      if (!['班组', '工人', 'crew', 'worker'].includes(value))
        throw new Error('分配层级须填写班组或工人')
      draft[key] = value === '班组' ? 'crew' : value === '工人' ? 'worker' : value
    }
    else { draft[key] = value }
  }
  if (!draft.name)
    throw new Error('班组名称必填')
  return draft as CrewExcelDraft
}

export function crewExcelDuplicates(rows: readonly { index: number, draft: CrewExcelDraft }[]): Map<number, number[]> {
  const groups = new Map<string, number[]>()
  for (const { index, draft } of rows) {
    const name = String(draft.name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
    if (name)
      groups.set(name, [...groups.get(name) ?? [], index])
  }
  const duplicates = new Map<number, number[]>()
  for (const group of groups.values()) {
    if (group.length > 1) {
      for (const index of group) duplicates.set(index, group.filter(other => other !== index))
    }
  }
  return duplicates
}
