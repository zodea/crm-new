import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollContext, PayrollQuery } from '../../app/lib/payroll/central-contract'
import type { PayrollNumberingCommand, PayrollNumberingDocument, PayrollNumberingInput, PayrollNumberingRead, PayrollNumberingResult } from '../../app/lib/payroll/central-numbering-contract'
import type { PayrollIdentitySource, PayrollRun } from './payroll-service'
import { createHash } from 'node:crypto'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { parsePayrollNumberingCommand, parsePayrollNumberingInput } from '../../app/lib/payroll/central-numbering-codec'
import { initializePayrollNumberingSchema } from '../../app/lib/payroll/central-numbering-schema'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollAReleasedWithMigration } from './payroll-a-released-with-migration'
import { loadPayrollC1ReleasedWithMigration, loadPayrollC2ReleasedWithMigration } from './payroll-c-released-with-migration'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { numberingIssue as issue, numberingReceipt, numberingSettings as settings } from './payroll-numbering-data'
import { provePayrollNumberingState } from './payroll-numbering-facts'

type Row = Record<string, string | number>
const hash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
async function frozen(db: TransactionDb, projectId: string, statementId: string, documents: ReadonlyMap<string, PayrollNumberingDocument>): Promise<PayrollNumberingDocument | null> {
  const [head] = await db.select<{ id: string, project_id: string, format_family: string, status: string, deleted_at: string | null }>('SELECT id,project_id,format_family,status,deleted_at FROM wage_statements WHERE id=?', [statementId])
  if (!head || head.project_id !== projectId)
    throw payrollProblem('relationship-mismatch', '原工资不存在或不属于指定项目')
  if (head.status !== 'released' || !['A', 'C1', 'C2'].includes(head.format_family))
    return null
  return documents.get(statementId) ?? null
}
async function readNumbering(db: TransactionDb, context: PayrollContext, source: PayrollIdentitySource, input: PayrollNumberingInput, verify = true): Promise<PayrollNumberingRead> {
  await initializePayrollNumberingSchema(db)
  const [stored] = await db.select<Row>('SELECT * FROM payroll_numbering_settings WHERE project_id=?', [input.projectId])
  const [issued] = input.statementId ? await db.select<Row>('SELECT * FROM payroll_official_issues WHERE statement_id=?', [input.statementId]) : []
  const migrated = await loadPayrollMigratedProof(db, input.projectId)
  const documents = new Map<string, PayrollNumberingDocument>([...migrated.aDocuments, ...migrated.c1Documents, ...migrated.c2Documents, ...await loadPayrollAReleasedWithMigration(db), ...await loadPayrollC1ReleasedWithMigration(db), ...await loadPayrollC2ReleasedWithMigration(db)])
  const proof = verify ? await provePayrollNumberingState(db, input.projectId, documents, migrated.numbering) : null
  const document = input.statementId ? await frozen(db, input.projectId, input.statementId, documents) : null
  const current = stored ? settings(stored) : null
  const original = issued ? issue(issued) : null
  const validIssue = !!original && !!document && original.projectId === input.projectId && (proof ? proof.issues.get(original.statementId)?.documentHash === hash(document) : original.documentHash === hash(document) || migrated.numbering.issues.get(original.statementId)?.documentHash === hash(document))
  const [head] = input.statementId ? await db.select<{ deleted_at: string | null }>('SELECT deleted_at FROM wage_statements WHERE id=?', [input.statementId]) : []
  const reasons = [
    ...(!source.projects.some(project => project.id === input.projectId) ? ['项目当前不可操作，请从项目入口重新核对'] : []),
    ...(!context.capabilities.includes('payroll:write') ? ['当前身份只能阅读工资'] : []),
    ...(!current ? ['请先登记项目旧纸号起点'] : []),
    ...(current && !original && current.nextNumber >= Number.MAX_SAFE_INTEGER - 1 ? ['项目序列已达到支持上限，不能新增正式出具'] : []),
    ...(!input.statementId ? ['请选择一张已发工资预览'] : !document ? ['原工资缺少完整可证明的冻结来源，不能正式出具'] : []),
    ...(!original && head?.deleted_at ? ['原工资已作废或删除，不能新增正式出具'] : []),
    ...(original && !validIssue ? ['原正式出具与冻结工资依据不一致，停止输出并核对来源'] : []),
  ]
  const version = `${context.sourceVersion}+numbering:${hash({ input, current, original, document })}`
  return { context: { ...context, readonly: !context.capabilities.includes('payroll:write'), sourceVersion: version }, input, settings: current, issue: original, document, eligibility: { canInitialize: !current && source.projects.some(project => project.id === input.projectId) && context.capabilities.includes('payroll:write'), canIssue: !reasons.length, canDownload: validIssue, reasons } }
}
export function createPayrollNumberingService(run: PayrollRun) {
  return {
    numbering(query: PayrollQuery, value: PayrollNumberingInput, sessionId?: string | null) {
      const input = parsePayrollNumberingInput(value)
      if (query.projectId && query.projectId !== input.projectId)
        throw payrollProblem('relationship-mismatch', '编号项目与读取范围不一致')
      return run({ ...query, projectId: input.projectId }, sessionId, (db, context, source) => readNumbering(db, context, source, input))
    },
    async executeNumbering(value: PayrollNumberingCommand, sessionId?: string | null): Promise<PayrollNumberingResult> {
      const command = parsePayrollNumberingCommand(value)
      let absent = false
      try {
        return await run({ origin: command.origin, projectId: command.projectId }, sessionId, async (db, context, source) => {
          await initializePayrollNumberingSchema(db)
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
            throw payrollProblem('forbidden', '编号提交与当前工作区或身份不一致')
          const [receipt] = await db.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== hash(command) || receipt.actor_id !== context.actorId)
              throw payrollProblem('conflict', '同一编号提交不能改用其他内容')
            const result = numberingReceipt(receipt).result
            await readNumbering(db, context, source, { projectId: command.projectId, statementId: command.statementId })
            return result
          }
          absent = true
          const input = { projectId: command.projectId, statementId: command.statementId }
          const read = await readNumbering(db, context, source, input)
          if (read.context.sourceVersion !== command.sourceVersion)
            throw payrollProblem('stale-source', '项目编号或工资来源已变化，请保留输入重新核对')
          if (command.action.kind === 'initialize') {
            if (!read.eligibility.canInitialize)
              throw payrollProblem('conflict', '项目起点已经登记或当前无权操作，不能重置序列')
            await payrollWriteRow(db, 'payroll_numbering_settings', generateId('payroll-numbering'), { project_id: command.projectId, first_number: command.action.nextNumber, next_number: command.action.nextNumber, evidence_note: command.action.evidenceNote.trim(), initialized_at: new Date().toISOString(), operator_id: context.actorId }, context.actorId)
          }
          else {
            if (!read.eligibility.canIssue || !read.settings || !read.document)
              throw payrollProblem('validation-failed', read.eligibility.reasons[0] ?? '当前工资不能正式出具')
            if (!read.issue) {
              if (read.settings.nextNumber >= Number.MAX_SAFE_INTEGER - 1)
                throw payrollProblem('validation-failed', '正式编号已超出可安全表示的范围')
              const formatFamily = read.document.formatFamily
              await payrollWriteRow(db, 'payroll_official_issues', generateId('payroll-official'), { project_id: command.projectId, statement_id: command.statementId, format_family: formatFamily, official_number: String(read.settings.nextNumber), document_hash: hash(read.document), issued_at: new Date().toISOString(), operator_id: context.actorId, command_id: command.commandId }, context.actorId)
              await payrollWriteRow(db, 'payroll_numbering_settings', read.settings.id, { next_number: read.settings.nextNumber + 1 }, context.actorId)
            }
          }
          await advancePayrollRevision(db)
          const after = await readNumbering(db, { ...context, sourceVersion: `payroll:${await payrollRevision(db)}` }, source, input, false)
          const result: PayrollNumberingResult = { schemaVersion: 1, commandId: command.commandId, settings: after.settings!, issue: after.issue, sourceVersion: after.context.sourceVersion }
          await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, command.statementId, null, `numbering-${command.action.kind}`, hash(command), payrollCanonical(result), payrollCanonical(command)])
          await readNumbering(db, context, source, input)
          return result
        }, true, command)
      }
      catch (cause) {
        if (absent && cause instanceof ProjectRepositoryProblem)
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      }
    },
  }
}
