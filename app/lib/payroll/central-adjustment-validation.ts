import type { PayrollAAdjustmentBasis, PayrollAdjustmentBasisDraft, PayrollAdjustmentDraft, PayrollAdjustmentTarget, PayrollC1AdjustmentBasis, PayrollC2AdjustmentBasis, PayrollCorrectionCommand } from './central-adjustment-contract'
import { isPayrollAStatementSourceSnapshot } from './central-a-codec'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { wireCent, wireDate, wireExact, wireId, wireNullableNumber, wireObject, wireText } from './central-payroll-wire'

function fail(message: string): never {
  throw payrollProblem('validation-failed', message)
}
export function assertPayrollAdjustmentTarget(value: unknown): asserts value is PayrollAdjustmentTarget {
  if (!wireObject(value))
    fail('更正需要固定的原工资或草稿身份')
  wireExact(value, value.adjustmentId === null ? ['adjustmentId', 'draftKey', 'originalStatementId'] : ['adjustmentId'])
  if (value.adjustmentId === null ? !wireId(value.draftKey) || !wireId(value.originalStatementId) : !wireId(value.adjustmentId))
    fail('更正的原工资或草稿身份无效')
}
export function assertPayrollAdjustmentDraft(value: unknown): asserts value is PayrollAdjustmentDraft {
  wireExact(value, ['reason', 'evidenceNote', 'correctsAdjustmentId', 'basis'])
  if (!wireText(value.reason) || !wireText(value.evidenceNote) || !(value.correctsAdjustmentId === null || wireId(value.correctsAdjustmentId)))
    fail('更正原因、核对依据或前序更正无效')
  if (value.basis === null)
    return
  if (wireObject(value.basis) && value.basis.formatFamily === 'A') {
    wireExact(value.basis, ['formatFamily', 'periodKind', 'source', 'payRatio', 'components'])
    if (!isPayrollAStatementSourceSnapshot(value.basis.source) || !['monthly', 'settlement', 'retention'].includes(String(value.basis.periodKind)) || !wireNullableNumber(value.basis.payRatio) || !Array.isArray(value.basis.components))
      fail('A 更正须保留原完整施工责任、价格来源和发放档位')
    for (const component of value.basis.components) {
      wireExact(component, ['ownershipKey', 'priceRevisionId', 'quantity', 'unitPrice'])
      if (!wireText(component.ownershipKey) || !component.ownershipKey || !wireId(component.priceRevisionId) || !wireNullableNumber(component.quantity) || !wireNullableNumber(component.unitPrice))
        fail('A 更正须逐责任指向原量、价依据')
    }
    return
  }
  if (wireObject(value.basis) && value.basis.formatFamily === 'C1') {
    wireExact(value.basis, ['formatFamily', 'rates', 'records'])
    if (!Array.isArray(value.basis.rates) || !Array.isArray(value.basis.records))
      fail('C1 更正须保留逐人标准与逐日考勤集合')
    for (const row of value.basis.rates) {
      wireExact(row, ['workerId', 'configId', 'dailyWage', 'overtimeRate', 'overtimeRule'])
      if (!wireId(row.workerId) || !(row.configId === null || wireId(row.configId)) || !wireNullableNumber(row.dailyWage) || !wireNullableNumber(row.overtimeRate) || !['daily-divided-eight', 'explicit'].includes(String(row.overtimeRule)))
        fail('C1 个人更正标准字段无效')
    }
    for (const row of value.basis.records) {
      wireExact(row, ['recordId', 'workerId', 'workDate', 'hours', 'overtimeHours', 'workContent'])
      if (!wireId(row.recordId) || !wireId(row.workerId) || !wireDate(row.workDate) || !wireNullableNumber(row.hours) || !wireNullableNumber(row.overtimeHours) || !wireText(row.workContent))
        fail('C1 更正考勤字段无效')
    }
    return
  }
  wireExact(value.basis, ['formatFamily', 'configId', 'unitRate', 'records'])
  const basis = value.basis
  if (basis.formatFamily !== 'C2' || !wireId(basis.configId) || !wireNullableNumber(basis.unitRate) || !Array.isArray(basis.records))
    fail('更正必须保留原 C2 主体配置及逐条签工身份')
  for (const record of basis.records) {
    wireExact(record, ['recordId', 'workerId', 'workDate', 'laborUnits', 'startTime', 'endTime', 'workContent', 'witness', 'confirmedOn'])
    if (!wireId(record.recordId) || !wireId(record.workerId) || !wireDate(record.workDate) || !wireNullableNumber(record.laborUnits) || !['startTime', 'endTime', 'workContent', 'witness', 'confirmedOn'].every(k => wireText(record[k])))
      fail('独立更正的签工记录字段不完整')
  }
}
export function assertPayrollAdjustmentCommand(value: unknown): asserts value is PayrollCorrectionCommand {
  wireExact(value, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'target', 'action'])
  if (!['commandId', 'workspaceId', 'actorId', 'projectId'].every(k => wireId(value[k])) || !wireText(value.sourceVersion) || !value.sourceVersion || !['real', 'demo'].includes(String(value.origin)) || value.requiredCapability !== 'payroll:write')
    fail('工资更正的提交身份不完整')
  assertPayrollAdjustmentTarget(value.target)
  if (!wireObject(value.action))
    fail('工资更正动作无效')
  wireExact(value.action, value.action.kind === 'save-adjustment-draft' ? ['kind', 'draft'] : ['kind'])
  if (value.action.kind === 'save-adjustment-draft')
    assertPayrollAdjustmentDraft(value.action.draft)
  else if (value.action.kind !== 'confirm-adjustment' || value.target.adjustmentId === null)
    fail('请先保存独立更正草稿，再明确确认')
}
export function payrollC2CorrectionReasons(basis: PayrollC2AdjustmentBasis, original: PayrollC2AdjustmentBasis): string[] {
  const reasons: string[] = []
  if (basis.configId !== original.configId || basis.records.length !== original.records.length || new Set(basis.records.map(r => r.recordId)).size !== original.records.length)
    reasons.push('更正须保留原主体配置与完整原签工集合')
  if (basis.unitRate === null || basis.unitRate <= 0)
    reasons.push('C2 更正仍须使用明确正数的主体单价')
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  for (const row of basis.records) {
    const old = original.records.find(r => r.recordId === row.recordId)
    if (!old || old.workerId !== row.workerId || old.workDate !== row.workDate)
      reasons.push('不能借更正转移原签工人员、日期或来源身份')
    if (![0.5, 1].includes(row.laborUnits ?? 0) || !time.test(row.startTime) || !time.test(row.endTime) || row.startTime >= row.endTime || !row.workContent.trim() || !row.witness.trim() || !wireDate(row.confirmedOn) || row.confirmedOn < row.workDate)
      reasons.push('更正后的整工或半工、时段、工作内容与人工确认依据须完整合法')
    const day = basis.records.filter(r => r.workerId === row.workerId && r.workDate === row.workDate)
    if (day.reduce((sum, r) => sum + (r.laborUnits ?? 0), 0) > 1 || day.some(r => r.recordId !== row.recordId && r.startTime < row.endTime && r.endTime > row.startTime))
      reasons.push('更正后同一工人每日工数不能超过一工或时段重叠')
  }
  return [...new Set(reasons)]
}
function payrollC1CorrectionReasons(basis: PayrollC1AdjustmentBasis, original: PayrollC1AdjustmentBasis): string[] {
  const reasons: string[] = []
  if (basis.records.length !== original.records.length || new Set(basis.records.map(r => r.recordId)).size !== original.records.length || basis.rates.length !== original.rates.length || new Set(basis.rates.map(r => r.workerId)).size !== original.rates.length)
    reasons.push('C1 更正须保留原考勤和完整成员标准集合')
  for (const rate of basis.rates) {
    const old = original.rates.find(r => r.workerId === rate.workerId)
    if (!old || old.configId !== rate.configId)
      reasons.push('C1 不能借更正换用另一成员或工资标准身份')
    if (rate.dailyWage === null || rate.dailyWage < 0 || (rate.overtimeRule === 'explicit' ? rate.overtimeRate === null || rate.overtimeRate < 0 : rate.overtimeRate !== null))
      reasons.push('请明确 C1 非负日薪和加班标准，按日薪八分之一时保留该规则')
  }
  for (const row of basis.records) {
    const old = original.records.find(r => r.recordId === row.recordId)
    if (!old || old.workerId !== row.workerId || old.workDate !== row.workDate)
      reasons.push('C1 更正不能移动原考勤身份、人员或日期')
    if (row.hours === null || row.overtimeHours === null || row.hours < 0 || row.hours > 8 || row.overtimeHours < 0 || row.hours + row.overtimeHours > 24)
      reasons.push('C1 更正须明确合法工时，正常工时至多8小时且每日合计不超过24小时')
  }
  return [...new Set(reasons)]
}
function payrollACorrectionReasons(basis: PayrollAAdjustmentBasis, original: PayrollAAdjustmentBasis): string[] {
  const reasons: string[] = []
  if (basis.periodKind !== original.periodKind || payrollCanonical(basis.source) !== payrollCanonical(original.source))
    reasons.push('A 更正须保留原冻结施工责任及量价沿革，独立核对不能冒充修改原源表')
  if (basis.components.length !== original.components.length || new Set(basis.components.map(c => c.ownershipKey)).size !== original.components.length)
    reasons.push('A 更正须保留完整且不重复的原责任组件集合')
  for (const component of basis.components) {
    const old = original.components.find(c => c.ownershipKey === component.ownershipKey)
    if (!old || old.priceRevisionId !== component.priceRevisionId)
      reasons.push('A 更正不能转移原施工范围或冒用其他价格修订')
    if (component.quantity === null || component.quantity < 0 || component.unitPrice === null || !wireCent(component.unitPrice))
      reasons.push('A 更正须明确非负现场量及到分单价')
  }
  if (basis.payRatio === null || basis.payRatio < 0 || basis.payRatio > 1 || (basis.periodKind === 'retention' && basis.payRatio !== 1))
    reasons.push('A 更正比例须在0至1之间，尾款档位固定为1')
  return [...new Set(reasons)]
}
export function payrollCorrectionReasons(basis: PayrollAdjustmentBasisDraft, original: PayrollAdjustmentBasisDraft): string[] {
  if (basis.formatFamily === 'A' && original.formatFamily === 'A')
    return payrollACorrectionReasons(basis, original)
  if (basis.formatFamily === 'C1' && original.formatFamily === 'C1')
    return payrollC1CorrectionReasons(basis, original)
  if (basis.formatFamily === 'C2' && original.formatFamily === 'C2')
    return payrollC2CorrectionReasons(basis, original)
  return ['独立更正不能改变原工资格式']
}
