import type { TransactionDb } from '../../app/lib/db/coordinator'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { financeCanonical, financeCommandFingerprint } from './production-finance-request'

type Row = Record<string, unknown>
export function isMissingClearanceOriginal(tables: Record<string, Row[]>, row: Row): boolean {
  if (row.owner_type !== 'expense_reimbursement' || typeof row.file_path !== 'string' || !row.file_path)
    return false
  const header = tables.expense_reimbursements?.find(head => head.id === row.owner_id)
  const lines = tables.expense_reimbursement_lines?.filter(line => line.reimbursement_id === row.owner_id) ?? []
  return Boolean(header && header.status === 'confirmed' && lines.length && lines.every((line) => {
    if (!line.original_expense_line_id)
      return false
    const original = tables.expense_reimbursement_lines?.find(original => original.id === line.original_expense_line_id)
    const owner = original && tables.expense_reimbursements?.find(head => head.id === original.reimbursement_id)
    return original && owner && original.original_expense_line_id === null && owner.status === 'confirmed' && original.reimbursement_id !== header.id && owner.project_id === header.project_id && owner.applicant_supplier_id === header.applicant_supplier_id && owner.applicant_worker_id === header.applicant_worker_id
  }))
}
export async function declaredMissingClearanceOriginals(tx: Pick<TransactionDb, 'select'>, ownerId?: string) {
  const imports = await tx.select<{ evidence_json: string }>('SELECT evidence_json FROM finance_imports ORDER BY imported_at,id')
  const files: Array<{ id: string, fileName: string, filePath: string, fileSize: number | null, ownerId: string, reason: string, sourceBytesSha256: string, row: Row }> = []
  for (const imported of imports) {
    const evidence = JSON.parse(imported.evidence_json)
    for (const file of evidence.files ?? []) {
      if (file.bodyState !== 'declared-missing-clearance' || (ownerId !== undefined && file.row.owner_id !== ownerId))
        continue
      const declaration = evidence.requestProof?.declaredMissingOriginals?.find((item: { fileId: string }) => item.fileId === file.id)
      if (!declaration || !isMissingClearanceOriginal(evidence.sourceTables, file.row))
        financeFailure('unavailable', '原清偿缺件声明缺少完整来源与明确清偿关系。')
      files.push({ id: String(file.id), fileName: String(file.row.file_name), filePath: String(file.row.file_path), fileSize: file.row.file_size === null ? null : Number(file.row.file_size), ownerId: String(file.row.owner_id), reason: declaration.reason, sourceBytesSha256: evidence.sourceBytesSha256, row: file.row })
    }
  }
  return files
}
/** Precise native missing originals only; never authorizes a missing original expense, bank voucher or damaged central body. */
export async function validateDeclaredMissingClearanceOriginals(tx: Pick<TransactionDb, 'select'>, evidence: Row): Promise<ReadonlySet<string>> {
  const request = evidence.requestProof as Row
  const declarations = request.declaredMissingOriginals as Array<{ fileId: string, reason: string }> | undefined
  if (declarations === undefined)
    return new Set()
  if (!Array.isArray(declarations) || declarations.some(item => !item || Object.keys(item).sort().join(',') !== 'fileId,reason' || typeof item.fileId !== 'string' || typeof item.reason !== 'string' || !item.reason.trim()) || new Set(declarations.map(item => item.fileId)).size !== declarations.length)
    financeFailure('unavailable', '原清偿精确缺件声明损坏。')
  const files = evidence.files as Row[]
  const sourceGraph = evidence.sourceGraph as Row
  if (!sourceGraph || financeCommandFingerprint(sourceGraph) !== request.sourceGraphSha256 || financeCanonical(sourceGraph.tables) !== financeCanonical(evidence.sourceTables) || financeCanonical(sourceGraph.journals) !== financeCanonical(evidence.sourceJournals))
    financeFailure('unavailable', '声明缺件的完整财务来源图摘要不一致。')
  const set = new Set<string>()
  for (const declaration of declarations) {
    const file = files.find(file => file.id === declaration.fileId)
    const row = file?.row as Row | undefined
    const sourceFile = (sourceGraph.files as Row[])?.find(source => (source.row as Row)?.id === declaration.fileId)
    if (!file || !row || file.bodyState !== 'declared-missing-clearance' || file.sha256 !== null || !isMissingClearanceOriginal(evidence.sourceTables as Record<string, Row[]>, row) || !sourceFile || sourceFile.bodyState !== 'external-required' || sourceFile.payloadSha256 !== null || financeCanonical(sourceFile.row) !== financeCanonical(row))
      financeFailure('unavailable', '缺件豁免不属于真实原清偿外部原单，不能放宽其他原件。')
    const current = (await tx.select<Row>('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [row.id]))[0]
    if (row.file_size === null) {
      if (current)
        financeFailure('unavailable', '未知原件大小不能被伪造为当前真实零或替代大小。')
    }
    else if (!current || current.content !== null || current.sha256 !== null || ['id', 'owner_type', 'owner_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'category', 'uploader', 'uploaded_at', 'deleted_at'].some(key => current[key] !== row[key])) {
      financeFailure('unavailable', '声明缺件的原元数据、原路径或原大小被改写。')
    }
    const head = (await tx.select<Row>('SELECT id FROM expense_reimbursements WHERE id=?', [row.owner_id]))[0]
    if (!head)
      financeFailure('unavailable', '原清偿缺件失去真实费用头。')
    set.add(declaration.fileId)
  }
  if (files.some(file => file.bodyState === 'declared-missing-clearance' && !set.has(String(file.id))))
    financeFailure('unavailable', '原清偿缺件没有逐件明确声明。')
  return set
}
