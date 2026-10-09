import type { BoqSourceImportCommand, BoqSourceImportPreview, BoqSourceImportResult } from '../../app/lib/boq/import-contract'
import type { ProductionBoqChangeDocument } from '../../app/lib/boq/production-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { BusinessSession } from './business-session'
import type { BoqNativeSource } from './production-boq-migration-source'
import type { BoqFileRecord, BoqLineRecord, BoqPriceRecord } from './production-boq-record'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { readProductionBoqImportEvidence } from './production-boq-import-evidence'
import { readBoqNativeSource } from './production-boq-migration-source'
import { assertProductionBoq, boqDigest, boqFail } from './production-boq-record'
import { boqClosed, boqStableId } from './production-boq-request'
import { assertProductionBoqRestoreSafe } from './production-boq-restore'
import { readProductionConstructionContractReference, readProductionConstructionSourceIdentities } from './production-construction-contract-sources'
import { readProductionQuantityImportedIdentities } from './production-quantity-migration'
import { quantityCanonical } from './production-quantity-record'

type Session = () => BusinessSession
const key = (value: { workspaceId: string, actorId: string, commandId: string }) => [value.workspaceId, value.actorId, value.commandId]
const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function time(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return boqFail('validation-failed', '原清单时间无法核对，不能用当前日期补造')
  return new Date(value).toISOString()
}
const text = (value: unknown) => value == null ? '' : String(value)
function number(value: unknown): number | null {
  if (value === null || value === undefined)
    return null
  if (typeof value !== 'number' || !Number.isFinite(value))
    return boqFail('validation-failed', '原清单量价不是有限原数字，不能补零')
  return value
}
function parse(input: unknown): BoqSourceImportCommand {
  const value = boqClosed(input, ['workspaceId', 'actorId', 'commandId', 'source', 'heads', 'originals'])
  if (!['workspaceId', 'actorId', 'commandId'].every(field => boqStableId(value[field])) || !Array.isArray(value.heads) || !Array.isArray(value.originals))
    return boqFail('validation-failed', '清单迁入须保原身份、独立原编号、逐份真实主合同版本和原件')
  const source = boqClosed(value.source, ['sha256', 'payloadBase64'])
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.payloadBase64 !== 'string')
    return boqFail('validation-failed', '原施工清单来源必须是完整 SQLite 字节和真实摘要')
  for (const head of value.heads) {
    const row = boqClosed(head, ['id', 'version'])
    if (!boqStableId(row.id) || typeof row.version !== 'string' || !row.version.trim())
      return boqFail('validation-failed', '实际主合同采用版本无效')
  }
  for (const raw of value.originals) {
    const original = boqClosed(raw, ['fileId', 'original'])
    const file = boqClosed(original.original, ['fileName', 'mimeType', 'fileSize', 'sha256', 'payloadBase64'])
    if (typeof original.fileId !== 'string' || !original.fileId.trim() || !['fileName', 'mimeType', 'sha256', 'payloadBase64'].every(field => typeof file[field] === 'string' && String(file[field]).trim()) || !Number.isSafeInteger(file.fileSize) || Number(file.fileSize) <= 0 || !/^[a-f0-9]{64}$/.test(String(file.sha256)))
      return boqFail('validation-failed', '原路径清单必须按实际原ID补传完整原件')
    const bytes = Buffer.from(String(file.payloadBase64), 'base64')
    if (bytes.toString('base64') !== file.payloadBase64 || bytes.length !== file.fileSize || hashBytes(bytes) !== file.sha256)
      return boqFail('validation-failed', '原清单文件大小、原字节与摘要不同')
  }
  if (new Set(value.heads.map(row => row.id)).size !== value.heads.length || new Set(value.originals.map(row => row.fileId)).size !== value.originals.length)
    return boqFail('validation-failed', '原合同或原件映射不能重复')
  return structuredClone(value) as unknown as BoqSourceImportCommand
}
const summary = (command: BoqSourceImportCommand) => ({ workspaceId: command.workspaceId, actorId: command.actorId, commandId: command.commandId, action: 'adopt', sourceSha256: command.source.sha256, heads: command.heads, originals: command.originals.map(row => ({ fileId: row.fileId, original: { ...row.original, payloadBase64: undefined } })) })
async function parents(tx: TransactionDb, actor: BusinessSession, source: BoqNativeSource) {
  const proof = await readProductionConstructionSourceIdentities(tx, actor, source.sourceSha256, { includeDeleted: true })
  const used = new Set([...source.files, ...source.lines, ...source.changes, ...source.ledgers].map(row => String(row.contract_id ?? source.changes.find(change => change.ledger_id === row.id)?.contract_id)))
  const heads = []
  for (const legacyId of [...used].sort()) {
    const mapped = proof.contracts.find(row => row.legacyId === legacyId)
    if (!mapped || !mapped.projectId)
      return boqFail('unavailable', '此完整清单的真实施工主合同没有同SHA已确认映射，不能按原字符串或项目首份合同猜接')
    const actual = await readProductionConstructionContractReference(tx, actor, mapped.id, { includeDeleted: true })
    if (actual.projectId !== mapped.projectId)
      return boqFail('relationship-mismatch', '同源原施工主合同项目归属不一致')
    heads.push({ ...actual, legacyId })
  }
  return heads
}

/** Full source batch: Native is read-only, all originals/receipts and explicit owner mappings remain on disk. */
export function createProductionBoqMigration(storage: ProductionStorage) {
  const active = new Map<string, { fingerprint: string, promise: Promise<BoqSourceImportResult> }>()
  function authorize(session: Session) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !['boq:read', 'boq:import', 'construction-contract:read', 'core:migration:write'].every(capability => actor.capabilities.includes(capability)))
      return boqFail('forbidden', '当前真实身份无整批施工清单迁入/恢复权限')
    return actor
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await assertProductionBoq(tx, actor)
      const result = await work(tx, actor)
      if (boqDigest(actor) !== boqDigest(session()))
        return boqFail('forbidden', '清单迁入期间权限或来源变化，原件与编号保留')
      return result
    })
  }
  async function preflight(input: unknown, session: Session): Promise<BoqSourceImportPreview> {
    authorize(session)
    const command = parse(input)
    if (command.workspaceId !== session().workspaceId || command.actorId !== session().actorId)
      return boqFail('forbidden', '原清单迁入身份不同')
    return withVerifiedMigrationSnapshot(command.source, async (native, proof) => {
      const source = await readBoqNativeSource(native, proof)
      return run(session, false, async (tx, actor) => {
        const actual = await parents(tx, actor, source)
        return { workspaceId: actor.workspaceId, actorId: actor.actorId, sourceSha256: source.sourceSha256, schemaVersion: source.schemaVersion, heads: actual.map(row => ({ id: row.id, name: row.name, projectId: row.projectId!, version: row.version })), counts: { files: source.files.length, lines: source.lines.length, changes: source.changes.length, prices: source.prices.length }, originals: source.files.map((file) => {
          const embedded = source.attachments.find(row => row.owner_type === 'boq_file' && row.owner_id === file.id && source.payloads.some(body => body.file_ref_id === row.id))
          const required = !embedded && Boolean(file.file_path)
          return { fileId: String(file.id), fileName: String(file.file_name), filePath: text(file.file_path), required, bodyState: embedded ? 'embedded' : required ? 'path-original-required' : 'metadata-only' }
        }) }
      })
    })
  }
  async function adopt(input: unknown, session: Session): Promise<BoqSourceImportResult> {
    authorize(session)
    const command = parse(input)
    if (command.workspaceId !== session().workspaceId || command.actorId !== session().actorId)
      return boqFail('forbidden', '清单原迁入命令身份不同')
    const fingerprint = boqDigest(summary(command))
    const commandKey = quantityCanonical(key(command))
    const previous = active.get(commandKey)
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        return boqFail('conflict', '原清单整批提交仍在处理，不能更换来源、原件或映射')
      return previous.promise
    }
    const pending = withVerifiedMigrationSnapshot(command.source, async (native, proof) => {
      const source = await readBoqNativeSource(native, proof)
      const originals = new Map<string, string>()
      await run(session, true, async (tx, actor) => {
        if ((await tx.select('SELECT command_id FROM boq_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key(command))).length)
          return boqFail('conflict', '原清单迁入编号已经封存未应用，迟到提交不能重建')
        const [prior] = await tx.select<{ fingerprint: string, request_json: string }>('SELECT * FROM boq_import_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key(command))
        if (prior && prior.fingerprint !== fingerprint)
          return boqFail('conflict', '整批原编号已固定另一来源、主合同版本或原件')
        if (prior) {
          for (const row of JSON.parse(prior.request_json).originals)
            originals.set(row.fileId, row.fileRefId)
          return
        }
        await parents(tx, actor, source)
        for (const row of command.originals) {
          const sourceFile = source.files.find(file => file.id === row.fileId)
          if (!sourceFile || sourceFile.file_name !== row.original.fileName)
            return boqFail('relationship-mismatch', '补传清单原件须按原文件ID和原文件名确认，不能按近似名称猜接')
          const bytes = Buffer.from(row.original.payloadBase64, 'base64')
          const [same] = await tx.select<{ id: string, content: Uint8Array }>('SELECT f.id,b.content FROM file_refs f JOIN file_payloads b ON b.file_ref_id=f.id WHERE f.owner_type=\'boq_original\' AND b.sha256=? AND f.file_size=? AND f.mime_type=? ORDER BY f.id LIMIT 1', [row.original.sha256, row.original.fileSize, row.original.mimeType])
          const refId = same?.id ?? `boq-original-${boqDigest([source.sourceSha256, row.fileId]).slice(0, 24)}`
          if (same && !Buffer.from(same.content).equals(bytes))
            return boqFail('unavailable', '同摘要清单原件实际正文不同，整批保留不采用')
          if (!same) {
            await tx.execute('INSERT INTO file_refs VALUES (?,?,?,?,?,?,?,?,?,?,NULL)', [refId, 'boq_original', row.fileId, row.original.fileName, text(sourceFile.file_path), bytes.length, row.original.mimeType, 'original_boq', actor.actorId, time(sourceFile.created_at)])
            await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [refId, bytes, row.original.sha256])
          }
          originals.set(row.fileId, refId)
        }
        const body = { ...summary(command), originals: summary(command).originals.map(row => ({ ...row, fileRefId: originals.get(row.fileId)! })) }
        await tx.execute('INSERT INTO boq_import_intents VALUES (?,?,?,?,?,?,?,?)', [...key(command), 'adopt', source.sourceSha256, fingerprint, quantityCanonical(body), new Date().toISOString()])
      })
      return run(session, true, async (tx, actor) => {
        if ((await tx.select('SELECT command_id FROM boq_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key(command))).length)
          return boqFail('conflict', '原迁入编号已封存，不能迟到采用')
        const [old] = await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM boq_import_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', key(command))
        if (old) {
          if (old.fingerprint !== fingerprint)
            return boqFail('conflict', '原迁入回执对应另一份正文')
          return JSON.parse(old.result_json) as BoqSourceImportResult
        }
        if ((await tx.select('SELECT id FROM boq_source_imports WHERE source_sha256=?', [source.sourceSha256])).length)
          return boqFail('conflict', '此完整来源已采用，不能复制第二套清单与变洽签事实')
        const actualHeads = await parents(tx, actor, source)
        if (command.heads.length !== actualHeads.length || actualHeads.some(head => !command.heads.some(row => row.id === head.id && row.version === head.version)))
          return boqFail('stale-source', '实际消费的主合同版本未确认或已变化，整批保留输入不采用')
        const quantityIds = source.lines.some(row => row.item_id !== null) || source.prices.some(row => row.item_id !== null) ? await readProductionQuantityImportedIdentities(tx, source.sourceSha256, actor) : []
        const headFor = (legacy: unknown) => actualHeads.find(head => head.legacyId === legacy) ?? boqFail('relationship-mismatch', '原清单父合同没有同源已确认身份')
        const itemFor = (legacy: unknown, projectId: string) => {
          if (legacy == null)
            return null
          const mapped = quantityIds.find(row => row.table === 'items' && row.legacyId === legacy && row.projectId === projectId)
          if (!mapped)
            return boqFail('unavailable', '原分项没有同SHA已确认真实工程量映射，不能按名称或同字符串猜接')
          return mapped.id
        }
        const importId = `boq-import-${randomUUID()}`
        const installed: Record<string, string> = {}
        const mappings: Array<{ table: string, sourceTable?: string, legacyId: string, id: string, projectId: string, contractId: string }> = []
        const fileProofs: Array<Record<string, unknown>> = []
        const metadataOnlyFileIds: string[] = []
        const remember = async (table: string, id: string, projectId: string, contractId: string, legacyId = id, sourceTable?: string) => {
          installed[`${table}:${id}`] = boqDigest((await tx.select(`SELECT * FROM ${table} WHERE id=?`, [id]))[0])
          mappings.push({ table, legacyId, id, projectId, contractId, ...(sourceTable ? { sourceTable } : {}) })
        }
        const assertUnused = async (table: string, id: string) => {
          if ((await tx.select(`SELECT id FROM ${table} WHERE id=?`, [id])).length)
            return boqFail('conflict', '原施工清单稳定ID已被使用，不能覆盖现有确认事实')
        }
        const embeddedRefs = new Set<string>()
        for (const nativeFile of source.files) {
          const id = String(nativeFile.id)
          await assertUnused('boq_files', id)
          const head = headFor(nativeFile.contract_id)
          const embedded = source.attachments.filter(file => file.owner_type === 'boq_file' && file.owner_id === id && source.payloads.some(body => body.file_ref_id === file.id))
          if (embedded.length > 1 && !originals.has(id))
            return boqFail('validation-failed', '原清单有多个不同正文引用，须按原ID明确完整原件，不选第一份')
          const supplied = command.originals.find(row => row.fileId === id)
          const embeddedFile = supplied ? undefined : embedded[0]
          const embeddedBody = embeddedFile ? source.payloads.find(body => body.file_ref_id === embeddedFile.id) : undefined
          const bytes = supplied ? Buffer.from(supplied.original.payloadBase64, 'base64') : embeddedBody ? Buffer.from(String(embeddedBody.content), 'base64') : null
          if (!bytes && nativeFile.file_path)
            return boqFail('validation-failed', '原路径清单必须补传完整原件，不能伪成历史缺件或丢原路径')
          const refId = originals.get(id) ?? (embeddedFile ? String(embeddedFile.id) : `boq-original-${boqDigest([source.sourceSha256, id]).slice(0, 24)}`)
          const sha256 = bytes ? hashBytes(bytes) : null
          const mimeType = supplied?.original.mimeType ?? text(embeddedFile?.mime_type)
          if (embeddedFile) {
            await assertUnused('file_refs', refId)
            await tx.execute('INSERT INTO file_refs VALUES (?,?,?,?,?,?,?,?,?,?,?)', [refId, embeddedFile.owner_type, embeddedFile.owner_id, text(embeddedFile.file_name), text(embeddedFile.file_path), bytes!.length, text(embeddedFile.mime_type), text(embeddedFile.category), text(embeddedFile.uploader), embeddedFile.uploaded_at == null ? '' : time(embeddedFile.uploaded_at), embeddedFile.deleted_at == null ? null : time(embeddedFile.deleted_at)])
            await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [refId, bytes!, sha256])
            embeddedRefs.add(refId)
          }
          if (!originals.has(id) && !embeddedFile) {
            await tx.execute('INSERT INTO file_refs VALUES (?,?,?,?,?,?,?,?,?,?,NULL)', [refId, 'boq_original', id, String(nativeFile.file_name), text(nativeFile.file_path), 0, mimeType, 'original_boq', actor.actorId, time(nativeFile.created_at)])
            metadataOnlyFileIds.push(refId)
          }
          const file: BoqFileRecord = { id, projectId: head.projectId!, contractId: head.id, fileRefId: refId, fileName: String(nativeFile.file_name), sha256, fileSize: bytes?.length ?? null, mimeType, formatClass: text(nativeFile.format_class), bodyState: bytes ? 'embedded' : 'metadata-only', createdAt: time(nativeFile.created_at), updatedAt: time(nativeFile.updated_at), deletedAt: nativeFile.deleted_at == null ? null : time(nativeFile.deleted_at) }
          await tx.execute('INSERT INTO boq_files VALUES (?,?,?,?,?,?,?,?)', [id, file.projectId, head.id, refId, quantityCanonical(file), file.createdAt, file.updatedAt, file.deletedAt])
          fileProofs.push({ id: refId, logicalFileId: id, sha256, fileSize: bytes?.length ?? null, mimeType, fileName: file.fileName, bodyState: file.bodyState, originalMetadata: embeddedFile ?? null })
        }
        for (const row of source.changes) {
          const head = headFor(row.contract_id)
          await assertUnused('boq_change_records', String(row.id))
          const lines = source.changeLines.filter(line => line.change_order_id === row.id).map((line) => {
            const targetId = line.result_boq_line_id ?? line.boq_line_id
            const target = source.lines.find(item => item.id === targetId)
            return { id: String(line.id), boqLineId: targetId == null ? null : String(targetId), operation: text(line.operation) as 'add' | 'qty' | 'price', itemName: text(line.item_name), unit: text(line.unit), contractQty: number(target?.recognized_qty ?? target?.qty), contractUnitPrice: number(target?.recognized_unit_price ?? target?.unit_price), autoQty: null, reportedQty: null, auditedQty: null, deltaQty: number(line.delta_qty), newUnitPrice: number(line.new_unit_price), amount: number(line.amount)!, auditedAmount: null, note: text(line.note) }
          })
          const document: ProductionBoqChangeDocument = { dataOrigin: 'real', kind: 'owner_change', id: String(row.id), no: text(row.code), name: text(row.name), documentType: text(row.document_type) || 'change_negotiation', projectId: head.projectId!, projectName: '', projectPermission: 'allowed', customerId: head.customerId, customerName: '', customerPermission: 'allowed', contractId: head.id, contractNo: head.no, contractName: head.name, contractPermission: 'allowed', sourceType: 'boq_change_order', sourceId: String(row.id), sourceLocked: row.status === 'approved', periodNo: '', applicationDate: text(row.application_date) || null, approvalDate: text(row.approved_at) || null, status: text(row.status), statusNote: text(row.status_note), amount: number(row.approved_tax_inclusive_amount ?? row.total_amount), boqAmount: number(row.total_amount), taxExclusiveAmount: number(row.approved_tax_exclusive_amount), appliedTaxExclusiveAmount: number(row.applied_tax_exclusive_amount), auditedAmount: null, note: text(row.reason) || text(row.note), version: 1, createdAt: time(row.created_at), updatedAt: time(row.updated_at), lines: lines.filter(line => source.changeLines.find(raw => raw.id === line.id)?.deleted_at == null), files: [], legacyLedgerId: row.ledger_id == null ? null : String(row.ledger_id), migrationBatchId: importId }
          await tx.execute('INSERT INTO boq_change_records VALUES (?,?,?,?,?,?,?)', [document.id, head.projectId, head.id, quantityCanonical(document), document.createdAt, document.updatedAt, row.deleted_at == null ? null : time(row.deleted_at)])
        }
        const manual = source.ledgers.filter(row => row.source_type === 'manual')
        for (const row of manual) {
          const head = headFor(row.contract_id)
          const id = String(row.id)
          await assertUnused('boq_change_records', id)
          const document: ProductionBoqChangeDocument = { dataOrigin: 'real', kind: 'owner_change', id, no: text(row.change_no), name: text(row.name), documentType: text(row.document_type), projectId: head.projectId!, projectName: '', projectPermission: 'allowed', customerId: head.customerId, customerName: '', customerPermission: 'allowed', contractId: head.id, contractNo: head.no, contractName: text(row.contract_name) || head.name, contractPermission: 'allowed', sourceType: 'manual', sourceId: id, sourceLocked: row.source_locked === 1, periodNo: '', applicationDate: text(row.application_date) || null, approvalDate: text(row.approval_date) || null, status: text(row.status), statusNote: text(row.status_note), amount: number(row.tax_inc_amount), boqAmount: null, taxExclusiveAmount: number(row.tax_exc_amount), appliedTaxExclusiveAmount: number(row.applied_amount), auditedAmount: null, note: text(row.note), version: 1, createdAt: time(row.created_at), updatedAt: time(row.updated_at), lines: [], files: [], legacyLedgerId: id, migrationBatchId: importId }
          await tx.execute('INSERT INTO boq_change_records VALUES (?,?,?,?,?,?,?)', [id, head.projectId, head.id, quantityCanonical(document), document.createdAt, document.updatedAt, row.deleted_at == null ? null : time(row.deleted_at)])
        }
        for (const row of source.lines) {
          const head = headFor(row.contract_id)
          const id = String(row.id)
          await assertUnused('boq_lines', id)
          const line: BoqLineRecord = { id, projectId: head.projectId!, contractId: head.id, fileId: row.boq_file_id == null ? null : String(row.boq_file_id), changeId: row.change_order_id == null ? null : String(row.change_order_id), itemId: itemFor(row.item_id, head.projectId!), itemName: text(row.item_name), unit: text(row.unit), qty: number(row.qty), unitPrice: number(row.unit_price), building: text(row.building) || null, unitType: text(row.unit_type) || null, floorZone: text(row.floor_zone) || null, section: text(row.section), trade: text(row.trade), room: text(row.room), spec: text(row.spec), multiplier: number(row.multiplier), taxRate: number(row.tax_rate), ownerSupplied: row.owner_supplied === 1, recognizedQty: number(row.recognized_qty), recognizedUnitPrice: number(row.recognized_unit_price), traceKey: text(row.trace_key), sourceSheet: text(row.source_sheet), sourceRow: number(row.source_row), confirmedOriginal: row.boq_file_id != null && source.files.find(file => file.id === row.boq_file_id)?.parse_status === 'parsed', createdAt: time(row.created_at), updatedAt: time(row.updated_at), deletedAt: row.deleted_at == null ? null : time(row.deleted_at) }
          await tx.execute('INSERT INTO boq_lines VALUES (?,?,?,?,?,?,?,?,?,?)', [id, line.fileId, line.changeId, line.projectId, head.id, line.itemId, quantityCanonical(line), line.createdAt, line.updatedAt, line.deletedAt])
        }
        for (const row of source.prices) {
          const nativeFile = source.files.find(file => file.id === row.boq_file_id)!
          const head = headFor(nativeFile.contract_id)
          const id = String(row.id)
          await assertUnused('item_unit_prices', id)
          const price: BoqPriceRecord = { id, projectId: head.projectId!, contractId: head.id, fileId: String(row.boq_file_id), itemId: itemFor(row.item_id, head.projectId!), itemName: text(row.item_name), itemCode: text(row.item_code), unit: text(row.unit), unitPrice: number(row.unit_price), spec: text(row.spec), traceKey: text(row.trace_key), sourceSheet: text(row.source_sheet), sourceRow: number(row.source_row), createdAt: time(row.created_at), updatedAt: time(row.updated_at), deletedAt: row.deleted_at == null ? null : time(row.deleted_at) }
          await tx.execute('INSERT INTO item_unit_prices VALUES (?,?,?,?,?,?,?,?,?)', [id, price.projectId, head.id, price.fileId, price.itemId, quantityCanonical(price), price.createdAt, price.updatedAt, price.deletedAt])
        }
        for (const raw of source.attachments) {
          const id = String(raw.id)
          if (!embeddedRefs.has(id))
            await assertUnused('file_refs', id)
          const body = source.payloads.find(body => body.file_ref_id === id)
          const bytes = body ? Buffer.from(String(body.content), 'base64') : null
          if (!bytes && raw.file_path)
            return boqFail('validation-failed', '原变洽签路径证据原件未补齐，不能当作历史无正文')
          if (bytes && raw.file_size != null && raw.file_size !== bytes.length)
            return boqFail('validation-failed', '原变洽签文件大小与完整正文不同')
          if (!embeddedRefs.has(id)) {
            await tx.execute('INSERT INTO file_refs VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, raw.owner_type, raw.owner_id, text(raw.file_name), text(raw.file_path), bytes?.length ?? Number(raw.file_size ?? 0), text(raw.mime_type), text(raw.category), text(raw.uploader), raw.uploaded_at == null ? '' : time(raw.uploaded_at), raw.deleted_at == null ? null : time(raw.deleted_at)])
            if (bytes)
              await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [id, bytes, hashBytes(bytes)])
            else metadataOnlyFileIds.push(id)
          }
          const order = raw.owner_type === 'boq_change_order' ? source.changes.find(row => row.id === raw.owner_id) : source.changes.find(row => row.ledger_id === raw.owner_id) ?? manual.find(row => row.id === raw.owner_id)
          if (order) {
            const [stored] = await tx.select<{ record_json: string }>('SELECT record_json FROM boq_change_records WHERE id=?', [order.id])
            const document = JSON.parse(stored!.record_json) as OwnerCommercialDocumentSource
            document.files.push({ id, fileName: text(raw.file_name), fileSize: bytes?.length ?? Number(raw.file_size ?? 0), mimeType: text(raw.mime_type), category: text(raw.category), uploader: text(raw.uploader), uploadedAt: raw.uploaded_at == null ? null : time(raw.uploaded_at), deletedAt: raw.deleted_at == null ? null : time(raw.deleted_at) })
            await tx.execute('UPDATE boq_change_records SET record_json=? WHERE id=?', [quantityCanonical(document), order.id])
          }
          fileProofs.push({ id, logicalFileId: order?.id ?? String(raw.owner_id), sha256: bytes ? hashBytes(bytes) : null, fileSize: bytes?.length ?? (raw.file_size == null ? null : Number(raw.file_size)), mimeType: text(raw.mime_type), fileName: text(raw.file_name), bodyState: bytes ? 'embedded' : 'metadata-only', originalMetadata: raw })
        }
        for (const table of ['boq_files', 'boq_lines', 'item_unit_prices', 'boq_change_records']) {
          for (const row of await tx.select<{ id: string, project_id: string, contract_id: string }>(`SELECT id,project_id,contract_id FROM ${table} WHERE id IN (${(table === 'boq_files' ? source.files : table === 'boq_lines' ? source.lines : table === 'item_unit_prices' ? source.prices : source.changes).map(() => '?').join(',') || 'NULL'})`, (table === 'boq_files' ? source.files : table === 'boq_lines' ? source.lines : table === 'item_unit_prices' ? source.prices : source.changes).map(row => row.id)))
            await remember(table, row.id, row.project_id, row.contract_id)
        }
        const payloadRefs = source.payloads.map((body) => {
          const bytes = Buffer.from(String(body.content), 'base64')
          const column = Buffer.from(String(body.content), 'utf8')
          return { fileRefId: String(body.file_ref_id), encoding: 'base64' as const, sqliteType: source.raw.rows.file_payloads!.find(row => row.legacyId === body.file_ref_id)!.columns.content!.sqliteType, sha256: hashBytes(bytes), byteLength: bytes.length, columnSha256: hashBytes(column), columnByteLength: column.length }
        })
        for (const row of manual) {
          const head = headFor(row.contract_id)
          await remember('boq_change_records', String(row.id), head.projectId!, head.id, String(row.id), 'owner_change_orders')
        }
        const rawDomain = { ...source.raw.rows, file_payloads: source.raw.rows.file_payloads!.map(row => ({ ...row, columns: { ...row.columns, content: { sqliteType: row.columns.content!.sqliteType, sharedOriginal: row.legacyId, payloadReference: payloadRefs.find(ref => ref.fileRefId === row.legacyId)! } } })) }
        const evidence = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, sourceSha256: source.sourceSha256, schemaVersion: source.schemaVersion, rawDomain, sourceSchemas: source.raw.schemas, domainEvidenceDigest: boqDigest({ rawDomain, sourceSchemas: source.raw.schemas }), heads: actualHeads.map(row => ({ legacyId: row.legacyId, id: row.id, projectId: row.projectId, version: row.version })), quantityIdentities: quantityIds.filter(row => row.table === 'items' && [...source.lines, ...source.prices].some(item => item.item_id === row.legacyId)), mappings, installed, fileProofs, metadataOnlyFileIds, payloadRefs }
        const result: BoqSourceImportResult = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, importId, sourceSha256: source.sourceSha256, fileIds: source.files.map(row => String(row.id)), lineIds: source.lines.map(row => String(row.id)), changeIds: [...source.changes, ...manual].map(row => String(row.id)), priceIds: source.prices.map(row => String(row.id)) }
        await tx.execute('INSERT INTO boq_source_imports VALUES (?,?,?,?,?,?,?,?,?)', [importId, source.sourceSha256, quantityCanonical(evidence), boqDigest(evidence), actor.workspaceId, actor.actorId, command.commandId, quantityCanonical(result), new Date().toISOString()])
        for (const row of mappings)
          await tx.execute('INSERT INTO boq_source_bindings VALUES (?,?,?,?,?,?,?)', [source.sourceSha256, row.legacyId, row.sourceTable ?? row.table, row.id, row.projectId, row.contractId, importId])
        await tx.execute('INSERT INTO boq_import_commands VALUES (?,?,?,?,?,?)', [...key(command), fingerprint, quantityCanonical(result), new Date().toISOString()])
        await tx.execute('UPDATE boq_revision SET revision=revision+1 WHERE singleton=1')
        return result
      })
    })
    active.set(commandKey, { fingerprint, promise: pending })
    try {
      return await pending
    }
    finally { active.delete(commandKey) }
  }
  async function restore(input: unknown, session: Session): Promise<BoqSourceImportResult> {
    const actor = authorize(session)
    const command = boqClosed(input, ['workspaceId', 'actorId', 'commandId', 'importId', 'sourceSha256'])
    if (!['workspaceId', 'actorId', 'commandId', 'importId'].every(field => boqStableId(command[field])) || command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId || typeof command.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(command.sourceSha256))
      return boqFail('validation-failed', '恢复须使用同身份、原采用批次、完整来源SHA和独立原编号')
    const fixed = { ...command, action: 'restore' }
    const fingerprint = boqDigest(fixed)
    const commandKey = key(command as unknown as BoqSourceImportCommand)
    await run(session, true, async (tx) => {
      if ((await tx.select('SELECT command_id FROM boq_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey)).length)
        return boqFail('conflict', '原整批恢复编号已封存未应用，不能迟到重建')
      const [intent] = await tx.select<{ fingerprint: string }>('SELECT * FROM boq_import_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey)
      if (intent && intent.fingerprint !== fingerprint)
        return boqFail('conflict', '原整批恢复编号已固定另一批次或来源')
      if (!intent)
        await tx.execute('INSERT INTO boq_import_intents VALUES (?,?,?,?,?,?,?,?)', [...commandKey, 'restore', command.sourceSha256, fingerprint, quantityCanonical(fixed), new Date().toISOString()])
    })
    return run(session, true, async (tx) => {
      if ((await tx.select('SELECT command_id FROM boq_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey)).length)
        return boqFail('conflict', '原恢复编号已明确未应用，不能迟到写入')
      const [receipt] = await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM boq_import_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', commandKey)
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          return boqFail('conflict', '原恢复回执对应另一完整来源')
        return JSON.parse(receipt.result_json) as BoqSourceImportResult
      }
      const record = (await readProductionBoqImportEvidence(tx, actor)).find(row => row.importId === command.importId && row.evidence.sourceSha256 === command.sourceSha256)
      if (!record || (await tx.select('SELECT import_id FROM boq_import_restores WHERE import_id=?', [command.importId])).length)
        return boqFail('conflict', '原施工清单批次不存在、来源不同或已经恢复')
      await assertProductionBoqRestoreSafe(tx, record.evidence)
      const now = new Date().toISOString()
      for (const mapping of record.evidence.mappings) {
        const [row] = await tx.select<{ record_json: string }>(`SELECT record_json FROM ${mapping.table} WHERE id=?`, [mapping.id])
        const value = JSON.parse(row!.record_json)
        if (Object.hasOwn(value, 'deletedAt'))
          value.deletedAt = now
        await tx.execute(`UPDATE ${mapping.table} SET deleted_at=?,record_json=? WHERE id=?`, [now, quantityCanonical(value), mapping.id])
      }
      const [source] = await tx.select<{ result_json: string }>('SELECT result_json FROM boq_source_imports WHERE id=?', [record.importId])
      const result: BoqSourceImportResult = { ...JSON.parse(source!.result_json), commandId: command.commandId, restored: true }
      await tx.execute('INSERT INTO boq_import_restores VALUES (?,?,?,?,?,?)', [record.importId, actor.workspaceId, actor.actorId, command.commandId, quantityCanonical(result), now])
      await tx.execute('INSERT INTO boq_import_commands VALUES (?,?,?,?,?,?)', [...commandKey, fingerprint, quantityCanonical(result), now])
      await tx.execute('UPDATE boq_revision SET revision=revision+1 WHERE singleton=1')
      return result
    })
  }
  async function resolve(input: unknown, session: Session) {
    const actor = authorize(session)
    const descriptor = boqClosed(input, ['workspaceId', 'actorId', 'commandId', 'family', 'targetId', 'action', 'scopeId']) as unknown as CommandRecoveryDescriptor
    if (descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || !boqStableId(descriptor.commandId) || descriptor.family !== 'boq-import' || !['adopt', 'restore'].includes(descriptor.action) || !/^[a-f0-9]{64}$/.test(String(descriptor.scopeId)) || (descriptor.action === 'adopt' ? descriptor.targetId !== descriptor.scopeId : !boqStableId(descriptor.targetId)))
      return boqFail('validation-failed', '原整批清单恢复只接受原SHA/批次和同身份最小定位')
    await active.get(quantityCanonical(key(descriptor)))?.promise.catch(() => {})
    return run(session, true, async (tx) => {
      const [intent] = await tx.select<{ action: string, source_id: string, request_json: string }>('SELECT * FROM boq_import_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key(descriptor))
      if (intent) {
        const fixed = JSON.parse(intent.request_json)
        if (intent.action !== descriptor.action || intent.source_id !== descriptor.scopeId || (intent.action === 'restore' && fixed.importId !== descriptor.targetId))
          return boqFail('conflict', '恢复动作、原来源或批次不是原整批提交')
      }
      const [receipt] = await tx.select<{ result_json: string }>('SELECT * FROM boq_import_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', key(descriptor))
      if (receipt)
        return { outcome: 'applied' as const, result: JSON.parse(receipt.result_json) as BoqSourceImportResult }
      const [sealed] = await tx.select<{ descriptor_json: string }>('SELECT * FROM boq_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key(descriptor))
      if (sealed && sealed.descriptor_json !== quantityCanonical(descriptor))
        return boqFail('conflict', '原整批编号已按其他目标封存')
      if (!sealed)
        await tx.execute('INSERT INTO boq_import_resolutions VALUES (?,?,?,?,?)', [...key(descriptor), quantityCanonical(descriptor), new Date().toISOString()])
      return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
    })
  }
  const state = (session: Session) => run(session, false, async (tx, actor) => ({ ...actor, sources: (await tx.select<{ id: string, source_sha256: string, result_json: string, created_at: string, restored_at: string | null }>('SELECT i.*,r.created_at AS restored_at FROM boq_source_imports i LEFT JOIN boq_import_restores r ON r.import_id=i.id ORDER BY i.created_at,i.id')).map(row => ({ importId: row.id, sourceSha256: row.source_sha256, importedAt: row.created_at, restored: row.restored_at !== null, original: JSON.parse(row.result_json) as BoqSourceImportResult })) }))
  return { state, preflight, adopt, restore, resolve }
}
