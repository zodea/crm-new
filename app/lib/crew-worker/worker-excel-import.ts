import type { ImportTemplateField } from '../kit/import-mapping'
import type { WorkerExcelDraft } from './worker-excel-contract'
import { isISODateDTO } from '../../types/read-model'

export const WORKER_EXCEL_FIELDS: readonly ImportTemplateField[] = [
  { key: 'name', label: '姓名', required: true },
  { key: 'gender', label: '性别' },
  { key: 'idCard', label: '身份证号' },
  { key: 'phone', label: '联系电话' },
  { key: 'hometown', label: '籍贯' },
  { key: 'emergencyContact', label: '紧急联系人' },
  { key: 'emergencyPhone', label: '紧急联系电话' },
  { key: 'bankName', label: '开户银行' },
  { key: 'bankAccount', label: '银行卡号' },
  { key: 'bankCode', label: '银行行号' },
  { key: 'trade', label: '工种' },
  { key: 'capabilityTrades', label: '可承接工种' },
  { key: 'capabilityItems', label: '可承接工程量分项' },
  { key: 'skillLevel', label: '技能等级' },
  { key: 'dailyWage', label: '参考日工资' },
  { key: 'crewName', label: '所属班组' },
  { key: 'projectName', label: '当前项目' },
  { key: 'projectStatus', label: '在场状态' },
  { key: 'entryDate', label: '进场日期' },
  { key: 'exitDate', label: '退场日期' },
  { key: 'safetyEducation', label: '安全教育' },
  { key: 'note', label: '备注' },
]
export function normalizeWorkerExcelRow(row: Record<string, unknown>): WorkerExcelDraft {
  const draft: Record<string, unknown> = {}
  for (const { key } of WORKER_EXCEL_FIELDS) {
    if (!Object.hasOwn(row, key))
      continue
    const value = String(row[key] ?? '').trim()
    if (!value)
      continue
    if (key === 'dailyWage') {
      const number = Number(value)
      if (!Number.isFinite(number) || number < 0)
        throw new Error('参考日工资须为非负数')
      draft[key] = number
    }
    else if (key === 'safetyEducation') {
      if (!['是', '否', 'true', 'false', '1', '0'].includes(value.toLowerCase()))
        throw new Error('安全教育须填写是或否')
      draft[key] = ['是', 'true', '1'].includes(value.toLowerCase())
    }
    else if (key === 'capabilityTrades' || key === 'capabilityItems') {
      draft[key] = value.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean)
    }
    else if (key === 'entryDate' || key === 'exitDate') {
      if (!isISODateDTO(value))
        throw new Error('进退场日期须为 YYYY-MM-DD')
      draft[key] = value
    }
    else { draft[key] = value }
  }
  if (!draft.name)
    throw new Error('工人姓名必填')
  return draft as WorkerExcelDraft
}
export function workerExcelDuplicates(rows: readonly { index: number, draft: WorkerExcelDraft }[]): Map<number, number[]> {
  const groups = new Map<string, Set<number>>()
  for (const { index, draft } of rows) {
    for (const [key, value] of [['name', draft.name], ['idCard', draft.idCard], ['phone', draft.phone]] as const) {
      const normalized = String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
      if (normalized) {
        const group = groups.get(`${key}:${normalized}`) ?? new Set<number>()
        group.add(index)
        groups.set(`${key}:${normalized}`, group)
      }
    }
  }
  const duplicates = new Map<number, Set<number>>()
  for (const group of groups.values()) {
    if (group.size > 1) {
      for (const index of group) {
        const others = duplicates.get(index) ?? new Set<number>()
        for (const other of group) {
          if (other !== index)
            others.add(other)
        }
        duplicates.set(index, others)
      }
    }
  }
  return new Map([...duplicates].map(([index, values]) => [index, [...values]]))
}
