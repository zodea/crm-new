import type { KitTableColumn } from '~/lib/kit/table'
import type {
  MasterDataListKind,
  MasterDataListRow,
} from '~/stores/master-data-read'

export type MasterDataListSort = 'updated-desc' | 'name-asc' | 'name-desc'
export type MasterDataRegistryKind = Exclude<MasterDataListKind, 'target_cost'>
export type MasterDataListFilterField
  = | 'crewName'
    | 'projectName'
    | 'projectNames'
    | 'projectStatus'
    | 'safetyEducationLabel'
    | 'status'
    | 'trade'

export interface MasterDataListFilterDefinition {
  field: MasterDataListFilterField
  label: string
}

export interface MasterDataListProfile {
  columns: KitTableColumn[]
  filters: MasterDataListFilterDefinition[]
  searchPlaceholder: string
}

export interface MasterDataListFilters {
  search: string
  sort: MasterDataListSort
  values: Partial<Record<MasterDataListFilterField, string>>
}

export interface MasterDataFilterOption {
  key: string
  label: string
}

const MASTER_DATA_STATUS_LABELS: Record<string, string> = {
  active: '有效',
  approved: '已通过',
  checked: '已核对',
  draft: '草稿',
  inactive: '停用',
  rejected: '已退回',
  released: '已发放',
  submitted: '已提交',
}

export function masterDataStatusLabel(value: unknown): string {
  const status = String(value ?? '')
  return (MASTER_DATA_STATUS_LABELS[status] ?? status) || '未登记'
}

export const MASTER_DATA_LIST_PROFILES: Record<MasterDataRegistryKind, MasterDataListProfile> = {
  customer: {
    searchPlaceholder: '搜索客户名称、简称、税号或联系人…',
    filters: [{ field: 'status', label: '档案状态' }],
    columns: [
      { field: 'name', title: '客户名称', minWidth: 210, fixed: 'left', slot: 'name' },
      { field: 'aliases', title: '简称', width: 130, slot: 'aliases' },
      { field: 'taxNo', title: '统一社会信用代码', width: 190, slot: 'identifier' },
      { field: 'contact', title: '联系人', width: 110 },
      { field: 'contactPhone', title: '联系电话', width: 130, slot: 'phone' },
      { field: 'status', title: '状态', width: 96, slot: 'status' },
      { title: '操作', width: 120, slot: 'action', align: 'right', resizable: false },
    ],
  },
  crew: {
    searchPlaceholder: '搜索班组名称、工种或负责人…',
    filters: [
      { field: 'trade', label: '工种' },
      { field: 'projectNames', label: '关联项目' },
      { field: 'status', label: '档案状态' },
    ],
    columns: [
      { field: 'name', title: '班组名称', minWidth: 190, fixed: 'left', slot: 'name' },
      { field: 'trade', title: '工种', width: 110 },
      { field: 'contactName', title: '负责人', width: 110 },
      { field: 'contactPhone', title: '联系电话', width: 130, slot: 'phone' },
      { field: 'memberCount', title: '工人数', width: 90, align: 'right' },
      { field: 'activeMemberCount', title: '在场工人', width: 96, align: 'right' },
      { field: 'projectCount', title: '关联项目', width: 96, align: 'right' },
      { field: 'note', title: '备注', minWidth: 160 },
      { field: 'status', title: '状态', width: 96, slot: 'status' },
      { title: '操作', width: 120, slot: 'action', align: 'right', resizable: false },
    ],
  },
  worker: {
    searchPlaceholder: '搜索工人姓名、工种、班组、项目或证件…',
    filters: [
      { field: 'trade', label: '工种' },
      { field: 'crewName', label: '班组' },
      { field: 'projectName', label: '当前项目' },
      { field: 'status', label: '档案状态' },
      { field: 'projectStatus', label: '在场状态' },
      { field: 'safetyEducationLabel', label: '安全教育' },
    ],
    columns: [
      { field: 'name', title: '姓名', minWidth: 130, fixed: 'left', slot: 'name' },
      { field: 'trade', title: '工种', width: 100 },
      { field: 'crewName', title: '所属班组', minWidth: 150 },
      { field: 'projectName', title: '当前项目', minWidth: 180 },
      { field: 'status', title: '档案状态', width: 96, slot: 'status' },
      { field: 'projectStatus', title: '在场状态', width: 100, slot: 'projectStatus' },
      { field: 'phone', title: '联系电话', width: 130, slot: 'phone' },
      { field: 'idCard', title: '身份证号', width: 180, slot: 'workerIdentifier' },
      { field: 'entryDate', title: '进场日期', width: 112 },
      { field: 'exitDate', title: '退场日期', width: 112 },
      { field: 'safetyEducation', title: '安全教育', width: 96, slot: 'safetyEducation' },
      { title: '操作', width: 120, slot: 'action', align: 'right', resizable: false },
    ],
  },
}

export function initialMasterDataFilterValues(
  profile: MasterDataListProfile,
): Partial<Record<MasterDataListFilterField, string>> {
  return Object.fromEntries(profile.filters.map(filter => [filter.field, 'all']))
}

function comparable(value: unknown): string {
  if (Array.isArray(value))
    return value.map(item => comparable(item)).join(' ')
  return value == null ? '' : String(value)
}

function collatorCompare(left: unknown, right: unknown): number {
  return comparable(left).localeCompare(comparable(right), 'zh-CN')
}

export function masterDataFilterOptions(
  rows: readonly MasterDataListRow[],
  field?: MasterDataListFilterField,
): MasterDataFilterOption[] {
  if (!field)
    return []
  return [...new Set(rows.flatMap((row) => {
    const value = row[field]
    return (Array.isArray(value) ? value : [value])
      .map(item => comparable(item).trim())
      .filter(Boolean)
  }))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(value => ({
      key: value,
      label: field === 'status' ? masterDataStatusLabel(value) : value,
    }))
}

export function filterAndSortMasterDataRows(
  rows: readonly MasterDataListRow[],
  profile: MasterDataListProfile,
  filters: MasterDataListFilters,
): MasterDataListRow[] {
  const keyword = filters.search.trim().toLocaleLowerCase('zh-CN')
  const filtered = rows.filter((row) => {
    if (keyword && !Object.values(row).some(value =>
      comparable(value).toLocaleLowerCase('zh-CN').includes(keyword),
    )) {
      return false
    }
    for (const definition of profile.filters) {
      const selected = filters.values[definition.field] ?? 'all'
      if (selected === 'all')
        continue
      const raw = row[definition.field]
      const values = Array.isArray(raw) ? raw.map(item => comparable(item)) : [comparable(raw)]
      if (!values.includes(selected))
        return false
    }
    return true
  })

  return [...filtered].sort((left, right) => {
    if (filters.sort === 'name-asc')
      return collatorCompare(left.name, right.name)
    if (filters.sort === 'name-desc')
      return collatorCompare(right.name, left.name)
    return collatorCompare(right.updatedAt, left.updatedAt)
      || collatorCompare(left.name, right.name)
  })
}
