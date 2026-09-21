import type { PayrollBatchPlanRead } from './central-batch-service-contract'
import type { PayrollDiagnostic, PayrollHistoryEntry } from './central-contract'

import { yuan } from '../util/money'

const statusLabels: Record<string, string> = { draft: '草稿', checked: '已核对', released: '已发放', confirmed: '已确认' }
export const payrollStatusTone = (value: string) => value === 'released' ? 'ok' : value === 'checked' ? 'brand' : 'neutral'
export const dayworkStatusTone = (value: string) => value === 'confirmed' ? 'ok' : value === 'draft' ? 'warn' : 'neutral'
export const dayworkStatusLabel = (value: string) => value === 'confirmed' ? '已确认' : value === 'draft' ? '待确认' : `历史确认状态：${value || '未记录'}`
export const payrollStatusLabel = (value: string) => statusLabels[value] || `历史状态：${value || '未提供'}`
const batchStateLabels: Record<PayrollBatchPlanRead['state'], string> = { 'ready': '待执行', 'prepared': '当前项待核实', 'needs-recheck': '需要重新核对', 'complete': '批次已完成', 'unavailable': '结果不可用' }
export const payrollBatchStateLabel = (value: PayrollBatchPlanRead['state']) => batchStateLabels[value]
export const payrollAmount = (value: number | null) => value === null ? '未记录' : yuan(value)
export const payrollNumber = (value: number | null) => value === null ? '未记录' : String(value)
const snapshotLabels: Record<string, string> = { 'complete': '发放记录完整', 'partial': '发放记录有缺项', 'missing': '未保留发放记录', 'invalid': '发放记录无法解析', 'not-released': '尚未发放' }
export const payrollSnapshotLabel = (state: string) => snapshotLabels[state] || '发放记录待核对'
const tables: Record<string, string> = { wage_statements: '工资单', wage_statement_lines: '工资明细', wage_statement_members: '请款成员', wage_statement_allocations: '收款分配', payroll_subject_configs: '工资配置', attendance_records: '考勤', signed_daywork_records: '签工', wage_statement_daywork_records: '工资与签工关系' }
export function payrollDiagnosticLocation(issue: PayrollDiagnostic): string {
  return issue.tableName ? tables[issue.tableName] || '历史来源' : '工资资料'
}
const historyFields: Record<string, string> = { status: '状态', month: '月份', format_family: '格式', period_kind: '期间', purpose: '用途', quantity_source: '数量口径', pay_ratio: '比例', gross_amount: '核算应发', actual_amount: '实际发放', previously_paid: '此前已发', cumulative_amount: '累计核算', worker_name: '工人姓名', item_name: '分项名称', quantity: '数量', unit_price: '单价', amount: '金额', unit_rate: '工资费率', rule_text: '确认规则', work_date: '日期', hours: '正常工时', overtime_hours: '加班工时', work_content: '工作内容', witness: '证明人', confirmed_on: '确认日期', labor_units: '工数', note: '备注', deleted_at: '删除时间' }
export function payrollHistoryPresentation(entry: PayrollHistoryEntry) {
  const before = entry.beforeData && typeof entry.beforeData === 'object' && !Array.isArray(entry.beforeData) ? entry.beforeData : {}
  const after = entry.afterData && typeof entry.afterData === 'object' && !Array.isArray(entry.afterData) ? entry.afterData : {}
  const changes = Object.entries(historyFields).filter(([key]) => (key in before || key in after) && JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(([key, label]) => ({ label, before: before[key] == null ? '未记录' : key === 'status' ? payrollStatusLabel(String(before[key])) : String(before[key]), after: after[key] == null ? '未记录' : key === 'status' ? payrollStatusLabel(String(after[key])) : String(after[key]) }))
  const actions: Record<string, string> = { insert: '新增', create: '新增', update: '保存', delete: '删除', restore: '恢复' }
  return { id: entry.id, subject: tables[entry.tableName] || '历史记录', action: actions[entry.operation] || '变更', operator: entry.operator || '经办人未记录', time: entry.operatedAt || '时间未记录', changes }
}
