import type { TransactionDb } from '../db/coordinator'
import type { OtherSettlementResult, OtherSettlementStored } from './contract'
import { auxiliaryProblem } from '../auxiliary-contract/contract'
import { contractOriginalPayloadDigest } from '../forms/original-content'
import { decodeOtherSettlementCommand, decodeOtherSettlementDraft } from './validation'

export function otherSettlementKey(commandId: string, identity: {
  workspaceId: string
  actorId: string
}) {
  return JSON.stringify([identity.workspaceId, identity.actorId, 'other-settlement', commandId])
}
export function otherSettlementFingerprint(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(otherSettlementFingerprint).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${otherSettlementFingerprint(v)}`).join(',')}}`
  return JSON.stringify(value)
}
function fail(message: string): never {
  throw auxiliaryProblem('unavailable', message)
}
export function decodeOtherSettlementResult(value: unknown): OtherSettlementResult {
  const row = value as OtherSettlementResult
  if (!row || typeof row.id !== 'string' || !row.id || !(row.clearanceLinkIds?.length ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(row.version) || !row.commandId || !Number.isFinite(Date.parse(row.updatedAt)) || !Array.isArray(row.attachmentIds) || row.attachmentIds.some(id => typeof id !== 'string' || !id) || new Set(row.attachmentIds).size !== row.attachmentIds.length || (row.clearanceLinkIds !== undefined && (!Array.isArray(row.clearanceLinkIds) || row.clearanceLinkIds.some(id => typeof id !== 'string' || !id) || new Set(row.clearanceLinkIds).size !== row.clearanceLinkIds.length)))
    return fail('结算原回执损坏，不能换号重写')
  return row
}
export async function readOtherSettlementStored(tx: TransactionDb, identity: {
  workspaceId: string
}): Promise<{
  records: OtherSettlementStored[]
  revision: number
}> {
  const revision = (await tx.select<{
    revision: number
  }>('SELECT revision FROM other_settlement_revision WHERE singleton=1'))[0]
  if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision < 0)
    return fail('结算读取版本损坏')
  const heads = await tx.select<Record<string, unknown>>('SELECT * FROM expenditure_settlements ORDER BY id')
  const records: OtherSettlementStored[] = []
  for (const head of heads) {
    if (typeof head.id !== 'string' || !head.id || !Number.isSafeInteger(head.version) || Number(head.version) < 0)
      return fail('结算稳定版本损坏')
    if ([head.total_amount, head.amount, head.tax_amount].some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) || !(head.tax_rate === null || (typeof head.tax_rate === 'number' && Number.isFinite(head.tax_rate) && head.tax_rate >= 0 && head.tax_rate <= 100)))
      return fail('结算实际原金额、未知值或税率损坏')
    if (head.version === 0) {
      if (head.record_json !== null)
        return fail('旧结算版本与冻结资料冲突')
      const files = await tx.select<Record<string, unknown>>('SELECT f.*,l.sha256 FROM file_refs f LEFT JOIN other_settlement_files l ON l.file_ref_id=f.id WHERE f.owner_type=\'expenditure_settlement\' AND f.owner_id=? ORDER BY f.id', [head.id])
      if (files.some(file => !Number.isSafeInteger(file.file_size) || Number(file.file_size) < 0))
        return fail('历史原件大小未知或损坏；原元数据及原库保留，不能显示为真实零字节')
      const attachments = files.map(file => ({ id: String(file.id), ownerType: 'expenditure_settlement' as const, ownerId: String(head.id), fileName: String(file.file_name), filePath: '', fileSize: Number(file.file_size), mimeType: String(file.mime_type), category: String(file.category), uploader: String(file.uploader), uploadedAt: String(file.uploaded_at), deletedAt: file.deleted_at as string | null, ...(file.sha256 ? { sha256: String(file.sha256) } : {}) }))
      const allocations = await tx.select<Record<string, unknown>>('SELECT * FROM expenditure_settlement_expense_allocations WHERE settlement_id=? AND deleted_at IS NULL ORDER BY id', [head.id])
      if (allocations.some(line => typeof line.original_expense_line_id !== 'string' || !line.original_expense_line_id || typeof line.source_version !== 'string' || !line.source_version || typeof line.source_revision !== 'string' || !line.source_revision || !(line.allocated_amount === null || (typeof line.allocated_amount === 'number' && Number.isFinite(line.allocated_amount) && line.allocated_amount >= 0))))
        return fail('历史结算原费用采用关系损坏')
      const originalExpenses = allocations.map(line => ({ originalExpenseLineId: String(line.original_expense_line_id), sourceVersion: String(line.source_version), sourceRevision: String(line.source_revision), amount: line.allocated_amount as number | null }))
      if (originalExpenses.length) {
        const expected = originalExpenses.some(line => line.amount === null) ? null : originalExpenses.reduce((sum, line) => sum + Math.round(line.amount! * 100), 0) / 100
        if (head.total_amount !== expected)
          return fail('历史结算金额与原费用实际采用行合计不一致')
      }
      // Legacy raw rows remain readable with their real unknown audit and amount; no command/history is fabricated.
      records.push({ id: String(head.id), version: 0, workspaceId: identity.workspaceId, migrationBatchId: 'legacy-native', draft: { originalExpenses, id: String(head.id), no: String(head.no), name: String(head.name), projectId: head.project_id as string | null, contractId: head.contract_id as string | null, supplierId: head.supplier_id as string | null, totalAmount: head.total_amount as number | null, taxRate: head.tax_rate as number | null, settlementDate: String(head.settlement_date), settlementType: String(head.settlement_type), period: String(head.settlement_period), deductionNote: String(head.deduction_note), status: String(head.status), note: String(head.note), payeeSupplierId: head.payee_supplier_id as string | null, payeeWorkerId: head.payee_worker_id as string | null, payeeNameSnapshot: head.payee_name_snapshot as string | null }, attachments, facts: null, audit: { createdAt: head.created_at as string | null, updatedAt: head.updated_at as string | null, createdBy: head.created_by as string | null, updatedBy: head.updated_by as string | null, responsible: head.responsible as string | null, department: head.department as string | null } })
      continue
    }
    let record: OtherSettlementStored
    try {
      record = JSON.parse(String(head.record_json))
    }
    catch {
      return fail('结算冻结正文损坏')
    }
    if (record.id !== head.id || record.version !== head.version || record.draft.id !== head.id || !record.workspaceId || !Array.isArray(record.attachments) || !record.audit)
      return fail('结算索引身份与冻结正文不一致')
    const draft = decodeOtherSettlementDraft(record.draft)
    if (draft.originalExpenses?.length) {
      const expected = draft.originalExpenses.some(line => line.amount === null) ? null : draft.originalExpenses.reduce((sum, line) => sum + Math.round(line.amount! * 100), 0) / 100
      if (draft.totalAmount !== expected)
        return fail('结算金额与原费用实际采用合计不一致')
    }
    for (const [column, key] of [['project_id', 'projectId'], ['contract_id', 'contractId'], ['supplier_id', 'supplierId'], ['payee_supplier_id', 'payeeSupplierId'], ['payee_worker_id', 'payeeWorkerId'], ['payee_name_snapshot', 'payeeNameSnapshot'], ['total_amount', 'totalAmount'], ['tax_rate', 'taxRate']] as const) {
      if (head[column] !== (draft[key] ?? null))
        return fail('结算关系、原金额或收款身份索引与冻结正文不一致')
    }
    for (const [column, key] of [['no', 'no'], ['name', 'name'], ['status', 'status'], ['settlement_date', 'settlementDate'], ['note', 'note']] as const) {
      if (head[column] !== (draft[key] ?? ''))
        return fail('结算头文本索引与冻结正文不一致')
    }
    const allocations = await tx.select<Record<string, unknown>>('SELECT * FROM expenditure_settlement_expense_allocations WHERE settlement_id=? AND deleted_at IS NULL ORDER BY id', [record.id])
    if (allocations.length !== (draft.originalExpenses?.length ?? 0) || allocations.some((line) => {
      const input = draft.originalExpenses?.find(input => input.originalExpenseLineId === line.original_expense_line_id)
      const source = JSON.parse(String(line.frozen_json))
      return !input || input.sourceVersion !== line.source_version || input.sourceRevision !== line.source_revision || input.amount !== line.allocated_amount || source.id !== input.originalExpenseLineId || source.version !== input.sourceVersion || source.sourceRevision !== input.sourceRevision || (source.projectId ?? null) !== (draft.projectId ?? null) || source.applicantWorkerId !== (draft.payeeWorkerId ?? null) || source.applicantSupplierId !== (draft.payeeSupplierId ?? null) || source.applicantNameSnapshot !== draft.payeeNameSnapshot
    })) {
      return fail('结算原费用采用行与冻结来源不一致')
    }
    const actualFiles = await tx.select<Record<string, unknown>>('SELECT f.*,l.sha256 FROM other_settlement_files l JOIN file_refs f ON f.id=l.file_ref_id WHERE l.settlement_id=? ORDER BY f.id', [record.id])
    if (actualFiles.length !== record.attachments.length || actualFiles.some((file) => {
      const expected = record.attachments.find(item => item.id === file.id)
      return !expected || file.owner_type !== 'expenditure_settlement' || file.owner_id !== record.id || file.sha256 !== expected.sha256 || file.file_name !== expected.fileName || file.file_path !== expected.filePath || file.file_size !== expected.fileSize || file.mime_type !== expected.mimeType || file.category !== expected.category || file.deleted_at !== expected.deletedAt || file.uploader !== expected.uploader || file.uploaded_at !== expected.uploadedAt
    })) {
      return fail('结算原件身份、元数据或摘要与冻结正文不一致')
    }
    const histories = await tx.select<{
      version: number
      snapshot_json: string
    }>('SELECT * FROM other_settlement_history WHERE settlement_id=? ORDER BY version', [record.id])
    if (histories.length !== record.version || histories.some((row, index) => row.version !== index + 1) || otherSettlementFingerprint(JSON.parse(histories.at(-1)!.snapshot_json)) !== otherSettlementFingerprint(record))
      return fail('结算冻结历史缺失或不连续')
    records.push(record)
  }
  return { records, revision: revision.revision }
}
export async function validateOtherSettlementJournal(tx: TransactionDb, identity: {
  workspaceId: string
  actorId?: string
} = { workspaceId: 'historical-source' }) {
  const { records } = await readOtherSettlementStored(tx, identity)
  const commands = await tx.select<Record<string, unknown>>('SELECT * FROM other_settlement_commands')
  for (const row of commands) {
    const request = decodeOtherSettlementCommand(JSON.parse(String(row.request_json)))
    if (identity.actorId !== undefined && (row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId))
      return fail('结算操作回执不属于当前正式工作区或操作者')
    const result = decodeOtherSettlementResult(JSON.parse(String(row.result_json)))
    if (request.draft.clearanceLinkEdit) {
      if (row.scoped_id !== otherSettlementKey(request.commandId, request) || request.commandId !== row.command_id || request.workspaceId !== row.workspace_id || request.actorId !== row.actor_id || row.fingerprint !== otherSettlementFingerprint(request) || result.commandId !== request.commandId || result.id !== request.id || result.id !== row.settlement_id || result.version !== request.baseVersion || !Array.isArray(result.clearanceLinkIds) || result.clearanceLinkIds.length !== request.draft.clearanceLinkEdit.bindings.length || result.attachmentIds.length)
        return fail('旧份额补充采用原命令或回执不一致')
      for (const id of result.clearanceLinkIds) {
        const link = (await tx.select<Record<string, unknown>>('SELECT * FROM expenditure_settlement_clearance_links WHERE id=?', [id]))[0]
        if (!link || link.command_id !== request.commandId || link.origin_family !== 'other-settlement' || link.workspace_id !== request.workspaceId || link.actor_id !== request.actorId || link.verification_id !== request.draft.clearanceLinkEdit.verificationId || !request.draft.clearanceLinkEdit.bindings.some(binding => binding.expenseAllocationId === link.expense_allocation_id && binding.itemId === link.recognition_item_id && binding.amount === link.amount))
          return fail('旧份额补充采用稳定关系与原命令不一致')
      }
      continue
    }
    const history = (await tx.select<Record<string, unknown>>('SELECT * FROM other_settlement_history WHERE settlement_id=? AND version=?', [result.id, Number(result.version)]))[0]
    const snapshot = history && JSON.parse(String(history.snapshot_json)) as OtherSettlementStored | undefined
    if (row.scoped_id !== otherSettlementKey(request.commandId, request) || request.commandId !== row.command_id || request.workspaceId !== row.workspace_id || request.actorId !== row.actor_id || row.fingerprint !== otherSettlementFingerprint(request) || result.commandId !== request.commandId || result.id !== row.settlement_id || history?.actor_id !== request.actorId || history.command_id !== request.commandId || history.occurred_at !== result.updatedAt || snapshot?.version !== Number(result.version) || snapshot.workspaceId !== request.workspaceId || snapshot.id !== result.id || result.attachmentIds.some(id => !snapshot.attachments.some(file => file.id === id)))
      return fail('结算原命令回执、身份或冻结历史不一致')
    if (request.id && request.id !== result.id)
      return fail('结算原命令目标与回执错配')
    if (request.baseVersion !== null && Number(request.baseVersion) + 1 !== Number(result.version))
      return fail('结算原命令基准版本与冻结版本错配')
    if ((request.action === 'submit' && snapshot.draft.status !== 'pending') || (request.action === 'confirm' && snapshot.draft.status !== 'confirmed'))
      return fail('结算原命令动作与冻结状态错配')
  }
  for (const record of records.filter(record => record.version > 0)) {
    const histories = await tx.select<Record<string, unknown>>('SELECT * FROM other_settlement_history WHERE settlement_id=?', [record.id])
    for (const history of histories) {
      if (!commands.some(row => row.settlement_id === record.id && row.actor_id === history.actor_id && row.command_id === history.command_id && decodeOtherSettlementResult(JSON.parse(String(row.result_json))).version === String(history.version)))
        return fail('结算历史缺少原回执依据')
      const snapshot = JSON.parse(String(history.snapshot_json)) as OtherSettlementStored
      if (snapshot.id !== record.id || snapshot.version !== history.version || snapshot.attachments.some(file => !record.attachments.some(current => current.id === file.id && current.sha256 === file.sha256 && current.fileName === file.fileName && current.fileSize === file.fileSize)))
        return fail('结算历史原件被替换或缺失')
    }
  }
  for (const file of await tx.select<{
    file_ref_id: string
    sha256: string
  }>('SELECT * FROM other_settlement_files')) {
    const payload = (await tx.select<Record<string, unknown>>('SELECT * FROM file_payloads WHERE file_ref_id=?', [file.file_ref_id]))[0]
    if (!payload)
      return fail('结算原件正文缺失')
    let binary = ''
    if (payload.encoding !== 'base64') {
      const bytes = new Uint8Array(payload.content as Uint8Array)
      for (let index = 0; index < bytes.length; index += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    const base64 = payload.encoding === 'base64' ? String(payload.content) : btoa(binary)
    const ref = (await tx.select<{
      file_size: number
    }>('SELECT file_size FROM file_refs WHERE id=?', [file.file_ref_id]))[0]!
    if (await contractOriginalPayloadDigest(base64, ref.file_size, () => fail('结算原件正文、大小与摘要不一致')) !== file.sha256 || (payload.sha256 && payload.sha256 !== file.sha256))
      return fail('结算原件正文、大小与摘要不一致')
  }
  const sealed = await tx.select<Record<string, unknown>>('SELECT * FROM other_settlement_resolutions')
  if (identity.actorId !== undefined && sealed.some(row => row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId))
    return fail('结算封存命令不属于当前正式授权来源')
  if (sealed.some(row => typeof row.command_id !== 'string' || !row.command_id || row.command_id.length > 240 || row.scoped_id !== otherSettlementKey(row.command_id, { workspaceId: String(row.workspace_id), actorId: String(row.actor_id) }) || !Number.isFinite(Date.parse(String(row.resolved_at))) || commands.some(command => command.scoped_id === row.scoped_id)))
    return fail('结算封存命令与已保存回执冲突')
}
/** Reads the same Native logical owner; cancelled contracts do not erase real settlement history. */
export async function readNativeOtherSettlementReference(tx: Pick<TransactionDb, 'select'>, id: string) {
  const row = (await tx.select<Record<string, unknown>>('SELECT * FROM expenditure_settlements WHERE id=? AND deleted_at IS NULL', [id]))[0]
  if (!row)
    return null
  const columns = await tx.select<{
    name: string
  }>('PRAGMA table_info(expenditure_settlements)')
  const modern = columns.some(column => column.name === 'record_json')
  const allocations = modern
    ? await tx.select<{
        original_expense_line_id: string
      }>('SELECT original_expense_line_id FROM expenditure_settlement_expense_allocations WHERE settlement_id=? AND deleted_at IS NULL ORDER BY id', [id])
    : []
  const tables = await tx.select<{
    name: string
  }>('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name IN (\'penalty_settlement_deductions\',\'penalty_records\')')
  let net: number | null = typeof row.total_amount === 'number' && Number.isFinite(row.total_amount) ? row.total_amount : null
  if (tables.length !== 2) {
    net = null
  }
  else {
    const deductions = await tx.select<Record<string, unknown>>('SELECT d.amount,p.projectId AS project_id,p.contract_id,p.supplier_id,p.status,p.deleted_at AS penalty_deleted FROM penalty_settlement_deductions d LEFT JOIN penalty_records p ON p.id=d.penalty_id WHERE d.settlement_id=? AND d.deleted_at IS NULL', [id])
    if (deductions.some(line => line.project_id !== row.project_id || (line.contract_id && line.contract_id !== row.contract_id) || (line.supplier_id && line.supplier_id !== row.supplier_id) || typeof line.amount !== 'number' || !Number.isFinite(line.amount) || line.penalty_deleted !== null))
      net = null
    else if (net !== null)
      net -= deductions.filter(line => line.status === 'deducted').reduce((sum, line) => sum + Number(line.amount), 0)
    if (net !== null && net < 0)
      net = null
  }
  return { id: String(row.id), name: String(row.name), no: String(row.no), project_id: row.project_id as string | null, contract_id: row.contract_id as string | null, supplier_id: modern && allocations.length ? row.payee_supplier_id as string | null : row.supplier_id as string | null, worker_id: modern ? row.payee_worker_id as string | null : null, payee_name_snapshot: modern ? row.payee_name_snapshot as string | null : null, total_amount: net, status: String(row.status), original_expense_line_ids: allocations.map(line => line.original_expense_line_id), service_supplier_id: row.supplier_id as string | null, deleted_at: null }
}
