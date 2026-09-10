import type { C2SubjectConfig, SignedDayworkRecord } from './daywork'
import type { WageQuantitySource } from '~/lib/quantity/wage-source'
import { generateId } from '~/lib/util/id'
import {
  listC2SubjectConfigs,
  listStatementDayworkRecords,
} from './daywork'

export interface PayrollDb {
  execute: (sql: string, params?: unknown[]) => Promise<void>
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

export type WageStatementStatus = 'draft' | 'checked' | 'released'
export type WageStatementPurpose = 'advance' | 'final'
export type WageFormatFamily = 'A' | 'B' | 'C1' | 'C2'
export type WagePeriodKind = 'monthly' | 'settlement' | 'retention'
export type WageReleaseResult = 'released' | 'needs_recheck'

export interface C2SubjectConfigSnapshot {
  id: string
  unitRate: number
  ruleText: string
}

export interface WageSourceAudit {
  sourceVersion: string
  sourceUpdatedAt: string | null
  sourceRecordIds?: readonly string[]
  subjectConfig?: C2SubjectConfigSnapshot
}

export interface WageStatementLineInput {
  workerId: string
  itemId?: string | null
  itemName: string
  unit: string
  quantity: number
  unitPrice: number
}

export interface WageStatementDraftInput {
  projectId: string
  crewId?: string | null
  leaderWorkerId: string
  month: string
  purpose: WageStatementPurpose
  periodKind?: WagePeriodKind
  formatFamily?: WageFormatFamily
  quantitySource: WageQuantitySource
  payRatio: number
  lines: readonly WageStatementLineInput[]
  memberWorkerIds?: readonly string[]
  subjectConfigId?: string | null
  sourceVersion?: string
  sourceUpdatedAt?: string | null
  adjustmentReason?: string
  operatorName?: string
  note?: string
  sourceRecordIds?: readonly string[]
}

export interface WageStatementLine extends WageStatementLineInput {
  id: string
  amount: number
}

export interface WageStatementMember {
  workerId: string
  workerName: string
  isLeader: boolean
}

export interface WageAllocationInput {
  workerId: string
  amount: number
}

export interface WageStatementAllocation extends WageAllocationInput {
  workerName: string
  isLeader: boolean
  allocatedAmountFen: number
}

export interface WageStatement {
  id: string
  projectId: string
  projectName: string
  crewId: string | null
  crewName: string
  leaderWorkerId: string
  leaderName: string
  subjectConfigId: string | null
  month: string
  purpose: WageStatementPurpose
  periodKind: WagePeriodKind
  formatFamily: WageFormatFamily
  quantitySource: WageQuantitySource
  status: WageStatementStatus
  needsRecheck: boolean
  payRatio: number
  cumulativeAmount: number
  previouslyPaid: number
  grossAmount: number
  actualAmount: number | null
  sourceVersion: string
  sourceUpdatedAt: string | null
  checkedSourceVersion: string
  adjustmentReason: string
  operatorName: string
  submittedAt: string | null
  checkedAt: string | null
  releasedAt: string | null
  note: string
  members: WageStatementMember[]
  memberWorkerIds: string[]
  allocationRecorded: boolean
  allocations: WageStatementAllocation[]
  lines: WageStatementLine[]
  dayworkRecords: SignedDayworkRecord[]
}

export interface WageStatementFilter {
  projectId?: string
  month?: string
  status?: WageStatementStatus | '' | WageStatementStatus[]
  crewId?: string
}

export interface PayrollOption {
  id: string
  name: string
  code?: string
  crewId?: string | null
}

export interface PayrollWorkbenchOptions {
  projects: PayrollOption[]
  crews: PayrollOption[]
  workers: PayrollOption[]
  c2SubjectConfigs: C2SubjectConfig[]
}

interface StatementRow {
  id: string
  project_id: string
  project_name: string
  crew_id: string | null
  crew_name: string | null
  leader_worker_id: string
  leader_name: string
  subject_config_id: string | null
  month: string
  format_family: WageFormatFamily
  period_kind: WagePeriodKind
  purpose: WageStatementPurpose
  quantity_source: WageQuantitySource
  status: WageStatementStatus
  needs_recheck: number
  pay_ratio: number
  cumulative_amount: number
  previously_paid: number
  gross_amount: number
  actual_amount: number | null
  source_version: string
  source_updated_at: string | null
  checked_source_version: string
  adjustment_reason: string
  operator_name: string
  submitted_at: string | null
  checked_at: string | null
  released_at: string | null
  note: string
  snapshot_json: string | null
}

interface LineRow {
  id: string
  worker_id: string
  item_id: string | null
  item_name: string
  unit: string
  quantity: number
  unit_price: number
  amount: number
}

function assertMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month))
    throw new Error('月份格式应为 YYYY-MM')
}

function assertSource(source: unknown): asserts source is WageQuantitySource {
  if (source !== 'provisional' && source !== 'field')
    throw new Error('工资取数只允许暂估量或现场复核量')
}

function assertLines(lines: readonly WageStatementLineInput[]) {
  for (const line of lines) {
    if (!line.workerId || !line.itemName.trim())
      throw new Error('工资明细必须选择工人并填写分项')
    if (!Number.isFinite(line.quantity) || line.quantity < 0)
      throw new Error('工程量不能为负数')
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0)
      throw new Error('工资单价不能为负数')
  }
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function amountInCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100)
}

function cumulativeTotal(lines: readonly WageStatementLineInput[], payRatio: number): number {
  return rounded(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * payRatio)
}

function payableTotal(cumulativeAmount: number, previouslyPaid: number): number {
  return rounded(Math.max(0, cumulativeAmount - previouslyPaid))
}

function stableSourceVersion(
  lines: readonly WageStatementLineInput[],
  sourceUpdatedAt: string | null = null,
  includeUnitPrice = false,
  salt = '',
): string {
  const value = `${sourceUpdatedAt ?? ''}\n${salt}\n${lines
    .map(line => [
      line.workerId,
      line.itemId ?? '',
      line.itemName.trim(),
      line.unit.trim(),
      line.quantity,
      includeUnitPrice ? line.unitPrice : '',
    ].join('|'))
    .sort()
    .join('\n')}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `wage-src-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

async function releasedTotal(
  db: PayrollDb,
  input: Pick<WageStatementDraftInput, 'projectId' | 'leaderWorkerId'>
    & { formatFamily: WageFormatFamily, excludeStatementId?: string },
): Promise<number> {
  const params: unknown[] = [input.projectId, input.leaderWorkerId, input.formatFamily]
  const exclude = input.excludeStatementId
    ? 'AND id <> ?'
    : ''
  if (input.excludeStatementId)
    params.push(input.excludeStatementId)
  const [row] = await db.select<{ amount: number | null }>(`
    SELECT SUM(actual_amount) AS amount
    FROM wage_statements
    WHERE project_id = ?
      AND leader_worker_id = ?
      AND format_family = ?
      AND status = 'released'
      AND deleted_at IS NULL
      ${exclude}
  `, params)
  return rounded(Number(row?.amount ?? 0))
}

async function validateWageParticipants(
  db: PayrollDb,
  input: Pick<WageStatementDraftInput, 'projectId' | 'crewId' | 'leaderWorkerId' | 'memberWorkerIds'>,
): Promise<void> {
  const [project] = await db.select<{ id: string }>(`
    SELECT id FROM projects
    WHERE id = ? AND deleted_at IS NULL
  `, [input.projectId])
  if (!project)
    throw new Error('项目不存在或已停用')

  if (input.crewId) {
    const [crew] = await db.select<{ id: string }>(`
      SELECT id FROM crews
      WHERE id = ? AND deleted_at IS NULL
    `, [input.crewId])
    if (!crew)
      throw new Error('责任班组不存在或已停用')
  }

  const workerIds = [...new Set([
    input.leaderWorkerId,
    ...(input.memberWorkerIds ?? []),
  ].filter(Boolean))]
  if (!workerIds.length)
    throw new Error('必须选择请款负责人')
  const placeholders = workerIds.map(() => '?').join(', ')
  const workers = await db.select<{
    id: string
    crew_id: string | null
    current_project_id: string | null
    has_project_responsibility: number
  }>(`
    SELECT w.id, w.crew_id, w.current_project_id,
           CASE WHEN EXISTS (
             SELECT 1
             FROM unit_assignments ua
             JOIN units u ON u.id = ua.unit_id AND u.deleted_at IS NULL
             JOIN floors f ON f.id = u.floor_id AND f.deleted_at IS NULL
             JOIN buildings b ON b.id = f.building_id AND b.deleted_at IS NULL
             WHERE ua.deleted_at IS NULL
               AND b.project_id = ?
               AND (ua.worker_id = w.id OR (w.crew_id IS NOT NULL AND ua.crew_id = w.crew_id))
           ) THEN 1 ELSE 0 END AS has_project_responsibility
    FROM workers w
    WHERE w.id IN (${placeholders})
      AND w.deleted_at IS NULL
  `, [input.projectId, ...workerIds])
  if (workers.length !== workerIds.length)
    throw new Error('请款负责人或成员不存在或已停用')

  const leader = workers.find(worker => worker.id === input.leaderWorkerId)
  if (!leader)
    throw new Error('请款负责人不存在或已停用')
  for (const worker of workers) {
    if (
      worker.current_project_id !== input.projectId
      && !worker.has_project_responsibility
    ) {
      throw new Error('请款负责人或成员不属于当前项目')
    }
    const expectedCrewId = input.crewId ?? leader.crew_id
    if (worker.crew_id !== expectedCrewId)
      throw new Error('请款负责人、成员与责任班组归属不一致')
  }
}

async function replaceMembers(
  db: PayrollDb,
  statementId: string,
  leaderWorkerId: string,
  memberWorkerIds: readonly string[],
): Promise<void> {
  const workerIds = [...new Set([leaderWorkerId, ...memberWorkerIds].filter(Boolean))]
  await db.execute(
    `UPDATE wage_statement_members
     SET deleted_at = datetime('now')
     WHERE statement_id = ? AND deleted_at IS NULL`,
    [statementId],
  )
  for (const workerId of workerIds) {
    await db.execute(`
      INSERT INTO wage_statement_members (id, statement_id, worker_id, is_leader)
      VALUES (?, ?, ?, ?)
    `, [
      generateId('wage_member'),
      statementId,
      workerId,
      workerId === leaderWorkerId ? 1 : 0,
    ])
  }
}

async function replaceLines(
  db: PayrollDb,
  statementId: string,
  lines: readonly WageStatementLineInput[],
) {
  await db.execute('UPDATE wage_statement_lines SET deleted_at = datetime(\'now\') WHERE statement_id = ? AND deleted_at IS NULL', [statementId])
  for (const [index, line] of lines.entries()) {
    await db.execute(`
      INSERT INTO wage_statement_lines (
        id, statement_id, worker_id, item_id, item_name, unit,
        quantity, unit_price, amount, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      generateId('wage_line'),
      statementId,
      line.workerId,
      line.itemId ?? null,
      line.itemName.trim(),
      line.unit.trim(),
      line.quantity,
      line.unitPrice,
      rounded(line.quantity * line.unitPrice),
      index,
    ])
  }
}

async function replaceDayworkLinks(
  db: PayrollDb,
  statementId: string,
  dayworkRecordIds: readonly string[],
): Promise<void> {
  const recordIds = [...new Set(dayworkRecordIds)]
  if (recordIds.length) {
    const placeholders = recordIds.map(() => '?').join(', ')
    const [occupied] = await db.select<{
      daywork_record_id: string
      statement_id: string
    }>(`
      SELECT link.daywork_record_id, link.statement_id
      FROM wage_statement_daywork_records link
      JOIN wage_statements statement
        ON statement.id = link.statement_id
       AND statement.deleted_at IS NULL
      WHERE link.daywork_record_id IN (${placeholders})
        AND link.statement_id <> ?
        AND link.deleted_at IS NULL
      LIMIT 1
    `, [...recordIds, statementId])
    if (occupied)
      throw new Error('存在已归属其他工资单的签工记录，不能重复计薪')
  }
  await db.execute(`
    UPDATE wage_statement_daywork_records
    SET deleted_at = datetime('now')
    WHERE statement_id = ? AND deleted_at IS NULL
  `, [statementId])
  for (const dayworkRecordId of recordIds) {
    await db.execute(`
      INSERT INTO wage_statement_daywork_records (
        id, statement_id, daywork_record_id
      ) VALUES (?, ?, ?)
    `, [generateId('wage_daywork'), statementId, dayworkRecordId])
  }
}

async function replaceAllocations(
  db: PayrollDb,
  statementId: string,
  allocations: readonly WageStatementAllocation[],
): Promise<void> {
  await db.execute(`
    UPDATE wage_statement_allocations
    SET deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE statement_id = ? AND deleted_at IS NULL
  `, [statementId])
  for (const allocation of allocations) {
    await db.execute(`
      INSERT INTO wage_statement_allocations (
        id, statement_id, worker_id, allocated_amount_fen
      ) VALUES (?, ?, ?, ?)
    `, [
      generateId('wage_allocation'),
      statementId,
      allocation.workerId,
      allocation.allocatedAmountFen,
    ])
  }
}

function normalizeAllocations(
  statement: WageStatement,
  actualAmount: number,
  allocations: readonly WageAllocationInput[],
): WageStatementAllocation[] {
  const requested = allocations.length
    ? allocations
    : statement.members.map(member => ({
        workerId: member.workerId,
        amount: member.isLeader ? actualAmount : 0,
      }))
  const members = new Map(statement.members.map(member => [member.workerId, member]))
  const seen = new Set<string>()
  const amounts = new Map<string, number>()
  for (const allocation of requested) {
    const member = members.get(allocation.workerId)
    if (!member)
      throw new Error('实际发放金额只能分配给当前请款簿成员')
    if (seen.has(allocation.workerId))
      throw new Error('同一成员不能重复分配实际发放金额')
    seen.add(allocation.workerId)
    if (!Number.isFinite(allocation.amount) || allocation.amount < 0)
      throw new Error('成员分配金额必须是大于或等于 0 的有效数字')
    const cents = allocation.amount * 100
    if (Math.abs(cents - Math.round(cents)) > 1e-8)
      throw new Error('成员分配金额必须精确到分')
    amounts.set(allocation.workerId, Math.round(cents))
  }
  if (seen.size !== members.size)
    throw new Error('组内分配必须包含负责人和全部成员，未分配成员请填 0')
  const normalized = statement.members.map(member => ({
    workerId: member.workerId,
    workerName: member.workerName,
    isLeader: member.isLeader,
    allocatedAmountFen: amounts.get(member.workerId) ?? 0,
    amount: (amounts.get(member.workerId) ?? 0) / 100,
  }))
  const allocatedCents = normalized.reduce(
    (sum, allocation) => sum + amountInCents(allocation.amount),
    0,
  )
  if (allocatedCents !== amountInCents(actualAmount))
    throw new Error('成员分配合计必须等于实际发放金额')
  return normalized
}

export async function createWageStatementDraft(
  db: PayrollDb,
  input: WageStatementDraftInput,
  options: { withinTransaction?: boolean } = {},
): Promise<string> {
  assertMonth(input.month)
  assertSource(input.quantitySource)
  assertLines(input.lines)
  const formatFamily = input.formatFamily ?? 'A'
  const periodKind = input.periodKind ?? 'monthly'
  if (formatFamily === 'B')
    throw new Error('B 类工资已退役，请选择 A、C1 或 C2')
  if (formatFamily === 'C1' && periodKind !== 'monthly')
    throw new Error('C1 当前只支持月度考勤工资，结算与尾款档尚未实现')
  if (formatFamily === 'C1' && input.lines.length === 0)
    throw new Error('C1 必须先录入至少一条当月考勤，不能生成空工资单')
  if (formatFamily === 'C2' && periodKind !== 'monthly')
    throw new Error('C2 零星签工只支持月度工资单')
  if (formatFamily === 'C2' && input.quantitySource !== 'field')
    throw new Error('C2 零星签工固定使用已确认签工记录')
  if (formatFamily === 'C2' && input.payRatio !== 1)
    throw new Error('C2 零星签工固定按已确认工数 100% 核算')
  if (
    formatFamily === 'C2'
    && (
      !input.subjectConfigId
      || !input.lines.length
      || !(input.sourceRecordIds?.length)
    )
  ) {
    throw new Error('C2 必须先配置请款主体并录入至少一条已确认签工记录')
  }
  if (!Number.isFinite(input.payRatio) || input.payRatio < 0 || input.payRatio > 1)
    throw new Error('发放比例必须在 0% 到 100% 之间')
  if (input.purpose === 'final' && input.quantitySource !== 'field')
    throw new Error('最终结算固定使用现场复核量')
  if (periodKind !== 'monthly' && input.purpose !== 'final')
    throw new Error('结算与尾款档必须使用最终结算用途')
  if (periodKind !== 'monthly' && input.quantitySource !== 'field')
    throw new Error('结算与尾款档固定使用现场复核量')
  if (periodKind === 'retention' && input.payRatio !== 1)
    throw new Error('尾款档固定按 100% 收口')
  await validateWageParticipants(db, input)
  if (formatFamily === 'C2') {
    const [config] = await db.select<{ id: string }>(`
      SELECT id
      FROM payroll_subject_configs
      WHERE id = ?
        AND project_id = ?
        AND leader_worker_id = ?
        AND format_family = 'C2'
        AND enabled = 1
        AND deleted_at IS NULL
    `, [input.subjectConfigId, input.projectId, input.leaderWorkerId])
    if (!config)
      throw new Error('C2 请款主体配置不存在、已停用或与当前项目负责人不匹配')
    const participantIds = [...new Set([
      input.leaderWorkerId,
      ...(input.memberWorkerIds ?? []),
    ])]
    const participantPlaceholders = participantIds.map(() => '?').join(', ')
    const [attendance] = await db.select<{ id: string }>(`
      SELECT id
      FROM attendance_records
      WHERE project_id = ?
        AND substr(work_date, 1, 7) = ?
        AND worker_id IN (${participantPlaceholders})
        AND deleted_at IS NULL
      LIMIT 1
    `, [input.projectId, input.month, ...participantIds])
    if (attendance)
      throw new Error('C2 请款成员当月已有考勤记录，不能同时按签工计薪')
  }

  const id = generateId('wage_statement')
  const cumulativeAmount = cumulativeTotal(input.lines, input.payRatio)
  const previouslyPaid = formatFamily === 'C1' || formatFamily === 'C2'
    ? 0
    : await releasedTotal(db, {
        projectId: input.projectId,
        leaderWorkerId: input.leaderWorkerId,
        formatFamily,
      })
  const sourceVersion = input.sourceVersion || stableSourceVersion(input.lines)
  const persist = async () => {
    await db.execute(`
      INSERT INTO wage_statements (
        id, project_id, crew_id, leader_worker_id, subject_config_id,
        month, format_family,
        period_kind, purpose, quantity_source, status, pay_ratio,
        cumulative_amount, previously_paid, gross_amount,
        source_version, source_updated_at, adjustment_reason, operator_name, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      input.projectId,
      input.crewId ?? null,
      input.leaderWorkerId,
      input.subjectConfigId ?? null,
      input.month,
      formatFamily,
      periodKind,
      input.purpose,
      input.quantitySource,
      input.payRatio,
      cumulativeAmount,
      previouslyPaid,
      payableTotal(cumulativeAmount, previouslyPaid),
      sourceVersion,
      input.sourceUpdatedAt ?? null,
      input.adjustmentReason?.trim() ?? '',
      input.operatorName?.trim() ?? '',
      input.note?.trim() ?? '',
    ])
    await replaceMembers(db, id, input.leaderWorkerId, input.memberWorkerIds ?? [])
    await replaceLines(db, id, input.lines)
    if (formatFamily === 'C2')
      await replaceDayworkLinks(db, id, input.sourceRecordIds ?? [])
  }
  if (options.withinTransaction) {
    await persist()
    return id
  }

  await db.execute('BEGIN IMMEDIATE')
  try {
    await persist()
    await db.execute('COMMIT')
  }
  catch (error) {
    try {
      await db.execute('ROLLBACK')
    }
    catch {
      // 保留触发回滚的原始异常，避免事务清理失败覆盖根因。
    }
    throw error
  }
  return id
}

export async function checkWageStatement(
  db: PayrollDb,
  statementId: string,
  fieldLines: readonly WageStatementLineInput[],
  audit: Partial<WageSourceAudit> = {},
  options: { withinTransaction?: boolean } = {},
): Promise<void> {
  assertLines(fieldLines)
  const [statement] = await db.select<{
    status: WageStatementStatus
    pay_ratio: number
    project_id: string
    leader_worker_id: string
    format_family: WageFormatFamily
    subject_config_id: string | null
  }>(
    `SELECT status, pay_ratio, project_id, leader_worker_id, format_family, subject_config_id
     FROM wage_statements
     WHERE id = ? AND deleted_at IS NULL`,
    [statementId],
  )
  if (!statement)
    throw new Error('工资单不存在')
  if (statement.status === 'released')
    throw new Error('该工资单已发放，快照不可修改')
  if (statement.format_family === 'B')
    throw new Error('B 类工资已退役，历史记录只读')
  if (
    statement.format_family === 'C2'
    && (
      !audit.subjectConfig
      || audit.subjectConfig.id !== statement.subject_config_id
    )
  ) {
    throw new Error('C2 核对必须使用当前请款主体配置')
  }
  const sourceVersion = audit.sourceVersion || stableSourceVersion(fieldLines)
  const cumulativeAmount = cumulativeTotal(fieldLines, statement.pay_ratio)
  const previouslyPaid = statement.format_family === 'C1' || statement.format_family === 'C2'
    ? 0
    : await releasedTotal(db, {
        projectId: statement.project_id,
        leaderWorkerId: statement.leader_worker_id,
        formatFamily: statement.format_family,
        excludeStatementId: statementId,
      })

  const persist = async () => {
    await replaceLines(db, statementId, fieldLines)
    if (statement.format_family === 'C2')
      await replaceDayworkLinks(db, statementId, audit.sourceRecordIds ?? [])
    await db.execute(`
      UPDATE wage_statements
      SET quantity_source = 'field',
          status = 'checked',
          needs_recheck = 0,
          cumulative_amount = ?,
          previously_paid = ?,
          gross_amount = ?,
          source_version = ?,
          source_updated_at = ?,
          checked_source_version = ?,
          note = CASE WHEN format_family = 'C2' THEN ? ELSE note END,
          checked_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      cumulativeAmount,
      previouslyPaid,
      payableTotal(cumulativeAmount, previouslyPaid),
      sourceVersion,
      audit.sourceUpdatedAt ?? null,
      sourceVersion,
      audit.subjectConfig?.ruleText ?? '',
      statementId,
    ])
  }
  if (options.withinTransaction) {
    await persist()
    return
  }

  await db.execute('BEGIN IMMEDIATE')
  try {
    await persist()
    await db.execute('COMMIT')
  }
  catch (error) {
    try {
      await db.execute('ROLLBACK')
    }
    catch {
      // 保留触发回滚的原始异常，避免事务清理失败覆盖根因。
    }
    throw error
  }
}

export async function releaseWageStatement(
  db: PayrollDb,
  statementId: string,
  actualAmount: number,
  audit: {
    currentSourceVersion?: string
    operatorName?: string
    adjustmentReason?: string
  } = {},
  allocations: readonly WageAllocationInput[] = [],
): Promise<WageReleaseResult> {
  if (!Number.isFinite(actualAmount))
    throw new Error('实际发放金额必须是有效数字')
  const normalizedActualAmount = rounded(actualAmount)
  if (normalizedActualAmount <= 0)
    throw new Error('实际发放金额必须大于 0；暂不支付时不要执行发放')
  const statement = await loadWageStatement(db, statementId)
  if (!statement)
    throw new Error('工资单不存在')
  if (statement.formatFamily === 'B')
    throw new Error('B 类工资已退役，历史记录只读')
  if (statement.status !== 'checked')
    throw new Error('工资单必须先核对')
  if (statement.quantitySource !== 'field')
    throw new Error('发放只能使用现场复核量')
  const currentSource = audit.currentSourceVersion
    ? {
        sourceVersion: audit.currentSourceVersion,
        sourceUpdatedAt: statement.sourceUpdatedAt,
      }
    : await loadCurrentWageSourceAudit(db, statement)
  const currentSourceVersion = currentSource.sourceVersion
  if (
    statement.checkedSourceVersion
    && currentSourceVersion !== statement.checkedSourceVersion
  ) {
    await db.execute(`
      UPDATE wage_statements
      SET needs_recheck = 1, updated_at = datetime('now')
      WHERE id = ? AND status = 'checked'
    `, [statementId])
    return 'needs_recheck'
  }

  const previouslyPaid = statement.formatFamily === 'C1' || statement.formatFamily === 'C2'
    ? 0
    : await releasedTotal(db, {
        projectId: statement.projectId,
        leaderWorkerId: statement.leaderWorkerId,
        formatFamily: statement.formatFamily,
        excludeStatementId: statementId,
      })
  const grossAmount = payableTotal(statement.cumulativeAmount, previouslyPaid)
  if (grossAmount <= 0)
    throw new Error('当前累计应付已全部发放，本次应发为 0，不能重复发放')
  if (normalizedActualAmount > grossAmount)
    throw new Error(`实际发放金额不能超过本次应发 ${grossAmount.toFixed(2)} 元`)
  const normalizedAllocations = normalizeAllocations(
    statement,
    normalizedActualAmount,
    allocations,
  )

  const submittedAt = new Date().toISOString()
  const operatorName = audit.operatorName?.trim() || statement.operatorName
  const adjustmentReason = audit.adjustmentReason?.trim() || statement.adjustmentReason
  const snapshot = JSON.stringify({
    projectName: statement.projectName,
    crewName: statement.crewName,
    leaderName: statement.leaderName,
    month: statement.month,
    periodKind: statement.periodKind,
    formatFamily: statement.formatFamily,
    quantitySource: statement.quantitySource,
    sourceVersion: currentSourceVersion,
    sourceUpdatedAt: currentSource.sourceUpdatedAt,
    payRatio: statement.payRatio,
    cumulativeAmount: statement.cumulativeAmount,
    previouslyPaid,
    grossAmount,
    actualAmount: normalizedActualAmount,
    adjustmentReason,
    operatorName,
    submittedAt,
    memberWorkerIds: statement.memberWorkerIds,
    members: statement.members,
    allocations: normalizedAllocations,
    allocationRecorded: true,
    actualAmountFen: amountInCents(normalizedActualAmount),
    allocationTotalFen: normalizedAllocations.reduce(
      (sum, allocation) => sum + allocation.allocatedAmountFen,
      0,
    ),
    lines: statement.lines,
    dayworkRecords: statement.dayworkRecords,
    subjectConfig: currentSource.subjectConfig ?? null,
    note: statement.note,
  })
  await replaceAllocations(db, statementId, normalizedAllocations)
  await db.execute(`
    UPDATE wage_statements
    SET status = 'released',
        actual_amount = ?,
        previously_paid = ?,
        gross_amount = ?,
        source_version = ?,
        source_updated_at = ?,
        operator_name = ?,
        adjustment_reason = ?,
        snapshot_json = ?,
        submitted_at = ?,
        released_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ? AND status = 'checked'
  `, [
    normalizedActualAmount,
    previouslyPaid,
    grossAmount,
    currentSourceVersion,
    currentSource.sourceUpdatedAt,
    operatorName,
    adjustmentReason,
    snapshot,
    submittedAt,
    statementId,
  ])
  return 'released'
}

function mapLine(row: LineRow): WageStatementLine {
  return {
    id: row.id,
    workerId: row.worker_id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    amount: Number(row.amount),
  }
}

async function loadLines(db: PayrollDb, statementId: string): Promise<WageStatementLine[]> {
  const rows = await db.select<LineRow>(`
    SELECT id, worker_id, item_id, item_name, unit, quantity, unit_price, amount
    FROM wage_statement_lines
    WHERE statement_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [statementId])
  return rows.map(mapLine)
}

function mapStatement(
  row: StatementRow,
  lines: WageStatementLine[],
  members: WageStatementMember[],
  allocations: WageStatementAllocation[],
  dayworkRecords: SignedDayworkRecord[],
): WageStatement {
  const snapshot = row.status === 'released'
    ? parseReleaseSnapshot(row.snapshot_json)
    : null
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: snapshot?.projectName || row.project_name,
    crewId: row.crew_id,
    crewName: snapshot?.crewName ?? row.crew_name ?? '',
    leaderWorkerId: row.leader_worker_id,
    leaderName: snapshot?.leaderName || row.leader_name,
    subjectConfigId: row.subject_config_id,
    month: row.month,
    formatFamily: row.format_family,
    periodKind: row.period_kind,
    purpose: row.purpose,
    quantitySource: row.quantity_source,
    status: row.status,
    needsRecheck: Boolean(row.needs_recheck),
    payRatio: Number(row.pay_ratio),
    cumulativeAmount: snapshot?.cumulativeAmount ?? Number(row.cumulative_amount),
    previouslyPaid: snapshot?.previouslyPaid ?? Number(row.previously_paid),
    grossAmount: snapshot?.grossAmount ?? Number(row.gross_amount),
    actualAmount: snapshot?.actualAmount
      ?? (row.actual_amount == null ? null : Number(row.actual_amount)),
    sourceVersion: row.source_version,
    sourceUpdatedAt: row.source_updated_at,
    checkedSourceVersion: row.checked_source_version,
    adjustmentReason: snapshot?.adjustmentReason ?? row.adjustment_reason,
    operatorName: snapshot?.operatorName ?? row.operator_name,
    submittedAt: snapshot?.submittedAt ?? row.submitted_at,
    checkedAt: row.checked_at,
    releasedAt: row.released_at,
    note: snapshot?.note ?? row.note,
    members: snapshot?.members.length ? snapshot.members : members,
    memberWorkerIds: snapshot?.memberWorkerIds ?? members.map(member => member.workerId),
    allocationRecorded: snapshot?.allocationRecorded ?? allocations.length > 0,
    allocations: snapshot?.allocations ?? allocations,
    lines: snapshot?.lines ?? lines,
    dayworkRecords: snapshot?.dayworkRecords ?? dayworkRecords,
  }
}

interface WageReleaseSnapshot {
  projectName: string
  crewName: string
  leaderName: string
  cumulativeAmount: number
  previouslyPaid: number
  grossAmount: number
  actualAmount: number
  adjustmentReason: string
  operatorName: string
  submittedAt: string
  memberWorkerIds: string[]
  members: WageStatementMember[]
  allocationRecorded: boolean
  actualAmountFen: number
  allocationTotalFen: number
  allocations: WageStatementAllocation[]
  lines: WageStatementLine[]
  dayworkRecords: SignedDayworkRecord[]
  note: string
}

function parseReleaseSnapshot(value: string | null): WageReleaseSnapshot | null {
  if (!value)
    return null
  try {
    const snapshot = JSON.parse(value) as Partial<WageReleaseSnapshot>
    if (
      !Array.isArray(snapshot.lines)
      || !Array.isArray(snapshot.memberWorkerIds)
      || typeof snapshot.cumulativeAmount !== 'number'
      || typeof snapshot.previouslyPaid !== 'number'
      || typeof snapshot.grossAmount !== 'number'
      || typeof snapshot.actualAmount !== 'number'
    ) {
      return null
    }
    return {
      projectName: typeof snapshot.projectName === 'string' ? snapshot.projectName : '',
      crewName: typeof snapshot.crewName === 'string' ? snapshot.crewName : '',
      leaderName: typeof snapshot.leaderName === 'string' ? snapshot.leaderName : '',
      cumulativeAmount: snapshot.cumulativeAmount,
      previouslyPaid: snapshot.previouslyPaid,
      grossAmount: snapshot.grossAmount,
      actualAmount: snapshot.actualAmount,
      adjustmentReason: typeof snapshot.adjustmentReason === 'string'
        ? snapshot.adjustmentReason
        : '',
      operatorName: typeof snapshot.operatorName === 'string' ? snapshot.operatorName : '',
      submittedAt: typeof snapshot.submittedAt === 'string' ? snapshot.submittedAt : '',
      memberWorkerIds: snapshot.memberWorkerIds.filter(id => typeof id === 'string'),
      members: Array.isArray(snapshot.members)
        ? snapshot.members
        : [],
      allocationRecorded: snapshot.allocationRecorded === true,
      actualAmountFen: typeof snapshot.actualAmountFen === 'number'
        ? snapshot.actualAmountFen
        : amountInCents(snapshot.actualAmount),
      allocationTotalFen: typeof snapshot.allocationTotalFen === 'number'
        ? snapshot.allocationTotalFen
        : 0,
      allocations: Array.isArray(snapshot.allocations)
        ? snapshot.allocations
        : [],
      lines: snapshot.lines,
      dayworkRecords: Array.isArray(snapshot.dayworkRecords)
        ? snapshot.dayworkRecords
        : [],
      note: typeof snapshot.note === 'string' ? snapshot.note : '',
    }
  }
  catch {
    return null
  }
}

const STATEMENT_SELECT = `
  SELECT ws.id, ws.project_id, p.name AS project_name,
         ws.crew_id, c.name AS crew_name,
         ws.leader_worker_id, w.name AS leader_name,
         ws.subject_config_id,
         ws.month, ws.format_family, ws.period_kind, ws.purpose,
         ws.quantity_source, ws.status, ws.needs_recheck,
         ws.pay_ratio, ws.cumulative_amount, ws.previously_paid,
         ws.gross_amount, ws.actual_amount,
         ws.source_version, ws.source_updated_at, ws.checked_source_version,
         ws.adjustment_reason, ws.operator_name, ws.submitted_at,
         ws.checked_at, ws.released_at, ws.note, ws.snapshot_json
  FROM wage_statements ws
  JOIN projects p ON p.id = ws.project_id
  JOIN workers w ON w.id = ws.leader_worker_id
  LEFT JOIN crews c ON c.id = ws.crew_id
`

async function loadMembers(db: PayrollDb, statementId: string): Promise<WageStatementMember[]> {
  const rows = await db.select<{
    worker_id: string
    worker_name: string
    is_leader: number
  }>(`
    SELECT member.worker_id, worker.name AS worker_name, member.is_leader
    FROM wage_statement_members member
    JOIN workers worker
      ON worker.id = member.worker_id
     AND worker.deleted_at IS NULL
    WHERE member.statement_id = ? AND member.deleted_at IS NULL
    ORDER BY member.is_leader DESC, member.created_at, member.id
  `, [statementId])
  return rows.map(row => ({
    workerId: row.worker_id,
    workerName: row.worker_name,
    isLeader: Boolean(row.is_leader),
  }))
}

async function loadAllocations(
  db: PayrollDb,
  statementId: string,
): Promise<WageStatementAllocation[]> {
  const rows = await db.select<{
    worker_id: string
    worker_name: string
    is_leader: number
    allocated_amount_fen: number
  }>(`
    SELECT allocation.worker_id, worker.name AS worker_name,
           member.is_leader, allocation.allocated_amount_fen
    FROM wage_statement_allocations allocation
    JOIN workers worker
      ON worker.id = allocation.worker_id
     AND worker.deleted_at IS NULL
    JOIN wage_statement_members member
      ON member.statement_id = allocation.statement_id
     AND member.worker_id = allocation.worker_id
     AND member.deleted_at IS NULL
    WHERE allocation.statement_id = ?
      AND allocation.deleted_at IS NULL
    ORDER BY allocation.created_at, allocation.id
  `, [statementId])
  return rows.map(row => ({
    workerId: row.worker_id,
    workerName: row.worker_name,
    isLeader: Boolean(row.is_leader),
    allocatedAmountFen: Number(row.allocated_amount_fen),
    amount: Number(row.allocated_amount_fen) / 100,
  }))
}

export async function loadWageStatement(
  db: PayrollDb,
  statementId: string,
): Promise<WageStatement | null> {
  const [row] = await db.select<StatementRow>(
    `${STATEMENT_SELECT} WHERE ws.id = ? AND ws.deleted_at IS NULL`,
    [statementId],
  )
  if (!row)
    return null
  const [lines, members, allocations, dayworkRecords] = await Promise.all([
    loadLines(db, statementId),
    loadMembers(db, statementId),
    loadAllocations(db, statementId),
    listStatementDayworkRecords(db, statementId),
  ])
  return mapStatement(row, lines, members, allocations, dayworkRecords)
}

export async function listWageStatements(
  db: PayrollDb,
  filter: WageStatementFilter = {},
): Promise<WageStatement[]> {
  const clauses = ['ws.deleted_at IS NULL']
  const params: unknown[] = []
  if (filter.projectId) {
    clauses.push('ws.project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.month) {
    clauses.push('ws.month = ?')
    params.push(filter.month)
  }
  const statuses = Array.isArray(filter.status) ? [...new Set(filter.status)] : filter.status ? [filter.status] : []
  if (statuses.length) {
    clauses.push(`ws.status IN (${statuses.map(() => '?').join(', ')})`)
    params.push(...statuses)
  }
  if (filter.crewId) {
    clauses.push('ws.crew_id = ?')
    params.push(filter.crewId)
  }
  const rows = await db.select<StatementRow>(
    `${STATEMENT_SELECT}
     WHERE ${clauses.join(' AND ')}
     ORDER BY ws.month DESC, ws.created_at DESC`,
    params,
  )
  return Promise.all(rows.map(async (row) => {
    const [lines, members, allocations, dayworkRecords] = await Promise.all([
      loadLines(db, row.id),
      loadMembers(db, row.id),
      loadAllocations(db, row.id),
      listStatementDayworkRecords(db, row.id),
    ])
    return mapStatement(row, lines, members, allocations, dayworkRecords)
  }))
}

export async function loadPayrollWorkbenchOptions(
  db: PayrollDb,
  projectId = '',
): Promise<PayrollWorkbenchOptions> {
  const [projects, crews, workers, c2SubjectConfigs] = await Promise.all([
    db.select<{ id: string, name: string, code: string }>(`
      SELECT id, name, code FROM projects
      WHERE deleted_at IS NULL ORDER BY name, code
    `),
    db.select<{ id: string, name: string }>(`
      SELECT id, name FROM crews
      WHERE deleted_at IS NULL ORDER BY name
    `),
    db.select<{ id: string, name: string, crew_id: string | null }>(`
      SELECT w.id, w.name, w.crew_id
      FROM workers w
      WHERE w.deleted_at IS NULL
        AND (
          ? = ''
          OR w.current_project_id = ?
          OR EXISTS (
            SELECT 1
            FROM unit_assignments ua
            JOIN units u ON u.id = ua.unit_id AND u.deleted_at IS NULL
            JOIN floors f ON f.id = u.floor_id AND f.deleted_at IS NULL
            JOIN buildings b ON b.id = f.building_id AND b.deleted_at IS NULL
            WHERE ua.deleted_at IS NULL
              AND b.project_id = ?
              AND (ua.worker_id = w.id OR ua.crew_id = w.crew_id)
          )
        )
      ORDER BY w.name
    `, [projectId, projectId, projectId]),
    listC2SubjectConfigs(db, projectId),
  ])
  return {
    projects,
    crews,
    workers: workers.map(row => ({ id: row.id, name: row.name, crewId: row.crew_id })),
    c2SubjectConfigs,
  }
}

export interface WageDraftBuildInput {
  projectId: string
  crewId?: string | null
  leaderWorkerId: string
  memberWorkerIds?: readonly string[]
  statementId?: string
  month?: string
  formatFamily?: WageFormatFamily
  quantitySource: WageQuantitySource
  dailyRate?: number
  overtimeRate?: number
  subjectConfigId?: string | null
  fallbackRatesByWorker?: Readonly<Record<string, {
    dailyRate: number
    overtimeRate: number
  }>>
}

export interface WageDraftSource extends WageSourceAudit {
  lines: WageStatementLineInput[]
}

export async function buildWageDraftSource(
  db: PayrollDb,
  input: WageDraftBuildInput,
): Promise<WageDraftSource> {
  assertSource(input.quantitySource)
  const formatFamily = input.formatFamily ?? 'A'
  const memberWorkerIds = [...new Set([
    input.leaderWorkerId,
    ...(input.memberWorkerIds ?? []),
  ].filter(Boolean))]
  await validateWageParticipants(db, {
    projectId: input.projectId,
    crewId: input.crewId,
    leaderWorkerId: input.leaderWorkerId,
    memberWorkerIds: input.memberWorkerIds,
  })

  if (formatFamily === 'B')
    throw new Error('B 类工资已退役，历史记录只读')

  if (formatFamily === 'C2') {
    if (!input.month)
      throw new Error('C2 零星签工必须指定月份')
    if (!input.subjectConfigId)
      throw new Error('C2 必须先建立请款主体×项目配置')
    const [config] = await db.select<{
      id: string
      project_id: string
      leader_worker_id: string
      unit_rate: number
      rule_text: string
      updated_at: string
    }>(`
      SELECT id, project_id, leader_worker_id, unit_rate, rule_text, updated_at
      FROM payroll_subject_configs
      WHERE id = ?
        AND format_family = 'C2'
        AND enabled = 1
        AND deleted_at IS NULL
    `, [input.subjectConfigId])
    if (
      !config
      || config.project_id !== input.projectId
      || config.leader_worker_id !== input.leaderWorkerId
    ) {
      throw new Error('C2 请款主体配置与当前项目负责人不匹配')
    }
    const defaultRate = Number(config.unit_rate)
    const placeholders = memberWorkerIds.map(() => '?').join(', ')
    const records = memberWorkerIds.length
      ? await db.select<{
          id: string
          worker_id: string
          worker_name: string
          work_date: string
          work_content: string
          start_time: string
          end_time: string
          labor_units: number
          witness: string
          confirmed_on: string | null
          updated_at: string
        }>(`
          SELECT record.id, record.worker_id, worker.name AS worker_name,
                 record.work_date, record.work_content,
                 record.start_time, record.end_time, record.labor_units,
                 record.witness, record.confirmed_on, record.updated_at
          FROM signed_daywork_records record
          JOIN workers worker
            ON worker.id = record.worker_id
           AND worker.deleted_at IS NULL
          WHERE record.project_id = ?
            AND substr(record.work_date, 1, 7) = ?
            AND record.status = 'confirmed'
            AND record.worker_id IN (${placeholders})
            AND record.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM wage_statement_daywork_records link
              JOIN wage_statements linked_statement
                ON linked_statement.id = link.statement_id
               AND linked_statement.deleted_at IS NULL
              WHERE link.daywork_record_id = record.id
                AND link.deleted_at IS NULL
                AND (? IS NULL OR link.statement_id <> ?)
            )
            ${input.crewId ? 'AND record.crew_id = ?' : ''}
          ORDER BY record.work_date, record.start_time, record.id
        `, [
          input.projectId,
          input.month,
          ...memberWorkerIds,
          input.statementId ?? null,
          input.statementId ?? null,
          ...(input.crewId ? [input.crewId] : []),
        ])
      : []
    const grouped = new Map<string, {
      workerName: string
      quantity: number
      updatedAt: string | null
    }>()
    for (const record of records) {
      const current = grouped.get(record.worker_id) ?? {
        workerName: record.worker_name,
        quantity: 0,
        updatedAt: null,
      }
      current.quantity = rounded(current.quantity + Number(record.labor_units))
      current.updatedAt = !current.updatedAt || record.updated_at > current.updatedAt
        ? record.updated_at
        : current.updatedAt
      grouped.set(record.worker_id, current)
    }
    const lines = [...grouped.entries()].map(([workerId, group]) => {
      const unitPrice = defaultRate
      if (!Number.isFinite(unitPrice) || unitPrice <= 0)
        throw new Error(`C2 大工单价必须大于 0：${group.workerName}`)
      return {
        workerId,
        itemId: null,
        itemName: `零星签工 · ${group.workerName}`,
        unit: '工',
        quantity: group.quantity,
        unitPrice,
      }
    })
    const sourceUpdatedAt = records.reduce<string | null>((latest, record) =>
      !latest || record.updated_at > latest ? record.updated_at : latest, config.updated_at)
    return {
      lines,
      sourceVersion: stableSourceVersion(
        lines,
        sourceUpdatedAt,
        true,
        `${config.id}|${config.unit_rate}|${config.rule_text}|${records.map(record => [
          record.id,
          record.worker_id,
          record.work_date,
          record.work_content,
          record.start_time,
          record.end_time,
          record.labor_units,
          record.witness,
          record.confirmed_on ?? '',
          record.updated_at,
        ].join('|')).join('\n')}`,
      ),
      sourceUpdatedAt,
      sourceRecordIds: records.map(record => record.id),
      subjectConfig: {
        id: config.id,
        unitRate: Number(config.unit_rate),
        ruleText: config.rule_text,
      },
    }
  }

  if (formatFamily === 'C1') {
    if (!input.month)
      throw new Error('C1 计时工资必须指定月份')
    const dailyRate = Number(input.dailyRate ?? 0)
    const overtimeRate = Number(input.overtimeRate ?? dailyRate / 8)
    if (!Number.isFinite(dailyRate) || dailyRate < 0)
      throw new Error('日薪不能为负数')
    if (!Number.isFinite(overtimeRate) || overtimeRate < 0)
      throw new Error('加班时薪不能为负数')
    const placeholders = memberWorkerIds.map(() => '?').join(', ')
    const rows = memberWorkerIds.length
      ? await db.select<{
          worker_id: string
          hours: number
          overtime_hours: number
          daily_wage: number | null
          source_updated_at: string | null
        }>(`
          SELECT w.id AS worker_id,
                 COALESCE(SUM(ar.hours), 0) AS hours,
                 COALESCE(SUM(ar.overtime_hours), 0) AS overtime_hours,
                 w.daily_wage,
                 MAX(
                   CASE
                     WHEN ar.updated_at IS NOT NULL AND ar.updated_at >= w.updated_at THEN ar.updated_at
                     ELSE w.updated_at
                   END
                 ) AS source_updated_at
          FROM workers w
          LEFT JOIN attendance_records ar
            ON ar.worker_id = w.id
           AND ar.project_id = ?
           AND substr(ar.work_date, 1, 7) = ?
           AND ar.deleted_at IS NULL
          WHERE w.id IN (${placeholders})
            AND w.deleted_at IS NULL
          GROUP BY w.id, w.daily_wage
          ORDER BY w.id
        `, [input.projectId, input.month, ...memberWorkerIds])
      : []
    const hasAttendance = rows.some(row =>
      Number(row.hours) > 0 || Number(row.overtime_hours) > 0,
    )
    if (!hasAttendance) {
      return {
        lines: [],
        sourceVersion: stableSourceVersion([]),
        sourceUpdatedAt: null,
      }
    }
    const lines = rows.flatMap((row) => {
      const workerFallback = input.fallbackRatesByWorker?.[row.worker_id]
      const workerDailyRate = Number(
        row.daily_wage
        ?? workerFallback?.dailyRate
        ?? dailyRate,
      )
      const workerOvertimeRate = row.daily_wage == null
        ? Number(workerFallback?.overtimeRate ?? overtimeRate)
        : workerDailyRate / 8
      const days = Number(row.hours) / 8
      return [
        {
          workerId: row.worker_id,
          itemId: null,
          itemName: '计时工资',
          unit: '天',
          quantity: days,
          unitPrice: workerDailyRate,
        },
        {
          workerId: row.worker_id,
          itemId: null,
          itemName: '加班工资',
          unit: '小时',
          quantity: Number(row.overtime_hours),
          unitPrice: workerOvertimeRate,
        },
      ]
    })
    const sourceUpdatedAt = rows.reduce<string | null>((latest, row) => {
      if (!row.source_updated_at)
        return latest
      return !latest || row.source_updated_at > latest ? row.source_updated_at : latest
    }, null)
    return {
      lines,
      sourceVersion: stableSourceVersion(lines, sourceUpdatedAt, true),
      sourceUpdatedAt,
    }
  }

  if (input.quantitySource === 'field' && !input.month)
    throw new Error('现场复核工资必须指定月份，以核对已完成工序范围')
  const quantityColumn = input.quantitySource === 'field' ? 'field_qty' : 'provisional_qty'
  const usesCompletedFacts = input.quantitySource === 'field'
  const workerPlaceholders = memberWorkerIds.map(() => '?').join(', ')
  const assigneeCondition = input.crewId
    ? `(ua.crew_id = ?${memberWorkerIds.length ? ` OR ua.worker_id IN (${workerPlaceholders})` : ''})`
    : `ua.worker_id IN (${workerPlaceholders})`
  const assigneeParams = input.crewId
    ? [input.crewId, ...memberWorkerIds]
    : memberWorkerIds
  const completionJoins = usesCompletedFacts
    ? `
    JOIN construction_stage_items csi
      ON csi.item_id = hti.item_id
     AND csi.is_reporting_stage = 1
     AND csi.deleted_at IS NULL
    JOIN unit_stage_completions usc
      ON usc.unit_id = u.id
     AND usc.stage_id = csi.stage_id
     AND usc.assignment_id = ua.id
     AND usc.status = 'completed'
     AND usc.deleted_at IS NULL`
    : ''
  const assignmentVisibility = usesCompletedFacts ? '' : 'AND ua.deleted_at IS NULL'
  const scopeVisibility = usesCompletedFacts ? '' : 'AND scope.deleted_at IS NULL'
  const sourceUpdatedExpression = usesCompletedFacts
    ? `MAX(MAX(hti.updated_at, ua.updated_at, usc.updated_at))`
    : `MAX(CASE WHEN hti.updated_at >= ua.updated_at THEN hti.updated_at ELSE ua.updated_at END)`
  const rows = await db.select<{
    worker_id: string
    item_id: string
    item_name: string
    unit: string
    quantity: number | null
    missing_quantity_count: number
    source_updated_at: string | null
  }>(`
    SELECT COALESCE(ua.worker_id, ?) AS worker_id,
           i.id AS item_id,
           i.name AS item_name,
           COALESCE(i.unit, '') AS unit,
           SUM(hti.${quantityColumn}) AS quantity,
           SUM(CASE WHEN hti.${quantityColumn} IS NULL THEN 1 ELSE 0 END) AS missing_quantity_count,
           ${sourceUpdatedExpression} AS source_updated_at
    FROM unit_assignments ua
    JOIN units u ON u.id = ua.unit_id AND u.deleted_at IS NULL
    JOIN floors f ON f.id = u.floor_id AND f.deleted_at IS NULL
    JOIN buildings b ON b.id = f.building_id AND b.deleted_at IS NULL
    JOIN rooms r ON r.template_id = u.house_type_template_id AND r.deleted_at IS NULL
    JOIN house_type_template_items hti ON hti.room_id = r.id AND hti.deleted_at IS NULL
    JOIN items i ON i.id = hti.item_id AND i.deleted_at IS NULL AND i.trade = ua.trade
    ${completionJoins}
    WHERE b.project_id = ?
      ${assignmentVisibility}
      AND ${assigneeCondition}
      ${usesCompletedFacts ? 'AND substr(usc.completed_at, 1, 7) <= ?' : ''}
      AND (
        NOT EXISTS (
          SELECT 1 FROM unit_assignment_scopes scope
          WHERE scope.assignment_id = ua.id ${scopeVisibility}
        )
        OR EXISTS (
          SELECT 1 FROM unit_assignment_scopes scope
          WHERE scope.assignment_id = ua.id
            AND scope.room_id = r.id
            AND scope.item_id = i.id
            ${scopeVisibility}
        )
      )
    GROUP BY COALESCE(ua.worker_id, ?), i.id, i.name, i.unit
    HAVING COALESCE(SUM(hti.${quantityColumn}), 0) > 0
        OR SUM(CASE WHEN hti.${quantityColumn} IS NULL THEN 1 ELSE 0 END) > 0
    ORDER BY i.trade, i.sort_order, i.name
  `, [
    input.leaderWorkerId,
    input.projectId,
    ...assigneeParams,
    ...(usesCompletedFacts ? [input.month] : []),
    input.leaderWorkerId,
  ])
  const missingItems = rows
    .filter(row => Number(row.missing_quantity_count) > 0)
    .map(row => row.item_name)
  if (missingItems.length) {
    throw new Error(
      `${input.quantitySource === 'field' ? '现场复核量' : '暂估量'}缺失：${[...new Set(missingItems)].join('、')}`,
    )
  }
  const lines = rows.map(row => ({
    workerId: row.worker_id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    quantity: Number(row.quantity),
    unitPrice: 0,
  }))
  const sourceUpdatedAt = rows.reduce<string | null>((latest, row) => {
    if (!row.source_updated_at)
      return latest
    return !latest || row.source_updated_at > latest ? row.source_updated_at : latest
  }, null)
  return {
    lines,
    sourceVersion: stableSourceVersion(lines, sourceUpdatedAt),
    sourceUpdatedAt,
  }
}

export async function buildWageDraftLines(
  db: PayrollDb,
  input: WageDraftBuildInput,
): Promise<WageStatementLineInput[]> {
  return (await buildWageDraftSource(db, input)).lines
}

export async function loadCurrentWageSourceAudit(
  db: PayrollDb,
  statement: WageStatement,
): Promise<WageSourceAudit> {
  const dailyRate = statement.lines.find(line => line.itemName === '计时工资')?.unitPrice ?? 0
  const overtimeRate = statement.lines.find(line => line.itemName === '加班工资')?.unitPrice
    ?? dailyRate / 8
  const fallbackRatesByWorker = Object.fromEntries(statement.memberWorkerIds.map((workerId) => {
    const workerDailyRate = statement.lines.find(line =>
      line.workerId === workerId && line.itemName === '计时工资',
    )?.unitPrice ?? dailyRate
    const workerOvertimeRate = statement.lines.find(line =>
      line.workerId === workerId && line.itemName === '加班工资',
    )?.unitPrice ?? workerDailyRate / 8
    return [workerId, {
      dailyRate: workerDailyRate,
      overtimeRate: workerOvertimeRate,
    }]
  }))
  const source = await buildWageDraftSource(db, {
    projectId: statement.projectId,
    crewId: statement.crewId,
    leaderWorkerId: statement.leaderWorkerId,
    memberWorkerIds: statement.memberWorkerIds,
    month: statement.month,
    formatFamily: statement.formatFamily,
    quantitySource: statement.quantitySource,
    dailyRate,
    overtimeRate,
    fallbackRatesByWorker,
    subjectConfigId: statement.subjectConfigId,
    statementId: statement.id,
  })
  return {
    sourceVersion: source.sourceVersion,
    sourceUpdatedAt: source.sourceUpdatedAt,
    sourceRecordIds: source.sourceRecordIds,
    subjectConfig: source.subjectConfig,
  }
}

export async function updateDraftLinePrice(
  db: PayrollDb,
  statementId: string,
  lineId: string,
  unitPrice: number,
): Promise<void> {
  if (!Number.isFinite(unitPrice) || unitPrice < 0)
    throw new Error('工资单价不能为负数')
  const [statement] = await db.select<{
    status: WageStatementStatus
    pay_ratio: number
    format_family: WageFormatFamily
  }>(
    'SELECT status, pay_ratio, format_family FROM wage_statements WHERE id = ? AND deleted_at IS NULL',
    [statementId],
  )
  if (!statement)
    throw new Error('工资单不存在')
  if (statement.status !== 'draft')
    throw new Error('只有草稿可以调整单价')
  if (statement.format_family === 'B')
    throw new Error('B 类工资已退役，历史记录只读')
  if (statement.format_family === 'C1' || statement.format_family === 'C2')
    throw new Error(`${statement.format_family} 工资标准来自责任配置，不能在工资明细中改价`)
  await db.execute(`
    UPDATE wage_statement_lines
    SET unit_price = ?, amount = ROUND(quantity * ?, 2), updated_at = datetime('now')
    WHERE id = ? AND statement_id = ? AND deleted_at IS NULL
  `, [unitPrice, unitPrice, lineId, statementId])
  await db.execute(`
    UPDATE wage_statements
    SET cumulative_amount = ROUND((
          SELECT COALESCE(SUM(amount), 0) FROM wage_statement_lines
          WHERE statement_id = ? AND deleted_at IS NULL
        ) * ?, 2),
        gross_amount = MAX(0, ROUND((
          SELECT COALESCE(SUM(amount), 0) FROM wage_statement_lines
          WHERE statement_id = ? AND deleted_at IS NULL
        ) * ? - previously_paid, 2)),
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    statementId,
    statement.pay_ratio,
    statementId,
    statement.pay_ratio,
    statementId,
  ])
}
