import type { TargetCostHistoryEntry } from './central-contract'
import { yuan } from '../util/money'

const subjects: Record<string, string> = { target_costs: '版本头', target_cost_items: '科目明细', file_refs: '预算附件' }
const actions: Record<string, string> = { insert: '新增', create: '新增', update: '保存', delete: '删除', soft_delete: '删除', restore: '恢复' }
const fields = [
  ['name', '版本名称'],
  ['status', '版本状态'],
  ['is_baseline', '基线标记'],
  ['cost_category', '成本科目'],
  ['item_name', '分项名称'],
  ['unit', '单位'],
  ['qty', '数量'],
  ['unit_price', '单价', 'money'],
  ['amount', '目标金额', 'money'],
  ['contract_revenue', '合同收入', 'money'],
  ['planned_profit', '计划利润', 'money'],
  ['signed_contract_sum', '已签合同额（录入值）', 'money'],
  ['tax_inclusive_total', '含税合价', 'money'],
  ['tax_exclusive_total', '无税合价', 'money'],
  ['tax_amount', '税额', 'money'],
  ['file_name', '文件名称'],
  ['category', '附件分类'],
  ['sort_order', '显示顺序'],
  ['note', '备注'],
] as const

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value))
    }
    catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function display(value: unknown, key: string, money: boolean): string {
  if (value == null || value === '')
    return '未填写'
  if (key === 'is_baseline')
    return value === 1 || value === true ? '是' : value === 0 || value === false ? '否' : '旧记录未提供可识别的标记'
  if (key === 'status')
    return value === 'draft' ? '草稿' : value === 'submitted' ? '已提交' : '旧记录未提供可识别的状态'
  if (money && typeof value === 'number')
    return yuan(value)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '旧记录未提供可识别的值'
}

/** 仅呈现预算中可核对的业务变化；未知历史字段不伪装成当前值。 */
export function presentTargetCostHistory(entry: TargetCostHistoryEntry) {
  const before = record(entry.beforeData)
  const after = record(entry.afterData)
  const changes: { label: string, before: string, after: string }[] = []
  for (const field of fields) {
    const [key, label] = field
    if (!(before && key in before) && !(after && key in after))
      continue
    if (before && after && JSON.stringify(before[key]) === JSON.stringify(after[key]))
      continue
    const money = field.length === 3
    changes.push({ label, before: before ? display(before[key], key, money) : '无原记录', after: after ? display(after[key], key, money) : '无后续记录' })
  }
  if (before && after && before.project_id !== after.project_id && ('project_id' in before || 'project_id' in after))
    changes.push({ label: '关联项目', before: before.project_id == null ? '未关联项目' : '原项目（历史未提供名称）', after: after.project_id == null ? '未关联项目' : '已关联项目（历史未提供名称）' })
  return {
    id: entry.id,
    subject: subjects[entry.tableName] ?? '预算历史记录',
    action: before?.deleted_at && after && after.deleted_at == null ? '恢复' : after?.deleted_at ? '删除' : actions[entry.operation] ?? '历史变更',
    time: entry.operatedAt || '操作时间未提供',
    operator: entry.operator || '经办身份未提供',
    changes,
    missingDetail: changes.length === 0 ? '这条历史未保留可识别的业务字段变化。' : null,
  }
}
