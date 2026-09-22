import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollNumberingDocument, PayrollNumberingSettings, PayrollOfficialIssue } from '../../app/lib/payroll/central-numbering-contract'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollNumberingHash as hash, numberingIssue, numberingReceipt, numberingSettings } from './payroll-numbering-data'

export interface PayrollNumberingProof {
  settings: Map<string, PayrollNumberingSettings>
  issues: Map<string, { issue: PayrollOfficialIssue, documentHash: string }>
  receipts: Set<string>
}
export const emptyPayrollNumberingProof = (): PayrollNumberingProof => ({ settings: new Map(), issues: new Map(), receipts: new Set() })
function invalid(message: string): never {
  throw payrollProblem('unavailable', `正式编号${message}，请先核对原记录，不能猜号或重置`)
}
const sameSettings = (left: PayrollNumberingSettings, right: PayrollNumberingSettings) => hash({ ...left, nextNumber: 0 }) === hash({ ...right, nextNumber: 0 })

/** 原子序列必须由原初始化、出具回执和冻结原工资交叉证明；迁入原 JSON 在原身份空间验证。 */
export async function provePayrollNumberingState(tx: TransactionDb, projectId: string, documents: ReadonlyMap<string, PayrollNumberingDocument>, inherited = emptyPayrollNumberingProof()): Promise<PayrollNumberingProof> {
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_numbering_settings\'')).length)
    return inherited
  const result = emptyPayrollNumberingProof()
  const settings = (await tx.select<Record<string, unknown>>('SELECT * FROM payroll_numbering_settings WHERE project_id=?', [projectId])).map(numberingSettings)
  const issues = (await tx.select<Record<string, unknown>>('SELECT * FROM payroll_official_issues WHERE project_id=?', [projectId])).map(numberingIssue)
  const receiptRows = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE project_id=? AND action IN (\'numbering-initialize\',\'numbering-issue\')', [projectId])
  // 迁入回执保留原 JSON，物理列已映射；交给已验证的祖先证明，不能再按本空间解析它。
  const nativeRows = receiptRows.filter(row => !inherited.receipts.has(String(row.command_id)))
  const receipts = nativeRows.map(numberingReceipt)
  if (!settings.length) {
    if (issues.length || receiptRows.length)
      invalid('起点缺失')
    return result
  }
  if (settings.length !== 1)
    invalid('项目起点重复')
  const current = settings[0]!
  const ancestor = inherited.settings.get(projectId)
  const initializes = receipts.filter(row => row.command.action.kind === 'initialize')
  if (ancestor ? initializes.length !== 0 || !sameSettings(current, ancestor) : initializes.length !== 1 || !sameSettings(current, initializes[0]!.result.settings))
    invalid('起点与原回执不一致')
  const base = ancestor ?? initializes[0]!.result.settings
  let nextNumber = base.nextNumber
  const numbers = new Set<number>()
  for (const original of issues) {
    const ordinal = Number(original.number)
    if (numbers.has(ordinal))
      invalid('旧号重复，须人工核对')
    numbers.add(ordinal)
    const document = documents.get(original.statementId)
    if (!document || document.projectId !== projectId || document.formatFamily !== original.formatFamily)
      invalid('原工资缺少完整冻结来源')
    const prior = inherited.issues.get(original.statementId)
    if (prior) {
      if (hash(prior.issue) !== hash(original) || prior.documentHash !== hash(document))
        invalid('迁入原号与冻结来源不一致')
      result.issues.set(original.statementId, prior)
      continue
    }
    const receipt = receipts.find(row => row.command.commandId === original.commandId)
    if (!receipt || receipt.command.action.kind !== 'issue' || hash(receipt.result.issue) !== hash(original) || original.documentHash !== hash(document)
      || original.operatorId !== receipt.command.actorId || ordinal < base.nextNumber || ordinal >= current.nextNumber
      || receipt.result.settings.nextNumber !== ordinal + 1) {
      invalid('出具记录、序列或原件不一致')
    }
    nextNumber++
    result.issues.set(original.statementId, { issue: original, documentHash: hash(document) })
  }
  for (const row of inherited.issues.values()) {
    if (row.issue.projectId === projectId && !result.issues.has(row.issue.statementId))
      invalid('迁入原号已缺失')
  }
  if (nextNumber !== current.nextNumber)
    invalid('序列与成功出具数量不一致')
  for (const receipt of receipts) {
    if (!sameSettings(current, receipt.result.settings) || receipt.result.settings.nextNumber > current.nextNumber)
      invalid('回执与项目起点不一致')
    if (receipt.result.issue && hash(result.issues.get(receipt.result.issue.statementId)?.issue) !== hash(receipt.result.issue))
      invalid('回执引用的原号缺失')
  }
  for (const row of receiptRows) result.receipts.add(String(row.command_id))
  result.settings.set(projectId, current)
  return result
}
