import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollACommand, PayrollACommandResult, PayrollAFormInput, PayrollAFormRead } from '../../app/lib/payroll/central-a-contract'
import type { PayrollARoundingRead, PayrollARoundingScope } from '../../app/lib/payroll/central-a-rounding-contract'
import type { PayrollBatchCommand, PayrollBatchConfirmCommand, PayrollBatchDecision, PayrollBatchExecuteCommand, PayrollBatchPlanItem, PayrollBatchPlanRead, PayrollBatchPrepareCommand, PayrollBatchPreviewInput, PayrollBatchPreviewItem, PayrollBatchPreviewRead } from '../../app/lib/payroll/central-batch-service-contract'
import type { PayrollC1Command, PayrollC1CommandResult, PayrollC1FormInput, PayrollC1FormRead } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollC2Command, PayrollC2CommandResult, PayrollC2FormInput, PayrollC2FormRead } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollContext, PayrollJsonObject, PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollIdentitySource, PayrollRun } from './payroll-service'
import { createHash } from 'node:crypto'
import { payrollACalculationVersion } from '../../app/lib/payroll/central-a-command'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { suggestPayrollBatchFunding } from '../../app/lib/payroll/central-batch-calculation'
import { initializePayrollBatchSchema } from '../../app/lib/payroll/central-batch-schema'
import { payrollC1Source } from '../../app/lib/payroll/central-c1-command'
import { payrollC2Source } from '../../app/lib/payroll/central-c2-command'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollRevision } from '../../app/lib/payroll/central-schema'
import { loadPayrollSourceExclusions } from '../../app/lib/payroll/central-source-locks'
import { amountInCents } from '../../app/lib/payroll/statements'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'

interface BatchReaders {
  A: (db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, input: PayrollAFormInput) => Promise<PayrollAFormRead>
  C1: (db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, input: PayrollC1FormInput) => Promise<PayrollC1FormRead>
  C2: (db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, input: PayrollC2FormInput) => Promise<PayrollC2FormRead>
  rounding: (db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, scope: PayrollARoundingScope) => Promise<PayrollARoundingRead>
}

type OriginalCommand = PayrollACommand | PayrollC1Command | PayrollC2Command
type OriginalResult = PayrollACommandResult | PayrollC1CommandResult | PayrollC2CommandResult
interface BatchExecutors {
  A: (command: PayrollACommand, sessionId?: string | null) => Promise<PayrollACommandResult>
  C1: (command: PayrollC1Command, sessionId?: string | null) => Promise<PayrollC1CommandResult>
  C2: (command: PayrollC2Command, sessionId?: string | null) => Promise<PayrollC2CommandResult>
}

interface Head { id: string, project_id: string, month: string, format_family: string, status: string, needs_recheck: number, checked_source_version: string, leader_worker_id: string }
type StoredPlan = Omit<PayrollBatchPlanRead, 'context' | 'planVersion' | 'outcomes'>

function hash(value: unknown): string {
  return createHash('sha256').update(payrollCanonical(value)).digest('hex')
}
function json(value: unknown): PayrollJsonObject {
  return JSON.parse(payrollCanonical(value)) as PayrollJsonObject
}
function assertSafeFen(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw payrollProblem('validation-failed', `${label}必须是安全范围内的非负整数分`)
}
function formReasons(read: { eligibility: { canCheck: boolean, canRelease: boolean, reasons: string[] }, status: string, needsRecheck: boolean }, purpose: PayrollBatchPreviewInput['purpose']): string[] {
  const allowed = purpose === 'check' ? read.eligibility.canCheck : read.eligibility.canRelease
  return allowed ? [] : [...new Set([...read.eligibility.reasons, ...(read.needsRecheck ? ['原工资需要重新核对'] : []), ...(read.status === 'released' ? ['原工资已经发放'] : [])])]
}

export function createPayrollBatchService(run: PayrollRun, readers: BatchReaders, executors: BatchExecutors) {
  async function previewItem(db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, input: PayrollBatchPreviewInput, statementId: string): Promise<PayrollBatchPreviewItem> {
    const [head] = await db.select<Head>('SELECT id,project_id,month,format_family,status,needs_recheck,checked_source_version,leader_worker_id FROM wage_statements WHERE id=?', [statementId])
    if (!head)
      throw payrollProblem('not-found', '批量工资包含不存在的原工资单')
    if (head.project_id !== input.projectId || head.month !== input.month || !['A', 'C1', 'C2'].includes(head.format_family))
      throw payrollProblem('relationship-mismatch', '批量工资必须属于同一项目、月份及 A/C1/C2 格式')
    const target = { itemId: statementId, statementId, formatFamily: head.format_family as 'A' | 'C1' | 'C2' }
    let read: PayrollAFormRead | PayrollC1FormRead | PayrollC2FormRead
    let evidence: PayrollJsonObject
    let checkedBasisChanged = false
    let rounding: PayrollBatchPreviewItem['rounding'] = { state: 'not-applicable' }
    if (target.formatFamily === 'A') {
      read = await readers.A(db, context, source, { statementId })
      const book = hasPayrollAFeesForm(read) ? read.book : { bookPurpose: 'ordinary' as const, managementBookId: null }
      if (book) {
        const configured = await readers.rounding(db, context, source, { projectId: input.projectId, leaderWorkerId: head.leader_worker_id, book, month: input.month })
        rounding = configured.current ? { state: 'configured', rule: configured.current.rule, revisionId: configured.current.id, revision: configured.current.revision, effectiveMonth: configured.current.effectiveMonth, sourceVersion: configured.current.sourceVersion } : { state: 'missing' }
      }
      const calculation = payrollACalculationVersion(read, source)
      checkedBasisChanged = read.status === 'checked' && head.checked_source_version !== hash(calculation)
      evidence = json({ calculation, checkedSourceVersion: head.checked_source_version, readSourceVersion: read.context.sourceVersion, status: read.status, needsRecheck: read.needsRecheck, hollow: read.hollow?.snapshot ?? null, rounding })
    }
    else if (target.formatFamily === 'C1') {
      read = await readers.C1(db, context, source, { statementId })
      const locks = await loadPayrollSourceExclusions(db, { projectId: input.projectId, month: input.month, workerIds: read.draft.memberWorkerIds ?? [], formatFamily: 'C1', statementId })
      evidence = json({ source: payrollC1Source(read), locks, checkedSourceVersion: head.checked_source_version, readSourceVersion: read.context.sourceVersion, status: read.status, needsRecheck: read.needsRecheck, hollow: read.hollow?.snapshot ?? null })
    }
    else {
      read = await readers.C2(db, context, source, { statementId })
      const locks = await loadPayrollSourceExclusions(db, { projectId: input.projectId, month: input.month, workerIds: read.draft.memberWorkerIds ?? [], formatFamily: 'C2', statementId })
      const occupations = read.facts.flatMap(fact => fact.occupations.filter(occupation => occupation.statementId !== statementId))
      evidence = json({ source: payrollC2Source(read), locks, occupations, checkedSourceVersion: head.checked_source_version, readSourceVersion: read.context.sourceVersion, status: read.status, needsRecheck: read.needsRecheck, hollow: read.hollow?.snapshot ?? null })
    }
    const reasons = formReasons(read, input.purpose)
    if (checkedBasisChanged)
      reasons.push('原工资核对依据已变化')
    const gross = read.totals.grossAmount.value
    const eligibleAmountFen = reasons.length || gross === null ? null : amountInCents(gross)
    const members = read.members.map(member => ({ workerId: member.id, workerName: member.name }))
    const { readSourceVersion: _readSourceVersion, ...basisEvidence } = evidence
    return {
      target,
      leaderWorkerId: head.leader_worker_id,
      leaderName: source.workers.find(worker => worker.id === head.leader_worker_id)?.name ?? null,
      members,
      status: read.status,
      needsRecheck: read.needsRecheck,
      eligibleAmountFen,
      requiresFullAmount: !!read.hollow?.snapshot?.start,
      rounding,
      basis: { basisHash: hash(basisEvidence), checkedSourceVersion: head.checked_source_version, evidence },
      reasons,
    }
  }

  async function preview(db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, input: PayrollBatchPreviewInput): Promise<PayrollBatchPreviewRead> {
    if (!input.projectId || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month) || !input.statementIds.length || new Set(input.statementIds).size !== input.statementIds.length)
      throw payrollProblem('validation-failed', '批量工资须固定一个项目、月份及不重复的原工资单')
    if (input.purpose === 'release') {
      if (input.fundingAmountFen === null)
        throw payrollProblem('validation-failed', '批量发放须明确本期资金总额')
      assertSafeFen(input.fundingAmountFen, '批量资金')
    }
    else if (input.fundingAmountFen !== null) {
      throw payrollProblem('validation-failed', '批量核对不能夹带发放资金')
    }
    const items: PayrollBatchPreviewItem[] = []
    for (const statementId of input.statementIds)
      items.push(await previewItem(db, context, source, input, statementId))
    const funding = input.purpose === 'release' ? suggestPayrollBatchFunding({ fundingAmountFen: input.fundingAmountFen!, items: items.map(item => ({ itemId: item.target.itemId, formatFamily: item.target.formatFamily, eligibleAmountFen: item.eligibleAmountFen, rounding: item.rounding, requiresFullAmount: item.requiresFullAmount })) }) : null
    const reasons = [...new Set(items.flatMap(item => item.reasons).concat(funding?.state === 'incomplete' ? funding.diagnostics : []))]
    const previewVersion = hash({ input, items: items.map(item => ({ target: item.target, basis: item.basis, eligibleAmountFen: item.eligibleAmountFen, requiresFullAmount: item.requiresFullAmount, rounding: item.rounding })), funding })
    return { schemaVersion: 1, context: { ...context, readonly: !context.capabilities.includes('payroll:write'), sourceVersion: `${context.sourceVersion}+batch-preview:${previewVersion}` }, input, previewVersion, items, funding, reasons }
  }

  function validateDecision(item: PayrollBatchPreviewItem, decision: PayrollBatchDecision, input: PayrollBatchPreviewInput): void {
    if (decision.kind === 'defer')
      return
    if (input.purpose === 'check') {
      if (decision.kind !== 'check' || item.reasons.length)
        throw payrollProblem('validation-failed', '批量核对只能确认当前可核对的原工资单')
      return
    }
    if (decision.kind !== 'release' || item.reasons.length || item.eligibleAmountFen === null)
      throw payrollProblem('validation-failed', '批量发放只能确认当前可发且金额已知的原工资单')
    assertSafeFen(decision.actualAmountFen, '逐单实际发放')
    if (decision.actualAmountFen > item.eligibleAmountFen || (item.requiresFullAmount && decision.actualAmountFen !== item.eligibleAmountFen))
      throw payrollProblem('validation-failed', item.requiresFullAmount ? '已启动空鼓扣款的工资必须按核准净额整单发放' : '逐单实际发放不能超过当前核准余额')
    if (decision.allocations.length !== item.members.length || new Set(decision.allocations.map(row => row.workerId)).size !== item.members.length || decision.allocations.some(row => !item.members.some(member => member.workerId === row.workerId)))
      throw payrollProblem('validation-failed', '逐单分配必须保留全部原成员且身份唯一')
    for (const allocation of decision.allocations)
      assertSafeFen(allocation.amountFen, '成员分配')
    if (decision.allocations.reduce((sum, row) => sum + row.amountFen, 0) !== decision.actualAmountFen)
      throw payrollProblem('validation-failed', '成员分配合计必须等于逐单实际发放')
  }

  function originalCommand(context: PayrollContext, projectId: string, item: PayrollBatchPlanItem, commandId: string): OriginalCommand {
    const sourceVersion = item.basis.evidence.readSourceVersion
    if (typeof sourceVersion !== 'string' || !sourceVersion)
      throw payrollProblem('unavailable', '批量工资缺少原单读取版本，不能准备执行')
    const common = { commandId, workspaceId: context.workspaceId, actorId: context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion, projectId, statementId: item.target.statementId, draftKey: null, configScope: null }
    if (item.target.formatFamily === 'A') {
      const action: PayrollACommand['action'] = item.decision.kind === 'check'
        ? { kind: 'check-a' }
        : item.decision.kind === 'release'
          ? { kind: 'release-a', release: { actualAmount: item.decision.actualAmountFen / 100, allocations: item.decision.allocations.map(row => ({ workerId: row.workerId, amount: row.amountFen / 100 })), ...(item.decision.adjustmentApplications ? { adjustmentApplications: item.decision.adjustmentApplications } : {}) } }
          : failDeferred()
      return { ...common, action }
    }
    if (item.target.formatFamily === 'C1') {
      const action: PayrollC1Command['action'] = item.decision.kind === 'check'
        ? { kind: 'check-c1' }
        : item.decision.kind === 'release'
          ? { kind: 'release-c1', release: { actualAmount: item.decision.actualAmountFen / 100, allocations: item.decision.allocations.map(row => ({ workerId: row.workerId, amount: row.amountFen / 100 })), ...(item.decision.adjustmentApplications ? { adjustmentApplications: item.decision.adjustmentApplications } : {}) } }
          : failDeferred()
      return { ...common, action }
    }
    const action: PayrollC2Command['action'] = item.decision.kind === 'check'
      ? { kind: 'check-c2' }
      : item.decision.kind === 'release'
        ? { kind: 'release-c2', release: { actualAmount: item.decision.actualAmountFen / 100, allocations: item.decision.allocations.map(row => ({ workerId: row.workerId, amount: row.amountFen / 100 })), ...(item.decision.adjustmentApplications ? { adjustmentApplications: item.decision.adjustmentApplications } : {}) } }
        : failDeferred()
    return { ...common, configId: null, action }
  }

  function failDeferred(): never {
    throw payrollProblem('conflict', '暂缓项不会生成原工资命令')
  }

  function nextExecutable(items: PayrollBatchPlanItem[], start: number): number {
    let index = start
    while (index < items.length && items[index]?.decision.kind === 'defer')
      index += 1
    return index
  }

  async function loadPlanRow(db: TransactionDb, planId: string): Promise<Record<string, unknown>> {
    const [row] = await db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_plans WHERE id=?', [planId])
    if (!row)
      throw payrollProblem('not-found', '批量工资计划不存在')
    return row
  }

  function assertPlanOwner(context: PayrollContext, row: Record<string, unknown>): void {
    if (row.workspace_id !== context.workspaceId || row.actor_id !== context.actorId)
      throw payrollProblem('forbidden', '批量工资计划不属于当前工作区或操作人')
  }

  function assertCommandOwner(context: PayrollContext, command: PayrollBatchCommand): void {
    if (command.schemaVersion !== 1 || command.requiredCapability !== 'payroll:write' || command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
      throw payrollProblem('forbidden', '批量工资提交身份、工作区或能力不匹配')
  }

  async function planFromRow(db: TransactionDb, context: PayrollContext, row: Record<string, unknown>): Promise<PayrollBatchPlanRead> {
    const stored = JSON.parse(String(row.plan_json)) as StoredPlan
    const attempts = await db.select<{ item_id: string, attempt_no: number, execute_command_id: string, state: PayrollBatchPlanRead['outcomes'][number]['attemptState'] }>('SELECT item_id,attempt_no,execute_command_id,state FROM payroll_batch_attempts WHERE plan_id=? ORDER BY item_id,attempt_no DESC', [row.id])
    const [prepared] = String(row.state) === 'prepared' ? attempts.filter(attempt => attempt.state === 'prepared') : []
    const preparedExecuteCommandId = prepared?.execute_command_id ?? null
    const latest = new Map<string, typeof attempts[number]>()
    for (const attempt of attempts) {
      if (!latest.has(attempt.item_id))
        latest.set(attempt.item_id, attempt)
    }
    const outcomes: PayrollBatchPlanRead['outcomes'] = stored.items.map((item) => {
      const attempt = latest.get(item.target.itemId)
      const attemptState = attempt?.state ?? 'not-started'
      const state = attemptState === 'checked' || attemptState === 'released'
        ? 'succeeded'
        : attemptState === 'prepared' || attemptState === 'needs-recheck' || attemptState === 'unavailable'
          ? 'unknown'
          : 'not-executed'
      const plannedAmountFen = item.decision.kind === 'release' ? item.decision.actualAmountFen : null
      const actualAmountFen = plannedAmountFen === null || state === 'unknown' ? null : state === 'succeeded' ? plannedAmountFen : 0
      return { itemId: item.target.itemId, state, attemptState, plannedAmountFen, actualAmountFen }
    })
    const planVersion = hash({ planHash: row.plan_hash, revision: row.revision, state: row.state, nextItemIndex: row.next_item_index, expectedPayrollRevision: row.expected_payroll_revision, preparedExecuteCommandId, outcomes })
    return { ...stored, context, planVersion, state: String(row.state) as PayrollBatchPlanRead['state'], preparedExecuteCommandId, nextItemIndex: Number(row.next_item_index), expectedPayrollRevision: Number(row.expected_payroll_revision), outcomes }
  }

  async function currentPlan(db: TransactionDb, context: PayrollContext, planId: string): Promise<PayrollBatchPlanRead> {
    const row = await loadPlanRow(db, planId)
    assertPlanOwner(context, row)
    return planFromRow(db, context, row)
  }

  async function existingCoordinationReceipt(db: TransactionDb, context: PayrollContext, command: PayrollBatchCommand): Promise<PayrollBatchPlanRead | null> {
    const [receipt] = await db.select<{ fingerprint: string, workspace_id: string, actor_id: string, plan_id: string }>('SELECT fingerprint,workspace_id,actor_id,plan_id FROM payroll_batch_command_receipts WHERE command_id=?', [command.commandId])
    if (!receipt)
      return null
    if (receipt.fingerprint !== hash(command) || receipt.workspace_id !== context.workspaceId || receipt.actor_id !== context.actorId)
      throw payrollProblem('conflict', '同一批量工资提交编号不能改用其他内容')
    return currentPlan(db, context, receipt.plan_id)
  }

  async function saveCoordinationReceipt(db: TransactionDb, context: PayrollContext, command: PayrollBatchCommand, projectId: string, plan: PayrollBatchPlanRead): Promise<void> {
    await db.execute('INSERT INTO payroll_batch_command_receipts(command_id,workspace_id,actor_id,project_id,plan_id,action,command_json,fingerprint,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [command.commandId, context.workspaceId, context.actorId, projectId, plan.planId, command.action.kind, payrollCanonical(command), hash(command), payrollCanonical(plan), new Date().toISOString()])
  }

  async function prepare(command: PayrollBatchPrepareCommand, sessionId?: string | null): Promise<PayrollBatchPlanRead> {
    return run({ origin: command.origin }, sessionId, async (db, context, source) => {
      await initializePayrollBatchSchema(db)
      assertCommandOwner(context, command)
      const replay = await existingCoordinationReceipt(db, context, command)
      if (replay)
        return replay
      const row = await loadPlanRow(db, command.action.input.planId)
      assertPlanOwner(context, row)
      const plan = await planFromRow(db, context, row)
      if (plan.planVersion !== command.action.input.planVersion)
        throw payrollProblem('stale-source', '批量工资计划版本已变化，请重新读取')
      if (plan.state !== 'ready' || plan.nextItemIndex >= plan.items.length)
        throw payrollProblem('conflict', '批量工资计划当前没有可准备的原单')
      if (await payrollRevision(db) !== plan.expectedPayrollRevision)
        throw payrollProblem('stale-source', '工资账修订已变化，批量计划须重新核对')
      const item = plan.items[plan.nextItemIndex]!
      if (item.decision.kind === 'defer')
        throw payrollProblem('conflict', '批量工资暂缓项不执行原工资命令')
      const previewInput: PayrollBatchPreviewInput = { purpose: plan.purpose, projectId: plan.projectId, month: plan.month, statementIds: [item.target.statementId], fundingAmountFen: plan.purpose === 'release' ? plan.fundingAmountFen : null }
      const latest = await previewItem(db, context, source, previewInput, item.target.statementId)
      if (latest.basis.basisHash !== item.basis.basisHash)
        throw payrollProblem('stale-source', '当前原工资依据与批量确认时不同，请重新核对')
      validateDecision(latest, item.decision, previewInput)
      const attemptId = generateId('payroll-batch-attempt')
      const payrollCommandId = generateId('payroll-batch-original')
      const original = originalCommand(context, plan.projectId, { ...latest, decision: item.decision }, payrollCommandId)
      const [attemptCount] = await db.select<{ value: number }>('SELECT COUNT(*) AS value FROM payroll_batch_attempts WHERE plan_id=? AND item_id=?', [plan.planId, item.target.itemId])
      const executeProof = { commandId: command.action.input.executeCommandId, planId: plan.planId, itemId: item.target.itemId }
      await db.execute('INSERT INTO payroll_batch_attempts(id,plan_id,item_id,attempt_no,prepare_command_id,execute_command_id,payroll_command_id,command_json,command_hash,execute_json,execute_hash,basis_hash,before_payroll_revision,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [attemptId, plan.planId, item.target.itemId, (attemptCount?.value ?? 0) + 1, command.commandId, command.action.input.executeCommandId, payrollCommandId, payrollCanonical(original), hash(original), payrollCanonical(executeProof), hash(executeProof), item.basis.basisHash, plan.expectedPayrollRevision, 'prepared', new Date().toISOString()])
      await db.execute('UPDATE payroll_batch_plans SET state=\'prepared\',revision=revision+1 WHERE id=?', [plan.planId])
      const result = await currentPlan(db, context, plan.planId)
      await saveCoordinationReceipt(db, context, command, plan.projectId, result)
      return result
    }, true)
  }

  async function executeOriginal(command: PayrollBatchExecuteCommand, sessionId?: string | null): Promise<PayrollBatchPlanRead> {
    const prepared = await run({ origin: command.origin }, sessionId, async (db, context) => {
      await initializePayrollBatchSchema(db)
      assertCommandOwner(context, command)
      const replay = await existingCoordinationReceipt(db, context, command)
      if (replay)
        return { replay, original: null, formatFamily: null, projectId: replay.projectId }
      const row = await loadPlanRow(db, command.action.input.planId)
      assertPlanOwner(context, row)
      const plan = await planFromRow(db, context, row)
      if (plan.planVersion !== command.action.input.planVersion || plan.state !== 'prepared')
        throw payrollProblem('stale-source', '批量工资准备状态或版本已变化，请重新读取')
      const [attempt] = await db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_attempts WHERE plan_id=? AND execute_command_id=? AND state=\'prepared\'', [plan.planId, command.commandId])
      if (!attempt || attempt.item_id !== plan.items[plan.nextItemIndex]?.target.itemId)
        throw payrollProblem('conflict', '批量工资执行编号与当前已准备原单不匹配')
      const original = JSON.parse(String(attempt.command_json)) as OriginalCommand
      if (hash(original) !== attempt.command_hash)
        throw payrollProblem('unavailable', '已准备的原工资命令正文与指纹不一致')
      return { replay: null, original, formatFamily: plan.items[plan.nextItemIndex]!.target.formatFamily, projectId: plan.projectId }
    }, true)
    if (prepared.replay)
      return prepared.replay
    let result: OriginalResult
    try {
      if (prepared.formatFamily === 'A')
        result = await executors.A(prepared.original as PayrollACommand, sessionId)
      else if (prepared.formatFamily === 'C1')
        result = await executors.C1(prepared.original as PayrollC1Command, sessionId)
      else
        result = await executors.C2(prepared.original as PayrollC2Command, sessionId)
    }
    catch (cause) {
      if (cause instanceof ProjectRepositoryProblem && (cause.problem as typeof cause.problem & { commandOutcome?: string }).commandOutcome === 'not-applied') {
        await run({ origin: command.origin }, sessionId, async (db, context) => {
          const row = await loadPlanRow(db, command.action.input.planId)
          assertPlanOwner(context, row)
          await db.execute('UPDATE payroll_batch_attempts SET state=\'not-applied\',problem_json=?,finished_at=? WHERE plan_id=? AND execute_command_id=? AND state=\'prepared\'', [payrollCanonical(cause.problem), new Date().toISOString(), command.action.input.planId, command.commandId])
          await db.execute('UPDATE payroll_batch_plans SET state=\'ready\',revision=revision+1 WHERE id=? AND state=\'prepared\'', [command.action.input.planId])
        }, true)
      }
      throw cause
    }
    return run({ origin: command.origin, projectId: prepared.projectId }, sessionId, async (db, context) => {
      assertCommandOwner(context, command)
      const replay = await existingCoordinationReceipt(db, context, command)
      if (replay)
        return replay
      const row = await loadPlanRow(db, command.action.input.planId)
      assertPlanOwner(context, row)
      const plan = await planFromRow(db, context, row)
      if (plan.state !== 'prepared')
        throw payrollProblem('stale-source', '批量工资执行后计划状态已变化，请重新读取')
      const [attempt] = await db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_attempts WHERE plan_id=? AND execute_command_id=? AND state=\'prepared\'', [plan.planId, command.commandId])
      const [originalReceipt] = await db.select<{ command_id: string, result_json: string }>('SELECT command_id,result_json FROM payroll_command_receipts WHERE command_id=?', [attempt?.payroll_command_id])
      if (!attempt || !originalReceipt || result.commandId !== originalReceipt.command_id)
        throw payrollProblem('unavailable', '原工资成功回执未能证明本次批量执行结果')
      const revision = await payrollRevision(db)
      const expectedOutcome = plan.purpose === 'check' ? 'checked' : 'released'
      const state = result.outcome === expectedOutcome ? expectedOutcome : 'needs-recheck'
      await db.execute('UPDATE payroll_batch_attempts SET state=?,after_payroll_revision=?,result_json=?,finished_at=? WHERE id=?', [state, revision, payrollCanonical(result), new Date().toISOString(), attempt.id])
      if (state === 'needs-recheck' || revision !== Number(attempt.before_payroll_revision) + 1) {
        await db.execute('UPDATE payroll_batch_plans SET state=\'needs-recheck\',expected_payroll_revision=?,revision=revision+1 WHERE id=?', [revision, plan.planId])
      }
      else {
        const next = nextExecutable(plan.items, plan.nextItemIndex + 1)
        await db.execute('UPDATE payroll_batch_plans SET state=?,next_item_index=?,expected_payroll_revision=?,revision=revision+1 WHERE id=?', [next >= plan.items.length ? 'complete' : 'ready', next, revision, plan.planId])
      }
      const saved = await currentPlan(db, context, plan.planId)
      await saveCoordinationReceipt(db, context, command, plan.projectId, saved)
      return saved
    }, true)
  }

  return {
    batchPreview: (query: PayrollQuery, input: PayrollBatchPreviewInput, sessionId?: string | null) => run(query, sessionId, (db, context, source) => preview(db, context, source, input)),
    batch: (query: PayrollQuery, planId: string, sessionId?: string | null) => run(query, sessionId, async (db, context) => {
      await initializePayrollBatchSchema(db)
      const [row] = await db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_plans WHERE id=?', [planId])
      if (!row)
        throw payrollProblem('not-found', '批量工资计划不存在')
      assertPlanOwner(context, row)
      if ((query.projectId && query.projectId !== row.project_id) || (query.month && query.month !== row.month))
        throw payrollProblem('relationship-mismatch', '批量工资计划不属于当前项目或月份')
      return planFromRow(db, context, row)
    }),
    executeBatch: async (command: PayrollBatchCommand, sessionId?: string | null) => {
      if (command.action.kind === 'prepare-batch-item')
        return prepare(command as PayrollBatchPrepareCommand, sessionId)
      if (command.action.kind === 'execute-batch-original')
        return executeOriginal(command as PayrollBatchExecuteCommand, sessionId)
      const confirmedCommand = command as PayrollBatchConfirmCommand
      return run({ origin: confirmedCommand.origin, projectId: confirmedCommand.action.input.projectId, month: confirmedCommand.action.input.month }, sessionId, async (db, context, source) => {
        const command = confirmedCommand
        await initializePayrollBatchSchema(db)
        assertCommandOwner(context, command)
        const replay = await existingCoordinationReceipt(db, context, command)
        if (replay)
          return replay
        const fixed = command.action.input
        const previewInput: PayrollBatchPreviewInput = { purpose: fixed.purpose, projectId: fixed.projectId, month: fixed.month, statementIds: fixed.items.map(item => item.statementId), fundingAmountFen: fixed.fundingAmountFen }
        const current = await preview(db, context, source, previewInput)
        if (current.previewVersion !== fixed.previewVersion)
          throw payrollProblem('stale-source', '批量工资预览或原工资依据已变化，请保留输入重新核对')
        if (fixed.items.length !== current.items.length || new Set(fixed.items.map(item => item.itemId)).size !== fixed.items.length)
          throw payrollProblem('validation-failed', '批量工资确认项不完整或重复')
        const planItems: PayrollBatchPlanItem[] = current.items.map((item) => {
          const selected = fixed.items.find(candidate => candidate.itemId === item.target.itemId && candidate.statementId === item.target.statementId && candidate.formatFamily === item.target.formatFamily)
          if (!selected)
            throw payrollProblem('relationship-mismatch', '批量工资确认项与固定预览不一致')
          validateDecision(item, selected.decision, previewInput)
          return { ...item, decision: selected.decision }
        })
        const releaseTotal = planItems.reduce((sum, item) => sum + (item.decision.kind === 'release' ? item.decision.actualAmountFen : 0), 0)
        if (fixed.purpose === 'release' && releaseTotal > fixed.fundingAmountFen!)
          throw payrollProblem('validation-failed', '逐单实际发放合计不能超过本期资金总额')
        const planId = generateId('payroll-batch')
        const revision = await payrollRevision(db)
        const next = nextExecutable(planItems, 0)
        const stored: StoredPlan = { schemaVersion: 1, commandId: command.commandId, planId, projectId: fixed.projectId, month: fixed.month, purpose: fixed.purpose, fundingAmountFen: fixed.fundingAmountFen, state: next >= planItems.length ? 'complete' : 'ready', preparedExecuteCommandId: null, nextItemIndex: next, expectedPayrollRevision: revision, items: planItems, reasons: [] }
        const planJson = payrollCanonical(stored)
        const planHash = hash(stored)
        const now = new Date().toISOString()
        await db.execute('INSERT INTO payroll_batch_plans(id,workspace_id,actor_id,origin,project_id,month,purpose,schema_version,plan_json,plan_hash,base_payroll_revision,expected_payroll_revision,next_item_index,revision,state,created_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [planId, context.workspaceId, context.actorId, 'real', fixed.projectId, fixed.month, fixed.purpose, 1, planJson, planHash, revision, revision, next, 1, stored.state, now, now])
        const [row] = await db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_plans WHERE id=?', [planId])
        const result = await planFromRow(db, context, row!)
        await saveCoordinationReceipt(db, context, command, fixed.projectId, result)
        return result
      }, true)
    },
  }
}
