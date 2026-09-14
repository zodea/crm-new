import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollABlocker, PayrollACommand, PayrollACommandResult, PayrollAConfigRead, PayrollAConfigScope, PayrollAContext, PayrollADraft, PayrollAFormInput, PayrollAFormRead, PayrollAOutputRead, PayrollAQuantityFacts, PayrollARatioDefault, PayrollASubjectScope } from '../../app/lib/payroll/central-a-contract'
import type { PayrollQuery } from '../../app/lib/payroll/central-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import type { PayrollIdentitySource, PayrollRun, PayrollServiceOptions } from './payroll-service'
import { createHash } from 'node:crypto'
import { payrollAAmount, payrollACanonical, payrollAFactInSubject, payrollALines, payrollAMoney } from '../../app/lib/payroll/central-a-calculation'
import { decodePayrollAResult, encodePayrollAWire, parsePayrollACommand } from '../../app/lib/payroll/central-a-codec'
import { payrollACalculationVersion, payrollACrossBookConflicts, payrollAWriteRow, persistPayrollACalculation, releasePayrollA } from '../../app/lib/payroll/central-a-command'
import { loadPayrollAConfigHistory } from '../../app/lib/payroll/central-a-history'
import { assertPayrollAMonth, assertPayrollARatio, loadPayrollAPrices, loadPayrollASubjectConfig, savePayrollAPrices } from '../../app/lib/payroll/central-a-prices'
import { loadPayrollAReleasedDocuments } from '../../app/lib/payroll/central-a-provenance'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollAAdjustmentReconciliation } from './payroll-a-adjustment-reconciliation'
import { loadPayrollABlockerLocation, loadPayrollAOptions, payrollANavigation } from './payroll-a-options'
import { payrollMigratedAForm } from './payroll-migrated-form'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { persistPayrollReleaseAdjustments, preparePayrollReleaseAdjustments } from './payroll-release-adjustments'

type Row = Record<string, unknown>
const hash = (value: unknown) => createHash('sha256').update(payrollACanonical(value)).digest('hex')
const number = (value: unknown) => value == null ? null : typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value: unknown) => typeof value === 'string' ? value : ''
function blocker(code: string, message: string, extra: Partial<PayrollABlocker> = {}): PayrollABlocker {
  return { code, message, locationLabel: null, sourceUnavailableReason: null, field: null, completionId: null, assignmentId: null, unitId: null, roomId: null, itemId: null, workerId: null, statementId: null, source: null, ...extra }
}
async function head(db: TransactionDb, id: string): Promise<Row> {
  const [row] = await db.select<Row>('SELECT * FROM wage_statements WHERE id = ?', [id])
  if (!row)
    throw payrollProblem('not-found', '工资单不存在')
  return row
}
async function savedDraft(db: TransactionDb, row: Row): Promise<PayrollADraft> {
  const members = await db.select<{ worker_id: string }>('SELECT worker_id FROM wage_statement_members WHERE statement_id = ? AND deleted_at IS NULL ORDER BY worker_id', [row.id])
  return { projectId: text(row.project_id), crewId: row.crew_id == null ? null : text(row.crew_id), leaderWorkerId: text(row.leader_worker_id), memberWorkerIds: members.map(member => member.worker_id), month: text(row.month), periodKind: row.period_kind as PayrollADraft['periodKind'], payRatio: number(row.pay_ratio), note: text(row.note) }
}
async function priorPayments(db: TransactionDb, scope: PayrollASubjectScope, excluded: string | null) {
  // 已发事实包括后来软删的旧头；隐藏或删除不能把真实已付款解除成未付款。
  return db.select<Row>('SELECT id,month,pay_ratio,actual_amount FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND format_family=\'A\' AND status=\'released\' AND id<>? ORDER BY month,id', [scope.projectId, scope.leaderWorkerId, excluded ?? ''])
}
async function ratioDefault(db: TransactionDb, draft: Partial<PayrollADraft>, source: PayrollIdentitySource): Promise<PayrollARatioDefault> {
  const base = { statementId: null, configId: null, sourceVersion: null }
  if (draft.periodKind === 'retention')
    return { ...base, value: 1, source: 'retention-fixed' }
  if (draft.periodKind === 'settlement')
    return { ...base, value: 0.95, source: 'settlement-default' }
  if (draft.projectId && draft.leaderWorkerId && draft.month) {
    const previousMonth = new Date(`${draft.month}-01T00:00:00Z`)
    previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1)
    const previousRows = await db.select<Row>('SELECT id,status,pay_ratio,snapshot_json,source_version FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND format_family=\'A\' AND period_kind=\'monthly\' AND status IN (\'draft\',\'checked\',\'released\') AND deleted_at IS NULL AND month=? ORDER BY id', [draft.projectId, draft.leaderWorkerId, previousMonth.toISOString().slice(0, 7)])
    const previous = previousRows[0]
    if (previous) {
      let value = number(previous.pay_ratio)
      if (previous.status === 'released') {
        try {
          const snapshot: unknown = JSON.parse(text(previous.snapshot_json))
          value = snapshot && typeof snapshot === 'object' && 'payRatio' in snapshot ? number(snapshot.payRatio) : null
        }
        catch { value = null }
      }
      // 旧同月多头没有唯一依据时明确未知，不能任取一份作为建议。
      return { ...base, value: previousRows.length === 1 ? value : null, source: 'previous-statement', statementId: previousRows.length === 1 ? text(previous.id) : null, sourceVersion: hash(previousRows) }
    }
    const config = await loadPayrollASubjectConfig(db, draft.projectId, draft.leaderWorkerId)
    if (config)
      return { ...base, value: config.initialPayRatio, source: 'subject-config', configId: config.id, sourceVersion: String(config.revision) }
  }
  const crew = source.crews.find(crew => crew.id === draft.crewId)
  if (crew?.ratioExplicitlyConfigured)
    return { ...base, value: crew.defaultPayRatio ?? null, source: 'crew-config', sourceVersion: source.version }
  return { ...base, value: null, source: 'missing' }
}

export function createPayrollAService(run: PayrollRun, options: PayrollServiceOptions) {
  async function quantities(db: TransactionDb, projectId: string | undefined, month: string | undefined): Promise<PayrollAQuantityFacts> {
    if (!projectId || !month)
      return { sourceVersion: 'no-selection', rows: [], diagnostics: [] }
    assertPayrollAMonth(month)
    if (!options.quantityFacts)
      throw payrollProblem('unavailable', '中央施工工资来源尚未连接')
    return options.quantityFacts(db, { projectId, month })
  }
  async function form(db: TransactionDb, base: PayrollAContext, source: PayrollIdentitySource, input: PayrollAFormInput): Promise<PayrollAFormRead> {
    const row = input.statementId ? await head(db, input.statementId) : null
    if (row?.status === 'released') {
      const migrated = payrollMigratedAForm(await loadPayrollMigratedProof(db, String(row.project_id)), base, String(row.id))
      if (migrated)
        return migrated
    }
    const draft = row ? { ...await savedDraft(db, row), ...(row.status === 'draft' ? input.draft : {}) } : { ...input.draft }
    const all = await quantities(db, draft.projectId, draft.month)
    const prices = draft.projectId ? await loadPayrollAPrices(db, draft.projectId) : []
    const defaults = await ratioDefault(db, draft, source)
    if (draft.payRatio === undefined)
      draft.payRatio = defaults.value
    const scope: PayrollASubjectScope = { projectId: draft.projectId ?? '', leaderWorkerId: draft.leaderWorkerId ?? '', crewId: draft.crewId ?? null, memberWorkerIds: draft.memberWorkerIds ?? [] }
    const facts = all.rows.filter(fact => payrollAFactInSubject(fact, scope))
    const memberOptions = await loadPayrollAOptions(db, source, base, scope.projectId, all.rows)
    const blocks: PayrollABlocker[] = []
    if (!source.projects.some(project => project.id === scope.projectId))
      blocks.push(blocker('project-unavailable', '请选择有效的工资项目', { field: 'projectId' }))
    if (!scope.leaderWorkerId || !scope.memberWorkerIds.includes(scope.leaderWorkerId) || new Set(scope.memberWorkerIds).size !== scope.memberWorkerIds.length)
      blocks.push(blocker('members-incomplete', '请完整选择负责人和全部成员，不能重复', { field: 'memberWorkerIds' }))
    if (scope.memberWorkerIds.some(id => !memberOptions.workers.some(worker => worker.id === id)))
      blocks.push(blocker('worker-unavailable', '工资成员不存在或当前不可用', { field: 'memberWorkerIds' }))
    if (scope.crewId && (!memberOptions.crews.some(crew => crew.id === scope.crewId) || scope.memberWorkerIds.some(id => source.workers.find(worker => worker.id === id)?.crewId !== scope.crewId)))
      blocks.push(blocker('crew-unavailable', '所选工资班组不可用', { field: 'crewId' }))
    if (!draft.month || !['monthly', 'settlement', 'retention'].includes(draft.periodKind ?? ''))
      blocks.push(blocker('period-missing', '请选择有效工资月份与档位', { field: 'month' }))
    if (draft.payRatio == null || draft.payRatio < 0 || draft.payRatio > 1 || (draft.periodKind === 'retention' && draft.payRatio !== 1))
      blocks.push(blocker('ratio-missing', '请明确填写合法比例；尾款固定为 100%', { field: 'payRatio' }))
    if (!facts.length)
      blocks.push(blocker('no-completed-source', '所选责任范围没有已完成的现场施工来源'))
    for (const diagnostic of all.diagnostics) {
      if (diagnostic.affects === 'project' || (diagnostic.workerId ? scope.memberWorkerIds.includes(diagnostic.workerId) : diagnostic.crewId !== null && diagnostic.crewId === scope.crewId))
        blocks.push(blocker(diagnostic.code, diagnostic.message, diagnostic))
    }
    for (const fact of facts) {
      if (fact.fieldQty === null || !fact.unit)
        blocks.push(blocker(fact.fieldQty === null ? 'field-quantity-missing' : 'unit-missing', fact.fieldQty === null ? '已完成施工的现场量尚未提供' : '施工来源的计量单位未提供', { completionId: fact.completionId, assignmentId: fact.assignmentId, unitId: fact.unitId, roomId: fact.roomId, itemId: fact.itemId }))
    }
    const lines = payrollALines(facts, prices, scope, draft.month ?? '')
    for (const line of lines) {
      line.workerName = source.workers.find(worker => worker.id === line.workerId)?.name ?? null
      line.sources = [...new Map(line.facts.map(fact => [fact.unitId, payrollANavigation(base, scope.projectId, 'quantity-unit', fact.unitId, fact.unitName ?? '施工户', { stageId: fact.stageId, itemId: fact.itemId, completionId: fact.completionId })])).values()].filter((intent): intent is NavigationIntentDTO => intent !== null)
    }
    for (const [index, line] of lines.entries()) {
      if (line.unitPrice === null) {
        const missing = blocker('price-missing', '该分项工资单价尚未配置', { field: `lines.${index}.unitPrice`, itemId: line.itemId, workerId: line.workerId })
        line.blockers.push(missing)
        blocks.push(missing)
      }
    }
    const payments = await priorPayments(db, scope, input.statementId ?? null)
    const previouslyPaid = payrollAAmount(payments.map(payment => number(payment.actual_amount)), payments.some(payment => payment.actual_amount == null) ? ['历史 A 工资实际发放金额未记录'] : [])
    const workAmount = payrollAAmount(lines.map(line => line.amount), lines.some(line => line.amount === null) ? ['施工量或工资单价未完整提供'] : [])
    const cumulativeAmount = workAmount.value !== null && draft.payRatio !== null && draft.payRatio !== undefined ? payrollAAmount([payrollAMoney(workAmount.value * draft.payRatio)]) : payrollAAmount([null], ['累计核算依据不完整'])
    const adjustmentReconciliation = await loadPayrollAAdjustmentReconciliation(db, { formatFamily: 'A', periodKind: draft.periodKind ?? 'monthly', payRatio: draft.payRatio ?? null, source: { schemaVersion: 1, subject: scope, facts, priceRevisions: prices.filter(p => lines.some(l => l.priceRevisionIds.includes(p.id))) }, components: lines.flatMap(line => line.facts.map(fact => ({ ownershipKey: fact.ownershipKey, priceRevisionId: line.priceRevisionIds[0] ?? '', quantity: fact.fieldQty, unitPrice: line.unitPrice }))) }, payments.map(p => String(p.id)), input.statementId)
    const grossAmount = adjustmentReconciliation?.availableAmount ?? (cumulativeAmount.value !== null && previouslyPaid.value !== null ? payrollAAmount([Math.max(0, payrollAMoney(cumulativeAmount.value - previouslyPaid.value))]) : payrollAAmount([null], ['累计应付或此前实发未完整提供']))
    for (const reason of adjustmentReconciliation?.reasons ?? [])
      blocks.push(blocker('adjustment-source-unproven', reason))
    if (previouslyPaid.value === null)
      blocks.push(blocker('previous-payment-unknown', '此前实际发放金额存在历史缺口，不能作为零继续核算'))
    if (row && (!(await db.select('SELECT statement_id FROM payroll_a_statement_sources WHERE statement_id=?', [row.id])).length || row.format_family !== 'A' || row.deleted_at != null))
      blocks.push(blocker('historical-readonly', '这份历史工资缺少中央核算依据或已归档，仅保留原记录阅读'))
    for (const block of blocks) {
      if (!block.unitId && !block.completionId && !block.assignmentId)
        continue
      Object.assign(block, source.projects.some(project => project.id === scope.projectId)
        ? await loadPayrollABlockerLocation(db, base, scope.projectId, block)
        : { sourceUnavailableReason: '当前工资项目不可用，无法核实原来源位置' })
    }
    const context: PayrollAContext = { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+a:${hash({ scope, month: draft.month, periodKind: draft.periodKind, payRatio: draft.payRatio, all, prices, payments, ...(adjustmentReconciliation ? { adjustmentReconciliation } : {}) })}` }
    const status = row ? row.status as PayrollAFormRead['status'] : 'new'
    const writable = !context.readonly && blocks.length === 0
    return { context, statementId: input.statementId, draftKey: input.statementId ? null : input.draftKey!, status, needsRecheck: !!row?.needs_recheck, draft, options: memberOptions, members: memberOptions.workers.filter(worker => scope.memberWorkerIds.includes(worker.id)), facts, lines, prices, ratioDefault: defaults, totals: { workAmount, cumulativeAmount, previouslyPaid, grossAmount }, paymentSourceVersion: hash(adjustmentReconciliation ? { payments, adjustmentReconciliation } : payments), ...(adjustmentReconciliation ? { adjustmentReconciliation } : {}), blockers: blocks, eligibility: { canSaveDraft: writable && ['new', 'draft'].includes(status), canCheck: writable && ['draft', 'checked'].includes(status), canRelease: writable && status === 'checked' && !row?.needs_recheck && grossAmount.value !== null && grossAmount.value > 0, canOutput: false, reasons: blocks.map(block => block.message) } }
  }
  async function config(db: TransactionDb, base: PayrollAContext, source: PayrollIdentitySource, scope: PayrollAConfigScope): Promise<PayrollAConfigRead> {
    assertPayrollAMonth(scope.month)
    if (!source.projects.some(project => project.id === scope.projectId))
      throw payrollProblem('not-found', '工资配置项目不存在或不可用')
    const all = await quantities(db, scope.projectId, scope.month)
    const prices = (await loadPayrollAPrices(db, scope.projectId)).filter(price => price.crewId === scope.crewId && price.leaderWorkerId === scope.leaderWorkerId)
    const subject = scope.leaderWorkerId ? await loadPayrollASubjectConfig(db, scope.projectId, scope.leaderWorkerId) : null
    const crew = source.crews.find(crew => crew.id === scope.crewId)
    const locked = (await db.select('SELECT id FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND month=? AND format_family=\'A\' AND status=\'released\'', [scope.projectId, scope.leaderWorkerId, scope.month])).length > 0
    const readonlyReasons = locked ? ['所选月份已发放，工资配置只读；改价请选择后续未发月份'] : !base.capabilities.includes('payroll:write') ? ['当前身份只能阅读工资配置'] : []
    const memberOptions = await loadPayrollAOptions(db, source, base, scope.projectId, all.rows)
    for (const price of prices) {
      price.itemName = all.rows.find(fact => fact.itemId === price.itemId)?.itemName ?? null
      price.workerName = source.workers.find(worker => worker.id === price.workerId)?.name ?? null
      price.editable = !readonlyReasons.length && !prices.some(next => next.priceId === price.priceId && next.revision > price.revision)
      price.readonlyReasons = !price.editable ? readonlyReasons.length ? readonlyReasons : ['原价格修订仅保留历史，请在最新修订上调整'] : []
    }
    return { context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+config:${hash({ scope, all, prices, subject })}` }, scope, options: memberOptions, subject, crewRatio: crew ? { crewId: crew.id, value: crew.ratioExplicitlyConfigured ? crew.defaultPayRatio ?? null : null, explicitlyConfigured: crew.ratioExplicitlyConfigured ?? false, sourceVersion: source.version } : null, prices, priceOptions: [...new Map(all.rows.map(fact => [`${fact.itemId}:${fact.unit}`, { itemId: fact.itemId, itemName: fact.itemName, unit: fact.unit, scopes: [{ kind: 'project' as const }] }])).values()], readonlyReasons, history: await loadPayrollAConfigHistory(db, scope.projectId, scope.leaderWorkerId) }
  }
  return {
    aFormInTransaction: form,
    aForm: (query: PayrollQuery, input: PayrollAFormInput, sessionId?: string | null) => run(query, sessionId, (db, context, source) => form(db, context, source, input)),
    aConfig: (query: PayrollQuery, scope: PayrollAConfigScope, sessionId?: string | null) => run(query, sessionId, (db, context, source) => config(db, context, source, scope)),
    aOutput: (query: PayrollQuery, statementId: string, sessionId?: string | null): Promise<PayrollAOutputRead> => run(query, sessionId, async (db, context) => {
      const row = await head(db, statementId)
      if (query.projectId && query.projectId !== row.project_id)
        throw payrollProblem('relationship-mismatch', '输出单据与指定项目不匹配')
      const document = (await loadPayrollMigratedProof(db, String(row.project_id))).aDocuments.get(statementId) ?? (await loadPayrollAReleasedDocuments(db, statementId)).get(statementId)
      if (!document)
        return { context, statementId, state: 'unavailable', document: null, reasons: ['当前历史记录没有可证明的新中央发放与来源记录，仍保留原快照阅读'] }
      return { context, statementId, state: 'available', document, reasons: [] }
    }),
    async execute(input: PayrollACommand, sessionId?: string | null): Promise<PayrollACommandResult> {
      const command = parsePayrollACommand(encodePayrollAWire(input))
      let confirmedAbsent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (db, context, source) => {
          if (command.actorId !== context.actorId || command.workspaceId !== context.workspaceId || command.requiredCapability !== 'payroll:write' || !command.commandId)
            throw payrollProblem('forbidden', '工资提交身份或能力不匹配')
          const fingerprint = hash(command)
          const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== context.actorId)
              throw payrollProblem('conflict', '同一工资提交编号不能改用其他内容')
            return decodePayrollAResult(JSON.parse(receipt.result_json), command)
          }
          confirmedAbsent = true
          const result: PayrollACommandResult = { commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, subjectConfigId: null, priceRevisionIds: [], sourceVersion: '', outcome: 'saved', logIds: [] }
          const [start] = await db.select<{ value: number }>('SELECT COALESCE(MAX(rowid),0) AS value FROM operation_logs')
          const action = command.action
          if (action.kind === 'save-a-subject-config' || action.kind === 'save-a-prices') {
            const scope = command.configScope
            if (!scope || scope.projectId !== command.projectId || !scope.leaderWorkerId || !source.workers.some(worker => worker.id === scope.leaderWorkerId) || (scope.crewId && !source.crews.some(crew => crew.id === scope.crewId)))
              throw payrollProblem('relationship-mismatch', '工资配置所属项目或请款主体无效')
            const read = await config(db, context, source, scope)
            if (!read.options.workers.some(worker => worker.id === scope.leaderWorkerId) || (scope.crewId !== null && source.workers.find(worker => worker.id === scope.leaderWorkerId)?.crewId !== scope.crewId))
              throw payrollProblem('relationship-mismatch', '工资配置负责人不属于当前项目责任或所选班组')
            if (read.context.sourceVersion !== command.sourceVersion)
              throw payrollProblem('stale-source', '工资配置或来源已变化，请保留输入重新核对')
            if ((await db.select('SELECT id FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND month=? AND format_family=\'A\' AND status=\'released\'', [scope.projectId, scope.leaderWorkerId, scope.month])).length)
              throw payrollProblem('conflict', '已发月份的工资配置只读，请选择后续未发月份')
            if (action.kind === 'save-a-subject-config') {
              if (action.config.leaderWorkerId !== scope.leaderWorkerId || action.config.crewId !== scope.crewId)
                throw payrollProblem('relationship-mismatch', '配置与固定请款主体不匹配')
              assertPayrollARatio(action.config.initialPayRatio)
              const old = await loadPayrollASubjectConfig(db, scope.projectId, scope.leaderWorkerId)
              result.subjectConfigId = old?.id ?? generateId('payroll_a_subject')
              await payrollAWriteRow(db, 'payroll_a_subject_configs', result.subjectConfigId, { project_id: scope.projectId, crew_id: scope.crewId, leader_worker_id: scope.leaderWorkerId, initial_pay_ratio: action.config.initialPayRatio, revision: (old?.revision ?? 0) + 1, updated_at: new Date().toISOString() }, context.actorId)
            }
            else {
              const all = await quantities(db, scope.projectId, scope.month)
              for (const [index, price] of action.prices.entries()) {
                if ((await db.select('SELECT id FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND month=? AND format_family=\'A\' AND status=\'released\'', [scope.projectId, scope.leaderWorkerId, price.effectiveMonth])).length)
                  throw payrollProblem('conflict', '工资价格生效月份已发放，请选择后续未发月份')
                if (!all.rows.some(fact => fact.itemId === price.itemId && fact.unit === price.unit) || (price.workerId && !read.options.workers.some(worker => worker.id === price.workerId && worker.crewId === scope.crewId)))
                  throw payrollProblem('relationship-mismatch', '价格分项、单位或工人不是当前可证明来源', { [`prices.${index}.itemId`]: ['请重新读取当前工资分项与单位'] })
                if (price.scope.kind === 'cells' && price.scope.cells.some(cell => !all.rows.some(fact => fact.unitId === cell.unitId && fact.roomId === cell.roomId && fact.itemId === cell.itemId)))
                  throw payrollProblem('relationship-mismatch', '价格适用范围已变化')
              }
              result.priceRevisionIds = await savePayrollAPrices(db, scope, action.prices, context.actorId)
            }
          }
          else {
            if ((!command.statementId && (action.kind !== 'save-a-draft' || !command.draftKey)) || command.configScope !== null)
              throw payrollProblem('relationship-mismatch', '工资提交缺少固定目标或草稿身份')
            const input: PayrollAFormInput = command.statementId ? { statementId: command.statementId, ...(action.kind === 'save-a-draft' ? { draft: action.draft } : {}) } : { statementId: null, draftKey: command.draftKey!, draft: action.kind === 'save-a-draft' ? action.draft : {} }
            const read = await form(db, context, source, input)
            if (read.draft.projectId !== command.projectId)
              throw payrollProblem('relationship-mismatch', '工资单与提交项目不一致')
            const original = command.statementId ? await head(db, command.statementId) : null
            if (original?.status === 'released' || original?.deleted_at != null || read.blockers.some(block => block.code === 'historical-readonly'))
              throw payrollProblem('conflict', '已发或来源未核实的历史工资仅可阅读，不可修改')
            const calculationVersion = hash(payrollACalculationVersion(read, source))
            if (action.kind === 'release-a' && original?.status === 'checked' && original.checked_source_version !== calculationVersion) {
              await payrollAWriteRow(db, 'wage_statements', command.statementId!, { needs_recheck: 1, updated_at: new Date().toISOString() }, context.actorId)
              result.outcome = 'needs-recheck'
            }
            else {
              if (read.context.sourceVersion !== command.sourceVersion)
                throw payrollProblem('stale-source', '工资核算来源或此前实付已变化，请保留输入重新读取')
              if (action.kind === 'set-a-pay-ratio') {
                if (!command.statementId || !['draft', 'checked'].includes(read.status))
                  throw payrollProblem('conflict', '只能修改未发工资单的比例')
                assertPayrollARatio(action.payRatio)
                if (read.draft.periodKind === 'retention' && action.payRatio !== 1)
                  throw payrollProblem('validation-failed', '尾款档比例固定为 100%')
                await payrollAWriteRow(db, 'wage_statements', command.statementId, { pay_ratio: action.payRatio, needs_recheck: Number(read.status === 'checked'), updated_at: new Date().toISOString() }, context.actorId)
                result.outcome = read.status === 'checked' ? 'needs-recheck' : 'saved'
              }
              else if (action.kind === 'save-a-draft' || action.kind === 'check-a') {
                if (!(action.kind === 'save-a-draft' ? read.eligibility.canSaveDraft : read.eligibility.canCheck))
                  throw payrollProblem('validation-failed', read.blockers[0]?.message ?? '当前工资不能保存或核对')
                if ((await payrollACrossBookConflicts(db, read)).length)
                  throw payrollProblem('conflict', '当前施工责任已有其他请款簿发放，不能重复计薪')
                if ((await db.select('SELECT id FROM wage_statements WHERE project_id=? AND leader_worker_id=? AND month=? AND format_family=\'A\' AND period_kind=? AND id<>? AND (deleted_at IS NULL OR status=\'released\')', [read.draft.projectId, read.draft.leaderWorkerId, read.draft.month, read.draft.periodKind, command.statementId ?? ''])).length)
                  throw payrollProblem('conflict', '同一负责人、月份与档位已有工资单，请打开原单继续')
                result.statementId = command.statementId ?? generateId('wage')
                await persistPayrollACalculation(db, result.statementId, read, calculationVersion, action.kind === 'check-a' ? 'checked' : 'draft', context.actorId)
                result.outcome = action.kind === 'check-a' ? 'checked' : 'saved'
              }
              else if (action.kind === 'release-a') {
                const applications = await preparePayrollReleaseAdjustments(db, command.statementId!, action.release.actualAmount, action.release.adjustmentApplications, read.adjustmentReconciliation)
                await releasePayrollA(db, read, action.release, calculationVersion, context.actorId)
                if (applications !== undefined)
                  result.adjustmentApplicationIds = await persistPayrollReleaseAdjustments(db, command.statementId!, command.commandId, applications, context.actorId)
                if (read.adjustmentReconciliation) {
                  result.adjustmentCoverageIds = []
                  for (const coverage of read.adjustmentReconciliation.coverage) {
                    const id = generateId('payroll-coverage')
                    await payrollAWriteRow(db, 'payroll_a_adjustment_coverage', id, { adjustment_id: coverage.adjustmentId, statement_id: command.statementId, component_key: coverage.ownershipKey, command_id: command.commandId, source_version: read.adjustmentReconciliation.sourceVersion, coverage_json: payrollACanonical(coverage) }, context.actorId)
                    result.adjustmentCoverageIds.push(id)
                  }
                }
                result.outcome = 'released'
              }
              else {
                throw payrollProblem('validation-failed', '工资动作无效')
              }
            }
          }
          await advancePayrollRevision(db)
          result.sourceVersion = `payroll:${await payrollRevision(db)}`
          result.logIds = (await db.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid>? ORDER BY rowid', [start?.value ?? 0])).map(row => row.id)
          await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, result.statementId, command.configScope === null ? null : JSON.stringify(command.configScope), action.kind, fingerprint, JSON.stringify(result), payrollACanonical(command)])
          return result
        }, true)
      }
      catch (cause) {
        if (confirmedAbsent && cause instanceof ProjectRepositoryProblem)
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      }
    },
  }
}
