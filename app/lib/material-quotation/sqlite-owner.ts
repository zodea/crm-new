import type { TransactionDb } from '../db/coordinator'
import type { FileRefChanges } from '../forms/file-refs'
import type { QuotationFile, QuotationHistory, QuotationRecord, QuotationResult } from './contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { contractOriginalPayloadDigest } from '../forms/original-content'
import { decodeQuotationCommand, decodeQuotationDraft, decodeQuotationResult, isObject, quotationCommandKey, quotationFingerprint, quotationProblem, validId } from './contract'

export interface QuotationActor {
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
}
export interface QuotationReferences {
  projects: {
    id: string
    name: string
  }[]
  suppliers: {
    id: string
    name: string
  }[]
}
export interface QuotationStorage {
  identity: {
    workspaceId: string
    actorId: string
  }
  withTransaction: <T>(work: (tx: TransactionDb) => Promise<T>) => Promise<T>
  assertBusinessWrite: () => void
}
const originalError = () => quotationProblem('validation-failed', '报价原件的正文、大小或摘要不一致')
function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
export async function readQuotationFiles(tx: TransactionDb, id: string): Promise<QuotationFile[]> {
  const rows = await tx.select<Record<string, unknown>>('SELECT f.*,q.sha256 FROM material_quotation_files q JOIN file_refs f ON f.id=q.file_ref_id WHERE q.quotation_id=? ORDER BY f.uploaded_at,f.id', [id])
  return rows.map((row) => {
    if (row.owner_type !== 'material_quotation' || row.owner_id !== id || !validId(row.id) || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.file_size) || Number(row.file_size) < 0 || !isISODateTimeDTO(row.uploaded_at))
      return quotationProblem('unavailable', '报价原件关系或摘要损坏')
    return { id: String(row.id), ownerType: 'material_quotation', ownerId: id, fileName: String(row.file_name), filePath: String(row.file_path), fileSize: Number(row.file_size), mimeType: String(row.mime_type), category: String(row.category), uploader: String(row.uploader), uploadedAt: String(row.uploaded_at), deletedAt: row.deleted_at === null ? null : String(row.deleted_at), sha256: row.sha256 }
  })
}
export async function readQuotationRecords(tx: TransactionDb): Promise<{
  records: QuotationRecord[]
  revision: number
}> {
  const revision = await tx.select<{
    revision: number
  }>('SELECT revision FROM quotation_revision WHERE singleton=1')
  if (revision.length !== 1 || !Number.isSafeInteger(revision[0]!.revision) || revision[0]!.revision < 0)
    return quotationProblem('unavailable', '报价读取版本缺失')
  const heads = await tx.select<{
    id: string
    party_name: string
    supplier_id: string | null
    project_id: string | null
    scope: string
    quotation_date: string | null
    draft_json: string
    version: number
    created_at: string
    updated_at: string
  }>('SELECT * FROM material_quotations ORDER BY created_at,id')
  const records: QuotationRecord[] = []
  for (const head of heads) {
    if (!validId(head.id) || !Number.isSafeInteger(head.version) || head.version < 1 || !isISODateTimeDTO(head.created_at) || !isISODateTimeDTO(head.updated_at))
      return quotationProblem('unavailable', '报价身份或时间损坏')
    const draft = decodeQuotationDraft(JSON.parse(head.draft_json))
    if (head.party_name !== draft.partyName || head.supplier_id !== draft.supplierId || head.project_id !== draft.projectId || head.scope !== draft.scope || head.quotation_date !== draft.quotationDate)
      return quotationProblem('unavailable', '报价头索引字段与原始资料不一致')
    const lineRows = await tx.select<{
      id: string
      name: string
      unit: string
      unit_price: number | null
      tax_rate: number | null
      line_json: string
    }>('SELECT * FROM material_quotation_lines WHERE quotation_id=? AND deleted_at IS NULL ORDER BY id', [head.id])
    if (lineRows.length !== draft.lines.length || lineRows.some((row) => {
      const source = draft.lines.find(line => line.id === row.id)
      return quotationFingerprint(JSON.parse(row.line_json)) !== quotationFingerprint(source) || row.name !== source?.name || row.unit !== source?.unit || row.unit_price !== source?.unitPrice || row.tax_rate !== source?.taxRate
    })) {
      return quotationProblem('unavailable', '报价头、原材料行与索引字段不一致')
    }
    const attachments = await readQuotationFiles(tx, head.id)
    const rows = await tx.select<{
      version: number
      snapshot_json: string
      actor_id: string
      command_id: string
      occurred_at: string
    }>('SELECT * FROM material_quotation_history WHERE quotation_id=? ORDER BY version', [head.id])
    const history = rows.map((row, index): QuotationHistory => {
      const snapshot = JSON.parse(row.snapshot_json)
      if (row.version !== index + 1 || !isObject(snapshot) || !Array.isArray(snapshot.files) || !validId(row.actor_id) || !validId(row.command_id) || !isISODateTimeDTO(row.occurred_at))
        return quotationProblem('unavailable', '报价冻结历史不连续或身份损坏')
      const files = snapshot.files as QuotationFile[]
      if (files.some(file => file.ownerId !== head.id || file.ownerType !== 'material_quotation' || !attachments.some(actual => actual.id === file.id && actual.sha256 === file.sha256 && actual.fileName === file.fileName && actual.fileSize === file.fileSize)))
        return quotationProblem('unavailable', '报价历史原件缺失或被替换')
      return { version: String(row.version), draft: decodeQuotationDraft(snapshot.draft), files, actorId: row.actor_id, commandId: row.command_id, occurredAt: row.occurred_at }
    })
    if (history.length !== head.version || history[0]?.occurredAt !== head.created_at || history.at(-1)?.occurredAt !== head.updated_at || quotationFingerprint(history.at(-1)?.draft) !== quotationFingerprint(draft) || quotationFingerprint(history.at(-1)?.files) !== quotationFingerprint(attachments))
      return quotationProblem('unavailable', '报价当前记录与冻结历史不一致')
    records.push({ id: head.id, draft, attachments, history, version: String(head.version), createdAt: head.created_at, updatedAt: head.updated_at })
  }
  return { records, revision: revision[0]!.revision }
}
export async function validateQuotationJournal(tx: TransactionDb) {
  const { records } = await readQuotationRecords(tx)
  const commands = await tx.select<{
    scoped_id: string
    command_id: string
    workspace_id: string
    actor_id: string
    fingerprint: string
    request_json: string
    result_json: string
    quotation_id: string
  }>('SELECT * FROM material_quotation_commands')
  for (const row of commands) {
    const request = decodeQuotationCommand(JSON.parse(row.request_json))
    const result = decodeQuotationResult(JSON.parse(row.result_json))
    const record = records.find(record => record.id === row.quotation_id)
    const history = record?.history.find(history => history.version === result.version)
    if (row.scoped_id !== quotationCommandKey(row.command_id, { workspaceId: row.workspace_id, actorId: row.actor_id }) || request.commandId !== row.command_id || request.workspaceId !== row.workspace_id || request.actorId !== row.actor_id || row.fingerprint !== quotationFingerprint(request)
      || result.commandId !== row.command_id || result.id !== row.quotation_id || history?.commandId !== row.command_id || history.actorId !== row.actor_id || history.occurredAt !== result.updatedAt || quotationFingerprint(history.draft) !== quotationFingerprint(request.draft) || result.attachmentIds.some(id => !history.files.some(file => file.id === id))) {
      return quotationProblem('unavailable', '报价原命令回执与实际冻结记录不一致')
    }
  }
  for (const record of records) {
    for (const history of record.history) {
      if (!commands.some(row => row.quotation_id === record.id && row.command_id === history.commandId && row.actor_id === history.actorId && decodeQuotationResult(JSON.parse(row.result_json)).version === history.version))
        return quotationProblem('unavailable', '报价历史缺少原命令证据')
    }
  }
  const resolutions = await tx.select<{
    scoped_id: string
    command_id: string
    workspace_id: string
    actor_id: string
    resolved_at: string
  }>('SELECT * FROM material_quotation_resolutions')
  if (resolutions.some(row => row.scoped_id !== quotationCommandKey(row.command_id, { workspaceId: row.workspace_id, actorId: row.actor_id }) || !validId(row.command_id) || !isISODateTimeDTO(row.resolved_at) || commands.some(command => command.scoped_id === row.scoped_id)))
    return quotationProblem('unavailable', '报价封存编号损坏或与已应用回执冲突')
}
export function createQuotationOwner(storage: QuotationStorage, options: {
  payloadMode: 'central' | 'native'
  references: (tx: TransactionDb, actor: QuotationActor) => Promise<QuotationReferences>
  now?: () => string
  relations?: (tx: TransactionDb, records: QuotationRecord[]) => Promise<QuotationRecord[]>
  importedCommandKeys?: (tx: TransactionDb) => Promise<Set<string>>
}) {
  const now = options.now ?? (() => new Date().toISOString())
  const authorize = (session: () => QuotationActor, write: boolean) => {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('material-quotation:read') || (write && !actor.capabilities.includes('material-quotation:write')))
      return quotationProblem('forbidden', '当前身份没有材料报价权限')
    return { ...actor, capabilities: [...actor.capabilities] }
  }
  const readable = (draft: QuotationDraftLike, actor: QuotationActor) => (!draft.projectId || actor.capabilities.includes('project:list:read')) && (!draft.supplierId || actor.capabilities.includes('supplier:list:read'))
  async function run<T>(session: () => QuotationActor, write: boolean, operation: (tx: TransactionDb, actor: QuotationActor) => Promise<T>) {
    const original = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      if (quotationFingerprint(authorize(session, write)) !== quotationFingerprint(original))
        return quotationProblem('forbidden', '身份或权限已变化，请重新核对')
      await validateQuotationJournal(tx)
      const result = await operation(tx, original)
      if (quotationFingerprint(authorize(session, write)) !== quotationFingerprint(original))
        return quotationProblem('forbidden', '操作期间身份或权限变化，事务已撤回')
      return result
    })
  }
  async function files(tx: TransactionDb, id: string, changes: FileRefChanges, actor: QuotationActor, occurredAt: string) {
    if ((changes.removeIds ?? []).some(id => changes.restoreIds?.includes(id)))
      return quotationProblem('validation-failed', '同一原件不能同时删除和恢复')
    for (const [ids, deletedAt] of [[changes.removeIds ?? [], occurredAt], [changes.restoreIds ?? [], null]] as const) {
      for (const fileId of ids) {
        const existing = await tx.select('SELECT file_ref_id FROM material_quotation_files WHERE quotation_id=? AND file_ref_id=?', [id, fileId])
        if (!existing.length)
          return quotationProblem('relationship-mismatch', '原件不属于当前报价')
        await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=? AND owner_type=? AND owner_id=?', [deletedAt, fileId, 'material_quotation', id])
      }
    }
    const added: string[] = []
    for (const file of changes.add ?? []) {
      if (!isObject(file) || Object.keys(file).some(key => !['fileName', 'filePath', 'fileSize', 'mimeType', 'category', 'uploader', 'payloadBase64'].includes(key)) || typeof file.fileName !== 'string' || !file.fileName.trim() || typeof file.payloadBase64 !== 'string' || !Number.isSafeInteger(file.fileSize) || ['mimeType', 'category', 'uploader', 'filePath'].some(key => file[key] !== undefined && typeof file[key] !== 'string'))
        return originalError()
      const sha256 = await contractOriginalPayloadDigest(file.payloadBase64, Number(file.fileSize), originalError)
      const fileId = `quotation-file-${crypto.randomUUID()}`
      await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)', [fileId, 'material_quotation', id, file.fileName, '', file.fileSize, file.mimeType ?? '', file.category ?? '', actor.actorId, occurredAt])
      const bytes = Uint8Array.from(atob(file.payloadBase64), char => char.charCodeAt(0))
      if (options.payloadMode === 'central')
        await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [fileId, bytes, sha256])
      else
        await tx.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,\'base64\',?)', [fileId, file.payloadBase64])
      await tx.execute('INSERT INTO material_quotation_files VALUES(?,?,?)', [fileId, id, sha256])
      added.push(fileId)
    }
    return added
  }
  return {
    read(session: () => QuotationActor) {
      return run(session, false, async (tx, actor) => {
        const result = await readQuotationRecords(tx)
        const projected = options.relations ? await options.relations(tx, result.records) : result.records
        const records = projected.filter(record => [record.draft, ...record.history.map(history => history.draft)].every(draft => readable(draft, actor)))
        return { records, revision: result.revision, filtered: records.length !== result.records.length }
      })
    },
    context(session: () => QuotationActor) {
      return run(session, false, async (tx, actor) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], ...await options.references(tx, actor) }))
    },
    execute(body: unknown, session: () => QuotationActor): Promise<QuotationResult> {
      const request = decodeQuotationCommand(body)
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          return quotationProblem('forbidden', '报价命令身份与当前会话不一致')
        const key = quotationCommandKey(request.commandId, actor)
        if ((await options.importedCommandKeys?.(tx))?.has(key))
          return quotationProblem('conflict', '该编号属于迁入来源的历史命令，不能作为当前中央提交或恢复授权；请保留原历史并使用新的中央编号')
        if ((await tx.select('SELECT scoped_id FROM material_quotation_resolutions WHERE scoped_id=?', [key])).length)
          return quotationProblem('conflict', '原编号已封存为未应用，不能迟到写入')
        const fingerprint = quotationFingerprint(request)
        const previous = (await tx.select<{
          fingerprint: string
          result_json: string
        }>('SELECT fingerprint,result_json FROM material_quotation_commands WHERE scoped_id=?', [key]))[0]
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            return quotationProblem('validation-failed', '原命令编号不能复用不同内容或原件')
          return decodeQuotationResult(JSON.parse(previous.result_json))
        }
        const current = request.id ? (await readQuotationRecords(tx)).records.find(record => record.id === request.id) : null
        if (request.id && !current)
          return quotationProblem('not-found', '报价不存在')
        if (current && current.version !== request.baseVersion)
          return quotationProblem('conflict', '报价已被更新，请核对版本；当前输入仍保留')
        if (!readable(request.draft, actor) || (current && !readable(current.draft, actor)))
          return quotationProblem('forbidden', '关联目录权限不足，不能移除或修改已关联身份')
        const references = await options.references(tx, actor)
        if (request.draft.projectId && !references.projects.some(project => project.id === request.draft.projectId))
          return quotationProblem('relationship-mismatch', '所选项目未在当前真实来源中核验')
        if (request.draft.supplierId && !references.suppliers.some(supplier => supplier.id === request.draft.supplierId))
          return quotationProblem('relationship-mismatch', '所选分供方未在当前真实来源中核验')
        const id = request.id ?? `quotation-${crypto.randomUUID()}`
        for (const line of request.draft.lines) {
          const existing = await tx.select<{
            quotation_id: string
          }>('SELECT quotation_id FROM material_quotation_lines WHERE id=?', [line.id])
          if (existing.some(row => row.quotation_id !== id))
            return quotationProblem('relationship-mismatch', '明细身份已归属另一报价')
        }
        const occurredAt = now()
        if (!isISODateTimeDTO(occurredAt))
          return quotationProblem('internal-error', '报价保存时间无效')
        const version = Number(current?.version ?? 0) + 1
        const draft = request.draft
        await tx.execute('INSERT INTO material_quotations VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET party_name=excluded.party_name,supplier_id=excluded.supplier_id,project_id=excluded.project_id,scope=excluded.scope,quotation_date=excluded.quotation_date,draft_json=excluded.draft_json,version=excluded.version,updated_at=excluded.updated_at', [id, draft.partyName, draft.supplierId, draft.projectId, draft.scope, draft.quotationDate, JSON.stringify(draft), version, current?.createdAt ?? occurredAt, occurredAt])
        await tx.execute('UPDATE material_quotation_lines SET deleted_at=? WHERE quotation_id=?', [occurredAt, id])
        for (const line of draft.lines)
          await tx.execute('INSERT INTO material_quotation_lines VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name,unit=excluded.unit,unit_price=excluded.unit_price,tax_rate=excluded.tax_rate,line_json=excluded.line_json,deleted_at=NULL', [line.id, id, line.name, line.unit, line.unitPrice, line.taxRate, JSON.stringify(line)])
        const attachmentIds = await files(tx, id, request.attachments, actor, occurredAt)
        const attachments = await readQuotationFiles(tx, id)
        await tx.execute('INSERT INTO material_quotation_history VALUES(?,?,?,?,?,?)', [id, version, JSON.stringify({ draft, files: attachments }), actor.actorId, request.commandId, occurredAt])
        const result: QuotationResult = { id, commandId: request.commandId, version: String(version), updatedAt: occurredAt, attachmentIds }
        await tx.execute('INSERT INTO material_quotation_commands VALUES(?,?,?,?,?,?,?,?)', [key, request.commandId, actor.workspaceId, actor.actorId, fingerprint, JSON.stringify(request), JSON.stringify(result), id])
        await tx.execute('UPDATE quotation_revision SET revision=revision+1 WHERE singleton=1')
        await validateQuotationJournal(tx)
        return result
      })
    },
    resolve(commandId: string, session: () => QuotationActor) {
      if (!validId(commandId))
        return quotationProblem('validation-failed', '原编号无效')
      return run(session, true, async (tx, actor) => {
        const key = quotationCommandKey(commandId, actor)
        if ((await options.importedCommandKeys?.(tx))?.has(key))
          return quotationProblem('conflict', '该编号属于迁入来源的历史命令，不能作为当前中央恢复授权；请保留原历史')
        const command = (await tx.select<{
          result_json: string
        }>('SELECT result_json FROM material_quotation_commands WHERE scoped_id=?', [key]))[0]
        if (command)
          return { outcome: 'applied' as const, result: decodeQuotationResult(JSON.parse(command.result_json)) }
        await tx.execute('INSERT OR IGNORE INTO material_quotation_resolutions VALUES(?,?,?,?,?)', [key, commandId, actor.workspaceId, actor.actorId, now()])
        return { outcome: 'not-applied' as const, commandId }
      })
    },
    original(id: string, fileId: string, session: () => QuotationActor, version?: string) {
      return run(session, false, async (tx, actor) => {
        const record = (await readQuotationRecords(tx)).records.find(record => record.id === id)
        if (!record)
          return quotationProblem('not-found', '报价不存在')
        if (![record.draft, ...record.history.map(history => history.draft)].every(draft => readable(draft, actor)))
          return quotationProblem('forbidden', '关联来源没有读取权限')
        const file = (version ? record.history.find(history => history.version === version)?.files : record.attachments)?.find(file => file.id === fileId && file.deletedAt === null)
        if (!file)
          return quotationProblem('not-found', '此版本没有可读取的报价原件')
        const row = (await tx.select<{
          content: Uint8Array | string
          encoding?: string
          sha256?: string
        }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [fileId]))[0]
        if (!row)
          return quotationProblem('unavailable', '报价原件正文缺失')
        const payloadBase64 = options.payloadMode === 'native' ? row.encoding === 'base64' && typeof row.content === 'string' ? row.content : originalError() : row.content instanceof Uint8Array ? bytesToBase64(row.content) : originalError()
        const digest = await contractOriginalPayloadDigest(payloadBase64, file.fileSize, originalError)
        if (digest !== file.sha256 || (options.payloadMode === 'central' && row.sha256 !== digest))
          return quotationProblem('unavailable', '原件正文与冻结摘要不一致')
        return { ownerId: id, fileId, dataOrigin: 'real' as const, fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize, sha256: file.sha256, payloadBase64 }
      })
    },
  }
}
interface QuotationDraftLike {
  projectId: string | null
  supplierId: string | null
}
