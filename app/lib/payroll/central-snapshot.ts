import type { PayrollJsonObject, PayrollSnapshot } from './central-contract'

const snapshotFieldLabels: Record<string, string> = {
  month: '工资月份',
  periodKind: '核算期间',
  formatFamily: '工资格式',
  quantitySource: '取数口径',
  sourceVersion: '来源版本',
  projectName: '项目名称',
  leaderName: '负责人姓名',
  payRatio: '发放比例',
  cumulativeAmount: '累计核算金额',
  previouslyPaid: '此前已发金额',
  grossAmount: '核算应发金额',
  actualAmount: '实际发放金额',
  memberWorkerIds: '完整成员身份清单',
  members: '成员及姓名',
  lines: '工资明细',
  allocations: '成员收款分配',
  dayworkRecords: '签工来源记录',
}

export function payrollObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function payrollText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
export function payrollNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
/** 解析只增加诊断，不裁字段、不以当前表行补齐发放证据。 */
export function readPayrollSnapshot(raw: string | null, released: boolean, originalRaw = raw): PayrollSnapshot {
  let data: PayrollJsonObject | null = null
  const issues: string[] = []
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (payrollObject(parsed))
        data = parsed as PayrollJsonObject
      else
        issues.push('发放快照不是完整对象')
    }
    catch { issues.push('发放快照无法解析，原文已保留') }
  }
  if (!released)
    return { state: 'not-released', raw, originalRaw, data, issues }
  if (raw === null || raw === '')
    return { state: 'missing', raw, originalRaw, data, issues: ['未保存发放快照'] }
  if (!data)
    return { state: 'invalid', raw, originalRaw, data, issues }
  for (const key of ['month', 'periodKind', 'formatFamily', 'quantitySource', 'sourceVersion', 'projectName', 'leaderName']) {
    if (typeof data[key] !== 'string')
      issues.push(`发放快照缺少${snapshotFieldLabels[key]}`)
  }
  for (const key of ['payRatio', 'cumulativeAmount', 'previouslyPaid', 'grossAmount', 'actualAmount']) {
    if (payrollNumber(data[key]) === null)
      issues.push(`发放快照缺少${snapshotFieldLabels[key]}`)
  }
  const requiredArrays = ['memberWorkerIds', 'members', 'lines', 'allocations', ...(data.formatFamily === 'C2' ? ['dayworkRecords'] : [])]
  for (const key of requiredArrays) {
    if (!Array.isArray(data[key]))
      issues.push(`发放快照缺少${snapshotFieldLabels[key]}`)
  }
  if (data.allocationRecorded !== true)
    issues.push('历史发放没有明确登记成员分配')
  const members = Array.isArray(data.members) ? data.members.filter((value): value is PayrollJsonObject => payrollObject(value)) : []
  if (Array.isArray(data.members) && members.length !== data.members.length)
    issues.push('发放成员清单包含损坏条目')
  const memberIds = Array.isArray(data.memberWorkerIds) ? data.memberWorkerIds : []
  const ids = new Set(memberIds)
  if (!memberIds.length || memberIds.some(id => typeof id !== 'string' || !id) || ids.size !== memberIds.length || members.length !== memberIds.length || new Set(members.map(member => member.workerId)).size !== members.length || members.some(member => !ids.has(member.workerId as string) || typeof member.workerName !== 'string' || typeof member.isLeader !== 'boolean'))
    issues.push('发放成员身份、姓名或零分配成员清单不完整')
  const allocations = Array.isArray(data.allocations) ? data.allocations.filter((value): value is PayrollJsonObject => payrollObject(value)) : []
  if (Array.isArray(data.allocations) && allocations.length !== data.allocations.length)
    issues.push('发放分配清单包含损坏条目')
  if (data.allocationRecorded === true) {
    if (allocations.length !== memberIds.length || new Set(allocations.map(row => row.workerId)).size !== allocations.length || allocations.some(row => !ids.has(row.workerId as string) || payrollNumber(row.amount) === null || !Number.isSafeInteger(row.allocatedAmountFen) || Number(row.allocatedAmountFen) < 0 || Math.round(Number(row.amount) * 100) !== row.allocatedAmountFen))
      issues.push('发放分配存在缺失、重复成员或金额记录不完整')
    const total = allocations.reduce((sum, row) => sum + (payrollNumber(row.allocatedAmountFen) ?? 0), 0)
    if (payrollNumber(data.actualAmount) !== null && total !== Math.round(Number(data.actualAmount) * 100))
      issues.push('成员分配合计与原实发金额不一致')
  }
  if (data.formatFamily === 'C2' && (!payrollObject(data.subjectConfig) || typeof data.subjectConfig.id !== 'string' || payrollNumber(data.subjectConfig.unitRate) === null || typeof data.subjectConfig.ruleText !== 'string'))
    issues.push('历史发放缺少完整 C2 费率及规则快照')
  if (data.formatFamily === 'C2' && Array.isArray(data.dayworkRecords) && data.dayworkRecords.length === 0 && (payrollNumber(data.actualAmount) ?? 0) > 0)
    issues.push('C2 原实发金额大于零，但未保留对应签工来源')
  if (data.formatFamily === 'C2' && Array.isArray(data.dayworkRecords) && data.dayworkRecords.some(row => !payrollObject(row)
    || ['id', 'workerId', 'workDate', 'workContent', 'startTime', 'endTime', 'witness', 'status'].some(key => typeof row[key] !== 'string')
    || !ids.has(row.workerId as string) || ![0.5, 1].includes(Number(row.laborUnits)) || typeof row.laborUnits !== 'number'
    || row.status !== 'confirmed' || typeof row.confirmedOn !== 'string')) {
    issues.push('发放签工明细存在损坏条目、缺失工数、时间或人工确认记录')
  }
  const lines = Array.isArray(data.lines) ? data.lines : []
  if (lines.some(line => !payrollObject(line) || typeof line.workerId !== 'string' || !ids.has(line.workerId) || typeof line.itemName !== 'string' || typeof line.unit !== 'string' || ['quantity', 'unitPrice', 'amount'].some(key => payrollNumber(line[key]) === null)))
    issues.push('发放明细存在缺损量价、单位或成员身份')
  return { state: issues.length ? 'partial' : 'complete', raw, originalRaw, data, issues }
}
