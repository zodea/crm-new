import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAContext, PayrollAFormInput, PayrollAFormRead } from '../../app/lib/payroll/central-a-contract'
import type { PayrollAFeeConfigScope, PayrollAFeesCommand, PayrollAFeesCommandResult, PayrollAManagementScope } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollQuery } from '../../app/lib/payroll/central-contract'
import type { PayrollIdentitySource, PayrollRun, PayrollServiceOptions } from './payroll-service'
import { payrollACanonical, payrollAMoney } from '../../app/lib/payroll/central-a-calculation'
import { payrollACalculationVersion, payrollAWriteRow, persistPayrollACalculation } from '../../app/lib/payroll/central-a-command'
import { payrollAManagementContains } from '../../app/lib/payroll/central-a-fees-calculation'
import { decodePayrollAFeesResult, encodePayrollAFeesWire, parsePayrollAFeesCommand } from '../../app/lib/payroll/central-a-fees-codec'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { assertPayrollAMonth, assertPayrollARatio } from '../../app/lib/payroll/central-a-prices'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { samePayrollABook } from './payroll-a-book'
import { loadPayrollAFeeRevisions, loadPayrollAManagementBooks, loadPayrollAManagementRevisions, loadPayrollANegativeLines } from './payroll-a-fees-data'
import { assertPayrollAFeeAdoption, assertPayrollAFeeMonth, payrollAManagementScopeCurrent } from './payroll-a-fees-policy'
import { payrollAFeesHash, readPayrollAFeeConfig } from './payroll-a-fees-read'
import { loadPayrollActualFacts } from './payroll-actual-facts'

export function createPayrollAFeesService(run: PayrollRun, options: PayrollServiceOptions, form: (db: TransactionDb, context: PayrollAContext, source: PayrollIdentitySource, input: PayrollAFormInput) => Promise<PayrollAFormRead>) {
  async function config(db: TransactionDb, context: PayrollAContext, source: PayrollIdentitySource, scope: PayrollAFeeConfigScope) {
    assertPayrollAMonth(scope.month)
    if (!options.quantityFacts)
      throw payrollProblem('unavailable', '费用现场量来源尚未连接')
    return readPayrollAFeeConfig(db, context, source, scope, await options.quantityFacts(db, scope), options)
  }
  return {
    aFeeConfig: (query: PayrollQuery, scope: PayrollAFeeConfigScope, sessionId?: string | null) => run(query, sessionId, (db, context, source) => config(db, context, source, scope)),
    async executeFees(input: PayrollAFeesCommand, sessionId?: string | null): Promise<PayrollAFeesCommandResult> {
      const command = parsePayrollAFeesCommand(encodePayrollAFeesWire(input))
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (db, context, source) => {
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
            throw payrollProblem('forbidden', '费用提交身份已变化')
          const fingerprint = payrollAFeesHash(command)
          const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== context.actorId)
              throw payrollProblem('conflict', '同一费用提交编号不能改用其他内容')
            return decodePayrollAFeesResult(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const result: PayrollAFeesCommandResult = { commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, subjectConfigId: null, priceRevisionIds: [], sourceVersion: '', outcome: 'saved', logIds: [], book: command.book, managementBookId: command.book.managementBookId, managementRevisionId: null, feeRevisionIds: [], negativeLineRevisionIds: [], locatedExistingDraft: false }
          const [start] = await db.select<{ value: number }>('SELECT COALESCE(MAX(rowid),0) AS value FROM operation_logs')
          const a = command.action
          if (a.kind === 'save-a-negative-lines') {
            if (!command.statementId || command.configScope !== null || command.draftKey !== null || command.book.bookPurpose !== 'management')
              throw payrollProblem('relationship-mismatch', '负价修订必须绑定原管理草稿')
            const read = await form(db, context, source, { statementId: command.statementId })
            if (!hasPayrollAFeesForm(read) || !read.fees?.management || read.draft.projectId !== command.projectId || !read.book || !samePayrollABook(read.book, command.book) || !['draft', 'checked'].includes(read.status))
              throw payrollProblem('conflict', '已发或未核实的管理单不能修改负价')
            if (read.context.sourceVersion !== command.sourceVersion || a.baseVersion !== read.context.sourceVersion)
              throw payrollProblem('stale-source', '管理单或负价依据已变化，请保留输入重新读取')
            const originalScope = read.fees.management.revision.scope
            const current = a.lines.length ? await options.managementScopeFacts?.(db, { projectId: command.projectId }, context) : null
            const all = await loadPayrollANegativeLines(db, command.statementId)
            const changed = new Set<string>()
            for (const item of [...a.lines, ...a.remove.map((r) => {
              const old = all.find(n => n.lineId === r.lineId && n.id === r.baseRevisionId)
              if (!old)
                throw payrollProblem('stale-source', '原负价修订不存在')
              return { ...old, baseRevisionId: old.id, removed: true }
            })]) {
              const removing = 'removed' in item && item.removed
              const old = item.lineId ? all.filter(n => n.lineId === item.lineId).sort((x, y) => y.revision - x.revision)[0] : null
              if (item.lineId ? !old || old.id !== item.baseRevisionId || changed.has(item.lineId) : item.baseRevisionId !== null)
                throw payrollProblem('stale-source', '负价行身份或修订已变化')
              if (old && (old.statementId !== command.statementId || old.projectId !== command.projectId || old.managementBookId !== command.book.managementBookId || (removing && old.removed)))
                throw payrollProblem('relationship-mismatch', '负价移除或修订须绑定未移除的原管理单行')
              if (item.lineId)
                changed.add(item.lineId)
              if (!removing) {
                if (!current || current.reasons.length)
                  throw payrollProblem('unavailable', '原管理责任范围当前无法核实')
                if (!item.label.trim() || !item.reason.trim() || !item.evidenceNote.trim() || !item.unit?.trim() || item.quantity === null || item.quantity < 0 || item.unitPrice === null || item.unitPrice >= 0 || !item.scope.assignments.length)
                  throw payrollProblem('validation-failed', '负价须明确数量、单位、负单价、原范围、原因与依据')
                for (const selected of item.scope.assignments) {
                  const origin = current.responsibilityOptions.find(o => o.assignmentId === selected.assignmentId && o.eligible)
                  if (!origin || !selected.cells.length || selected.scopeIds.some(id => !origin.scopeIds.includes(id)) || selected.cells.some(c => !payrollAManagementContains(originalScope, { assignmentId: selected.assignmentId, ...c }) || !origin.cells.some(o => payrollACanonical(o) === payrollACanonical(c))))
                    throw payrollProblem('relationship-mismatch', '负价依据超出原管理范围或已失效')
                  const units = await db.select<{ id: string, unit: string | null }>('SELECT id,unit FROM items WHERE project_id=? AND deleted_at IS NULL', [command.projectId])
                  if (selected.cells.some(c => !units.some(u => u.id === c.itemId && u.unit === item.unit)))
                    throw payrollProblem('relationship-mismatch', '负价数量的单位与所选原分项范围不一致')
                }
                if (item.actualRef) {
                  const actual = await loadPayrollActualFacts(db, { projectId: command.projectId })
                  if (!actual.rows.some(r => r.qualification === 'proven' && r.projectId === command.projectId && payrollACanonical(r.ref) === payrollACanonical(item.actualRef)))
                    throw payrollProblem('relationship-mismatch', '负价所引用实际事实未获证明或不属于本项目')
                }
              }
              const id = generateId('negative-revision')
              await payrollAWriteRow(db, 'payroll_a_negative_lines', id, { line_id: old?.lineId ?? generateId('negative-line'), statement_id: command.statementId, project_id: command.projectId, management_book_id: command.book.managementBookId, management_revision_id: removing ? old!.managementRevisionId : read.fees.management.revision.id, revision: (old?.revision ?? 0) + 1, label: item.label, quantity: item.quantity, unit: item.unit, unit_price: item.unitPrice, signed_amount_fen: removing ? old!.signedAmountFen : Math.round(payrollAMoney(item.quantity! * item.unitPrice!) * 100), scope_json: payrollACanonical(item.scope), reason: item.reason, evidence_note: item.evidenceNote, actual_ref_json: payrollACanonical(item.actualRef), removed: Number(removing), operator_id: context.actorId, created_at: new Date().toISOString() }, context.actorId)
              result.negativeLineRevisionIds.push(id)
            }
            await payrollAWriteRow(db, 'wage_statements', command.statementId, { needs_recheck: Number(read.status === 'checked'), updated_at: new Date().toISOString() }, context.actorId)
            result.outcome = read.status === 'checked' ? 'needs-recheck' : 'saved'
          }
          else {
            const scope = command.configScope
            if (!scope || scope.projectId !== command.projectId || !samePayrollABook(scope.book, command.book) || command.statementId !== null || command.draftKey !== null)
              throw payrollProblem('relationship-mismatch', '费用配置缺少固定范围')
            const read = await config(db, context, source, scope)
            if (command.sourceVersion !== read.context.sourceVersion || a.baseVersion !== read.baseVersion)
              throw payrollProblem('stale-source', '费用配置或原责任已变化，请保留输入重新读取')
            const onlyRemovingFees = a.kind === 'save-a-fees' && !a.fees.length && a.remove.length > 0
            if (!scope.leaderWorkerId || (!onlyRemovingFees && (!read.options.workers.some(w => w.id === scope.leaderWorkerId) || (scope.crewId !== null && !source.crews.some(c => c.id === scope.crewId)))))
              throw payrollProblem('relationship-mismatch', '费用请款主体不属于当前项目责任')
            const validateScope = (value: PayrollAManagementScope) => {
              if (!read.eligibility.canSaveManagementBook || !payrollAManagementScopeCurrent(value, read.responsibilityOptions))
                throw payrollProblem('relationship-mismatch', '管理责任范围不是当前可证明的原责任单元')
            }
            if (a.kind === 'save-a-fees') {
              if (!read.eligibility.canSaveFees)
                throw payrollProblem('conflict', read.eligibility.feeReasons[0] ?? '当前费用配置不可修改')
              if (a.fees.length && scope.book.bookPurpose === 'management' && !read.managementBooks.some(m => m.book.id === scope.book.managementBookId && m.book.managerWorkerId === scope.leaderWorkerId && m.eligible))
                throw payrollProblem('relationship-mismatch', '管理费用须属于当前有效管理簿与管理人')
              const all = await loadPayrollAFeeRevisions(db, scope.projectId)
              const changedFees = new Set<string>()
              for (const item of [...a.fees, ...a.remove.map((r) => {
                const old = all.find(f => f.id === r.baseRevisionId && f.feeId === r.feeId)
                if (!old)
                  throw payrollProblem('stale-source', '待移除费用修订已变化')
                return { ...old, baseRevisionId: old.id, effectiveMonth: old.effectiveMonth > scope.month ? old.effectiveMonth : scope.month, removed: true }
              })]) {
                const removing = 'removed' in item && item.removed
                await assertPayrollAFeeMonth(db, scope, item.effectiveMonth)
                if (item.feeId && changedFees.has(item.feeId))
                  throw payrollProblem('validation-failed', '同一费用不能在本次保存中重复修订或移除')
                if (item.feeId)
                  changedFees.add(item.feeId)
                if (!samePayrollABook(item, scope.book))
                  throw payrollProblem('relationship-mismatch', '费用用途与请款簿不一致')
                const old = item.feeId ? all.filter(f => f.feeId === item.feeId).sort((x, y) => y.revision - x.revision)[0] : null
                if (item.feeId ? !old || old.id !== item.baseRevisionId || old.leaderWorkerId !== scope.leaderWorkerId || !samePayrollABook(old, item) : item.baseRevisionId !== null)
                  throw payrollProblem('stale-source', '费用修订身份已变化')
                if (removing && (!old || old.projectId !== scope.projectId || old.crewId !== scope.crewId || old.removed))
                  throw payrollProblem('relationship-mismatch', '费用移除须保留未移除的原主体与原簿归属')
                if (!removing) {
                  assertPayrollAFeeAdoption(item, read, old)
                  if (!item.name.trim() || (item.unitPrice !== null && (item.unitPrice < 0 || Math.abs(item.unitPrice * 100 - Math.round(item.unitPrice * 100)) > 1e-8)) || !item.basis.itemIds.length || new Set(item.basis.itemIds).size !== item.basis.itemIds.length || (item.basis.scope.kind === 'cells' && !item.basis.scope.cells.length))
                    throw payrollProblem('validation-failed', '请填写费用名称、非负单价及明确分项基数')
                  if (item.basis.itemIds.some(id => !read.items.some(i => i.itemId === id && i.unit === item.unit)) || (item.basis.scope.kind === 'cells' && item.basis.scope.cells.some(c => !read.cellOptions.some(o => o.unitId === c.unitId && o.roomId === c.roomId && o.itemId === c.itemId))))
                    throw payrollProblem('relationship-mismatch', '费用分项、单位或细分范围不一致')
                }
                const id = generateId('fee-revision')
                await payrollAWriteRow(db, 'payroll_a_fee_revisions', id, { fee_id: old?.feeId ?? generateId('fee'), project_id: scope.projectId, crew_id: scope.crewId, leader_worker_id: scope.leaderWorkerId, book_purpose: item.bookPurpose, management_book_id: item.managementBookId, kind: item.kind, name: item.name, enabled: Number(item.enabled), unit_price: item.unitPrice, unit: item.unit, basis_json: payrollACanonical(item.basis), effective_month: item.effectiveMonth, adopted_default_json: payrollACanonical(item.adoptedDefault), revision: (old?.revision ?? 0) + 1, removed: Number('removed' in item && item.removed), operator_id: context.actorId, created_at: new Date().toISOString() }, context.actorId)
                result.feeRevisionIds.push(id)
              }
            }
            else if (a.kind === 'save-a-management-book') {
              const m = a.management
              if (m.effectiveMonth < scope.month)
                throw payrollProblem('validation-failed', '管理配置不能倒改此前月份')
              validateScope(m.scope)
              assertPayrollARatio(m.initialPayRatio)
              if (m.managementMode === 'crew-managed' && !source.workers.some(w => w.id === m.managerWorkerId))
                throw payrollProblem('relationship-mismatch', '请明确有效的管理人')
              const old = (await loadPayrollAManagementBooks(db, scope.projectId)).find(b => b.id === m.managementBookId)
              const previous = old ? (await loadPayrollAManagementRevisions(db, scope.projectId)).filter(r => r.managementBookId === old.id).sort((x, y) => y.revision - x.revision)[0] : null
              if (old)
                await assertPayrollAFeeMonth(db, { ...scope, leaderWorkerId: old.managerWorkerId, book: { bookPurpose: 'management', managementBookId: old.id } }, m.effectiveMonth)
              if (m.managementBookId ? !old || old.managerWorkerId !== m.managerWorkerId || previous?.id !== m.baseRevisionId : m.baseRevisionId !== null)
                throw payrollProblem('stale-source', '管理簿身份或修订已变化；换管理人须新建独立簿')
              result.managementBookId = old?.id ?? generateId('management-book')
              if (!old)
                await payrollAWriteRow(db, 'payroll_a_management_books', result.managementBookId, { project_id: scope.projectId, manager_worker_id: m.managerWorkerId, created_by: context.actorId, created_at: new Date().toISOString(), deleted_at: null }, context.actorId)
              result.managementRevisionId = generateId('management-revision')
              await payrollAWriteRow(db, 'payroll_a_management_book_revisions', result.managementRevisionId, { management_book_id: result.managementBookId, project_id: scope.projectId, revision: (previous?.revision ?? 0) + 1, effective_month: m.effectiveMonth, management_mode: m.managementMode, scope_json: payrollACanonical(m.scope), initial_pay_ratio: m.initialPayRatio, evidence_note: m.evidenceNote, source_version: read.baseVersion, operator_id: context.actorId, created_at: new Date().toISOString() }, context.actorId)
            }
            else {
              const selected = read.managementBooks.find(b => b.book.id === a.managementBookId && b.revision?.id === a.managementRevisionId && b.eligible)
              if (!selected || !selected.book.managerWorkerId || a.month !== scope.month)
                throw payrollProblem('relationship-mismatch', '管理簿或生效期间已变化')
              const existing = await db.select<{ statement_id: string }>('SELECT statement_id FROM payroll_a_statement_books WHERE management_book_id=? AND month=? AND period_kind=?', [a.managementBookId, a.month, a.periodKind])
              if (existing[0]) {
                const [head] = await db.select<{ status: string, deleted_at: string | null }>('SELECT status,deleted_at FROM wage_statements WHERE id=?', [existing[0].statement_id])
                if (!head || head.status === 'released' || head.deleted_at !== null)
                  throw payrollProblem('conflict', '该管理簿期间已有已发或归档记录')
                result.statementId = existing[0].statement_id
                result.locatedExistingDraft = true
              }
              else {
                const book = { bookPurpose: 'management' as const, managementBookId: selected.book.id }
                const draft = { projectId: scope.projectId, crewId: scope.crewId, leaderWorkerId: selected.book.managerWorkerId, memberWorkerIds: [selected.book.managerWorkerId], month: a.month, periodKind: a.periodKind, note: '', book }
                const next = await form(db, context, source, { statementId: null, draftKey: command.commandId, draft })
                if (!next.eligibility.canSaveDraft)
                  throw payrollProblem('validation-failed', next.blockers[0]?.message ?? '管理单依据不完整')
                result.statementId = generateId('wage')
                await persistPayrollACalculation(db, result.statementId, next, payrollAFeesHash(payrollACalculationVersion(next, source)), 'draft', context.actorId)
                result.book = book
              }
            }
          }
          await advancePayrollRevision(db)
          result.sourceVersion = `payroll:${await payrollRevision(db)}`
          result.logIds = (await db.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid>? ORDER BY rowid', [start?.value ?? 0])).map(r => r.id)
          await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, result.statementId, command.configScope === null ? null : payrollACanonical(command.configScope), a.kind, fingerprint, JSON.stringify(result), payrollACanonical(command)])
          return result
        }, true)
      }
      catch (cause) {
        if (absent && cause instanceof ProjectRepositoryProblem)
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      }
    },
  }
}
