import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralInvoiceCommandResult, CentralInvoiceRecord } from '../../app/lib/invoice/central-contract'
import type { InvoiceCorrectionAttachment, InvoiceCorrectionContent, InvoiceCorrectionDraft, InvoiceCorrectionResolutionRequest, InvoiceCorrectionResult, InvoiceCorrectionSaveCommand, InvoiceCorrectionSubmitCommand, InvoiceCorrectionSubmitResult } from '../../app/lib/invoice/correction-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { CentralInvoiceProblem, INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY } from '../../app/lib/invoice/central-contract'
import { invoiceCorrectionChanges } from '../../app/lib/invoice/correction-contract'
import { contractOriginalBytes, contractOriginalDigest } from './contract-original'
import { financeCommandFingerprint } from './production-finance-request'
import { invoiceContractCapability } from './production-invoice-contracts'
import { readCorrectionBaselineIdentity, readInvoiceCorrectionStart } from './production-invoice-correction-start'
import { contractReference, invoiceFields, invoiceItems, readProductionInvoiceFact, validateProductionInvoiceJournal, validOwner } from './production-invoice-service'
import { createReadMeta, withReadMeta } from './read-meta'

type Row = Record<string, unknown>
type Session = () => BusinessSession
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const exact = (value: Row, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',')
function fail(code: ConstructorParameters<typeof CentralInvoiceProblem>[0], message: string): never {
  throw new CentralInvoiceProblem(code, message)
}
function parse(value: unknown): unknown {
  try {
    return JSON.parse(String(value))
  }
  catch {
    return fail('unavailable', '更正单原证据损坏，不能覆盖或推断。')
  }
}
function content(value: unknown, code: 'validation-failed' | 'unavailable'): InvoiceCorrectionContent {
  if (!object(value) || !exact(value, ['fields', 'items', 'ownerKind', 'projectId', 'supplierId', 'supplierVersion', 'buyer', 'contract']) || !validOwner(value) || !contractReference(value.contract)
    || !(value.supplierVersion === null || (version(value.supplierVersion) && value.supplierId !== null))
    || !(value.buyer === null || (object(value.buyer) && exact(value.buyer, ['id', 'version']) && id(value.buyer.id) && version(value.buyer.version)))) {
    return fail(code, '更正票面或主体关系格式无效。')
  }
  return { fields: invoiceFields(value.fields, code), items: invoiceItems(value.items, code), ownerKind: value.ownerKind as InvoiceCorrectionContent['ownerKind'], projectId: value.projectId as string | null, supplierId: value.supplierId as string | null, supplierVersion: value.supplierVersion as string | null, buyer: value.buyer as InvoiceCorrectionContent['buyer'], contract: value.contract }
}
function attachment(value: unknown): value is InvoiceCorrectionAttachment {
  return object(value) && exact(value, ['id', 'fileName', 'fileSize', 'mimeType', 'sha256']) && id(value.id)
    && typeof value.fileName === 'string' && !!value.fileName.trim() && value.fileName.length <= 240 && !/[/\\]/.test(value.fileName)
    && Number.isSafeInteger(value.fileSize) && Number(value.fileSize) >= 0 && Number(value.fileSize) <= 10 * 1024 * 1024
    && typeof value.mimeType === 'string' && value.mimeType.length <= 120 && hash(value.sha256)
}
async function assertReadSources(tx: TransactionDb, actor: BusinessSession, invoiceId: string, correction?: InvoiceCorrectionDraft) {
  const invoice = await readProductionInvoiceFact(tx, invoiceId)
  const values = correction ? [invoice, correction.baseline, correction.proposed] : [invoice]
  if (!actor.capabilities.includes('our-signatory:read')
    || (values.some(item => item.projectId) && !actor.capabilities.includes('project:list:read'))
    || (values.some(item => item.supplierId) && !actor.capabilities.includes('supplier:list:read'))
    || values.some(item => item.contract && !actor.capabilities.includes(invoiceContractCapability(item.contract.domain)))) {
    return fail('forbidden', '没有更正单主体、项目、分供方或合同来源读取权限。')
  }
}
function draft(value: unknown): InvoiceCorrectionDraft {
  if (!object(value) || !exact(value, ['id', 'invoiceId', 'baseInvoiceVersion', 'version', 'state', 'baseline', 'proposed', 'reason', 'attachments', 'createdAt', 'updatedAt', 'submittedAt', 'resultInvoiceVersion'])
    || !id(value.id) || !id(value.invoiceId) || !version(value.baseInvoiceVersion) || !version(value.version)
    || !['draft', 'submitted'].includes(String(value.state)) || typeof value.reason !== 'string' || value.reason.length > 2000
    || !Array.isArray(value.attachments) || value.attachments.length > 50 || !value.attachments.every(attachment) || new Set(value.attachments.map(file => file.id)).size !== value.attachments.length
    || !['createdAt', 'updatedAt'].every(key => typeof value[key] === 'string' && Number.isFinite(Date.parse(String(value[key]))))
    || (value.state === 'draft' ? value.submittedAt !== null || value.resultInvoiceVersion !== null : typeof value.submittedAt !== 'string' || !Number.isFinite(Date.parse(value.submittedAt)) || !version(value.resultInvoiceVersion))) {
    return fail('unavailable', '更正单身份、状态或原附件目录损坏。')
  }
  return { ...value, baseline: content(value.baseline, 'unavailable'), proposed: content(value.proposed, 'unavailable') } as unknown as InvoiceCorrectionDraft
}
interface NormalizedFile { fileName: string, fileSize: number, mimeType: string, sha256: string }
function normalized(input: unknown) {
  if (!object(input) || !exact(input, ['action', 'workspaceId', 'actorId', 'commandId', 'requiredCapability', 'invoiceId', 'baseInvoiceVersion', 'correctionId', 'baseCorrectionVersion', 'reason', 'proposed', 'keepFileIds', 'addFiles'])
    || input.action !== 'save-draft' || input.requiredCapability !== INVOICE_WRITE_CAPABILITY
    || !id(input.workspaceId) || !id(input.actorId) || !id(input.commandId) || !id(input.invoiceId) || !version(input.baseInvoiceVersion)
    || !(input.correctionId === null ? input.baseCorrectionVersion === null : id(input.correctionId) && version(input.baseCorrectionVersion))
    || typeof input.reason !== 'string' || input.reason.length > 2000 || !Array.isArray(input.keepFileIds) || !input.keepFileIds.every(id)
    || new Set(input.keepFileIds).size !== input.keepFileIds.length || !Array.isArray(input.addFiles) || input.addFiles.length > 50 || input.keepFileIds.length + input.addFiles.length > 50) {
    return fail('validation-failed', '更正草稿身份、版本或附件格式无效。')
  }
  const files = input.addFiles.map((raw) => {
    if (!object(raw) || !exact(raw, ['fileName', 'fileSize', 'mimeType', 'payloadBase64']) || typeof raw.fileName !== 'string' || raw.fileName.length > 240 || /[/\\]/.test(raw.fileName)
      || typeof raw.mimeType !== 'string' || raw.mimeType.length > 120) {
      return fail('validation-failed', '更正附件元数据无效。')
    }
    const bytes = contractOriginalBytes(raw as unknown as InvoiceCorrectionSaveCommand['addFiles'][number], { required: true, fail: message => fail('validation-failed', message) })!
    return { fileName: raw.fileName.trim(), fileSize: bytes.length, mimeType: raw.mimeType, sha256: contractOriginalDigest(bytes), bytes }
  })
  const proof = { ...input, reason: input.reason.trim(), proposed: content(input.proposed, 'validation-failed'), addFiles: files.map(({ bytes: _bytes, ...metadata }) => metadata) } as unknown as Omit<InvoiceCorrectionSaveCommand, 'addFiles'> & { addFiles: NormalizedFile[] }
  return { proof, files }
}
function submitCommand(input: unknown): InvoiceCorrectionSubmitCommand {
  if (!object(input) || !exact(input, ['action', 'workspaceId', 'actorId', 'commandId', 'requiredCapability', 'invoiceId', 'baseInvoiceVersion', 'correctionId', 'baseCorrectionVersion', 'confirmed'])
    || input.action !== 'submit' || input.requiredCapability !== INVOICE_WRITE_CAPABILITY || input.confirmed !== true || !id(input.workspaceId) || !id(input.actorId) || !id(input.commandId) || !id(input.invoiceId)
    || !version(input.baseInvoiceVersion) || !id(input.correctionId) || !version(input.baseCorrectionVersion)) {
    return fail('validation-failed', '更正提交身份、版本或明确确认无效。')
  }
  return input as unknown as InvoiceCorrectionSubmitCommand
}

/** Verify every correction version, command, file body and frozen baseline before use. */
export async function validateInvoiceCorrections(tx: TransactionDb, actor: Pick<BusinessSession, 'workspaceId' | 'actorId'>) {
  const [revision] = await tx.select<{ revision: number }>('SELECT revision FROM invoice_correction_revision WHERE singleton=1')
  const heads = await tx.select<Row>('SELECT * FROM invoice_corrections')
  const histories = await tx.select<Row>('SELECT * FROM invoice_correction_versions')
  const receipts = await tx.select<Row>('SELECT * FROM invoice_correction_receipts')
  const resolutions = await tx.select<Row>('SELECT * FROM invoice_correction_resolutions')
  if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision !== receipts.length + resolutions.length)
    fail('unavailable', '更正来源版本与原回执数量不一致。')
  const files = await tx.select<Row>('SELECT b.*,f.owner_type,f.owner_id,f.file_name,f.file_size,f.mime_type,f.deleted_at,p.content,p.sha256 AS payload_sha256 FROM invoice_correction_files b LEFT JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id')
  const referencedFiles = new Set<string>()
  if (resolutions.some(row => row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || receipts.some(receipt => receipt.command_id === row.command_id)))
    fail('unavailable', '更正原编号封存与回执冲突。')
  for (const row of heads) {
    const current = draft(parse(row.record_json))
    if (row.id !== current.id || row.invoice_id !== current.invoiceId || String(row.base_invoice_version) !== current.baseInvoiceVersion || String(row.version) !== current.version || row.state !== current.state
      || row.created_at !== current.createdAt || row.updated_at !== current.updatedAt || row.submitted_at !== current.submittedAt || (row.result_invoice_version === null ? null : String(row.result_invoice_version)) !== current.resultInvoiceVersion
      || !isDeepStrictEqual(parse(row.baseline_json), current.baseline)) {
      fail('unavailable', '更正单索引与冻结正文不一致。')
    }
    const prior = histories.filter(entry => entry.correction_id === current.id).sort((a, b) => Number(a.version) - Number(b.version))
    if (prior.length !== Number(current.version) || prior.some((entry, index) => entry.version !== index + 1) || !isDeepStrictEqual(draft(parse(prior.at(-1)?.snapshot_json)), current))
      fail('unavailable', '更正版本缺失或不连续。')
    const audits = await tx.select<{ after_json: string }>('SELECT after_json FROM invoice_audits WHERE invoice_id=?', [current.invoiceId])
    const base = audits.map(entry => parse(entry.after_json)).find(entry => object(entry) && entry.version === current.baseInvoiceVersion)
    if (!object(base) || base.id !== current.invoiceId || !isDeepStrictEqual(base.fields, current.baseline.fields) || !isDeepStrictEqual(base.items, current.baseline.items)
      || base.ownerKind !== current.baseline.ownerKind || base.projectId !== current.baseline.projectId || base.supplierId !== current.baseline.supplierId || !isDeepStrictEqual(base.contract, current.baseline.contract)) {
      fail('unavailable', '更正基准与原票历史不一致。')
    }
    const identities = await readCorrectionBaselineIdentity(tx, base as unknown as CentralInvoiceRecord)
    if (!isDeepStrictEqual(identities.buyer, current.baseline.buyer) || identities.supplierVersion !== current.baseline.supplierVersion)
      fail('unavailable', '更正基准中的主体身份缺少原归档证据。')
    let preceding: InvoiceCorrectionDraft | null = null
    for (const entry of prior) {
      const snapshot = draft(parse(entry.snapshot_json))
      const receipt = receipts.find(item => item.command_id === entry.command_id)
      if (!receipt || receipt.correction_id !== current.id || receipt.workspace_id !== actor.workspaceId || receipt.actor_id !== actor.actorId || entry.actor_id !== actor.actorId || receipt.created_at !== entry.created_at
        || snapshot.id !== current.id || snapshot.version !== String(entry.version) || snapshot.invoiceId !== current.invoiceId || snapshot.baseInvoiceVersion !== current.baseInvoiceVersion || !isDeepStrictEqual(snapshot.baseline, current.baseline)) {
        fail('unavailable', '更正原版本与回执缺失或串归属。')
      }
      const proof = parse(receipt.request_json)
      const result = parse(receipt.result_json)
      const submitting = receipt.action === 'submit'
      const commonKeys = ['action', 'workspaceId', 'actorId', 'commandId', 'requiredCapability', 'invoiceId', 'baseInvoiceVersion', 'correctionId', 'baseCorrectionVersion']
      if (!object(proof) || !object(result) || !exact(proof, [...commonKeys, ...(submitting ? ['confirmed'] : ['reason', 'proposed', 'keepFileIds', 'addFiles'])])
        || !exact(result, ['commandId', 'correctionId', 'invoiceId', 'version', 'updatedAt', ...(submitting ? ['invoiceVersion'] : [])]) || !['save-draft', 'submit'].includes(String(receipt.action))
        || receipt.fingerprint !== financeCommandFingerprint(proof) || proof.workspaceId !== actor.workspaceId || proof.actorId !== actor.actorId || proof.requiredCapability !== INVOICE_WRITE_CAPABILITY
        || proof.commandId !== receipt.command_id || proof.action !== receipt.action || proof.invoiceId !== current.invoiceId || proof.baseInvoiceVersion !== current.baseInvoiceVersion
        || proof.correctionId !== (preceding?.id ?? null) || proof.baseCorrectionVersion !== (preceding?.version ?? null)
        || result.commandId !== receipt.command_id || result.invoiceId !== current.invoiceId || result.correctionId !== current.id || result.version !== snapshot.version || result.updatedAt !== snapshot.updatedAt || snapshot.updatedAt !== receipt.created_at || snapshot.createdAt !== current.createdAt) {
        fail('unavailable', '更正原命令、指纹和结果不一致。')
      }
      if (submitting) {
        if (!preceding || preceding.state !== 'draft' || snapshot.state !== 'submitted' || proof.confirmed !== true || snapshot.submittedAt !== snapshot.updatedAt
          || snapshot.resultInvoiceVersion !== String(Number(snapshot.baseInvoiceVersion) + 1) || result.invoiceVersion !== snapshot.resultInvoiceVersion
          || !isDeepStrictEqual(snapshot.proposed, preceding.proposed) || snapshot.reason !== preceding.reason || !isDeepStrictEqual(snapshot.attachments, preceding.attachments)) {
          fail('unavailable', '更正提交与原草稿或确认结果不一致。')
        }
        const [invoiceReceipt] = await tx.select<Row>('SELECT * FROM invoice_command_receipts WHERE command_id=?', [receipt.command_id])
        const invoiceResult = invoiceReceipt ? parse(invoiceReceipt.result_json) : null
        if (!invoiceReceipt || invoiceReceipt.action !== 'correct' || invoiceReceipt.invoice_id !== current.invoiceId || invoiceReceipt.fingerprint !== receipt.fingerprint
          || !object(invoiceResult) || invoiceResult.commandId !== receipt.command_id || invoiceResult.invoiceId !== current.invoiceId || invoiceResult.version !== snapshot.resultInvoiceVersion || invoiceResult.updatedAt !== snapshot.updatedAt) {
          fail('unavailable', '更正提交缺少同一原票版本回执。')
        }
      }
      else {
        if (snapshot.state !== 'draft' || !isDeepStrictEqual(proof.proposed, snapshot.proposed) || proof.reason !== snapshot.reason || !Array.isArray(proof.keepFileIds) || !Array.isArray(proof.addFiles))
          fail('unavailable', '更正草稿与原提交内容不一致。')
        const retained = proof.keepFileIds.map(fileId => preceding?.attachments.find(item => item.id === fileId))
        const additions = snapshot.attachments.slice(retained.length)
        if (retained.some(item => !item) || new Set(proof.keepFileIds).size !== proof.keepFileIds.length || !isDeepStrictEqual(snapshot.attachments.slice(0, retained.length), retained)
          || !isDeepStrictEqual(additions.map(({ id: _id, ...metadata }) => metadata), proof.addFiles)) {
          fail('unavailable', '更正附件与原命令不一致。')
        }
      }
      for (const item of snapshot.attachments) {
        referencedFiles.add(item.id)
        const bound = files.find(file => file.file_ref_id === item.id && file.correction_id === current.id)
        if (!bound || bound.owner_type !== 'invoice_correction' || bound.owner_id !== current.id || bound.file_name !== item.fileName || bound.file_size !== item.fileSize || bound.mime_type !== item.mimeType || bound.deleted_at !== null
          || bound.sha256 !== item.sha256 || bound.payload_sha256 !== item.sha256 || !(bound.content instanceof Uint8Array) || bound.content.length !== item.fileSize || contractOriginalDigest(bound.content) !== item.sha256) {
          fail('unavailable', '更正附件原件缺失、损坏或串归属。')
        }
      }
      preceding = snapshot
    }
  }
  if (histories.some(row => !heads.some(head => head.id === row.correction_id)) || receipts.length !== histories.length || files.some(row => !heads.some(head => head.id === row.correction_id) || !referencedFiles.has(String(row.file_ref_id))))
    fail('unavailable', '更正原版本、回执或附件缺真实 owner。')
}

export interface InvoiceCorrectionApplyPort {
  apply: (tx: TransactionDb, actor: BusinessSession, correction: InvoiceCorrectionDraft, command: InvoiceCorrectionSubmitCommand, timestamp: string) => Promise<CentralInvoiceCommandResult>
}

export function createProductionInvoiceCorrectionService(storage: ProductionStorage, options: { invoice?: InvoiceCorrectionApplyPort } = {}) {
  function authorize(session: Session, write: boolean) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes(INVOICE_READ_CAPABILITY) || (write && !actor.capabilities.includes(INVOICE_WRITE_CAPABILITY)))
      return fail('forbidden', '没有当前工作区发票更正权限。')
    return actor
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>): Promise<T> {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      if (!isDeepStrictEqual(actor, authorize(session, write)))
        fail('forbidden', '更正排队期间权限或身份已变化。')
      await validateProductionInvoiceJournal(tx, actor)
      await validateInvoiceCorrections(tx, actor)
      const result = await work(tx, actor)
      await validateProductionInvoiceJournal(tx, actor)
      await validateInvoiceCorrections(tx, actor)
      if (!isDeepStrictEqual(actor, authorize(session, write)))
        fail('forbidden', '更正期间权限或身份已变化，事务已撤回。')
      return result
    })
  }
  async function metadata(tx: TransactionDb, actor: BusinessSession, operation: string, scope: object) {
    const [invoice] = await tx.select<{ revision: number }>('SELECT revision FROM invoice_revision WHERE singleton=1')
    const [correction] = await tx.select<{ revision: number }>('SELECT revision FROM invoice_correction_revision WHERE singleton=1')
    if (!invoice || !correction || !Number.isSafeInteger(invoice.revision) || invoice.revision < 0 || !Number.isSafeInteger(correction.revision) || correction.revision < 0)
      return fail('unavailable', '发票或更正来源版本不可核实。')
    const asOf = new Date().toISOString()
    return createReadMeta({ session: actor, schemaVersion: 'invoice-correction-read-v1', operation: `invoice-correction:${operation}`, dataOrigin: 'real', asOf, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${invoice.revision}`, asOf }, { key: 'invoice-corrections', state: 'readable', sourceVersion: `invoice-corrections:${correction.revision}`, asOf }], coverage: 'complete', scope })
  }
  return {
    startRead(invoiceId: string, baseInvoiceVersion: string, session: Session) {
      if (!id(invoiceId) || !version(baseInvoiceVersion))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '原票身份或版本无效。'))
      return run(session, false, async (tx, actor) => withReadMeta({ dataOrigin: 'real' as const, ...(await readInvoiceCorrectionStart(tx, actor, invoiceId, baseInvoiceVersion)) }, await metadata(tx, actor, 'start', { invoiceId, baseInvoiceVersion })))
    },
    listRead(invoiceId: string, session: Session) {
      if (!id(invoiceId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '原票身份无效。'))
      return run(session, false, async (tx, actor) => {
        await assertReadSources(tx, actor, invoiceId)
        const rows = await tx.select<Row>('SELECT record_json FROM invoice_corrections WHERE invoice_id=? ORDER BY created_at DESC,id', [invoiceId])
        const items = rows.map(row => draft(parse(row.record_json)))
        for (const item of items)
          await assertReadSources(tx, actor, invoiceId, item)
        return withReadMeta({ dataOrigin: 'real' as const, items }, await metadata(tx, actor, 'list', { invoiceId }))
      })
    },
    getRead(correctionId: string, session: Session) {
      if (!id(correctionId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '更正单身份无效。'))
      return run(session, false, async (tx, actor) => {
        const [row] = await tx.select<Row>('SELECT record_json FROM invoice_corrections WHERE id=?', [correctionId])
        if (!row)
          return fail('not-found', '更正单不存在。')
        const record = draft(parse(row.record_json))
        await assertReadSources(tx, actor, record.invoiceId, record)
        return withReadMeta({ dataOrigin: 'real' as const, record }, await metadata(tx, actor, 'detail', { correctionId }))
      })
    },
    historyRead(correctionId: string, session: Session) {
      if (!id(correctionId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '更正单身份无效。'))
      return run(session, false, async (tx, actor) => {
        const rows = await tx.select<Row>('SELECT snapshot_json AS record_json,actor_id,command_id,created_at FROM invoice_correction_versions WHERE correction_id=? ORDER BY version', [correctionId])
        if (!rows.length)
          return fail('not-found', '更正单不存在。')
        const items = rows.map(row => ({ record: draft(parse(row.record_json)), actorId: String(row.actor_id), commandId: String(row.command_id), createdAt: String(row.created_at) }))
        for (const item of items)
          await assertReadSources(tx, actor, item.record.invoiceId, item.record)
        return withReadMeta({ dataOrigin: 'real' as const, items }, await metadata(tx, actor, 'history', { correctionId }))
      })
    },
    file(correctionId: string, fileId: string, session: Session) {
      if (!id(correctionId) || !id(fileId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '更正单或附件身份无效。'))
      return run(session, false, async (tx, actor) => {
        const rows = await tx.select<Row>('SELECT snapshot_json AS record_json FROM invoice_correction_versions WHERE correction_id=? ORDER BY version', [correctionId])
        const versions = rows.map(row => draft(parse(row.record_json))).filter(item => item.attachments.some(file => file.id === fileId))
        if (!versions.length)
          return fail('not-found', '附件不属于该更正单。')
        for (const item of versions)
          await assertReadSources(tx, actor, item.invoiceId, item)
        const [file] = await tx.select<Row>('SELECT f.file_name,p.content,p.sha256 FROM invoice_correction_files b JOIN file_refs f ON f.id=b.file_ref_id JOIN file_payloads p ON p.file_ref_id=b.file_ref_id WHERE b.correction_id=? AND b.file_ref_id=?', [correctionId, fileId])
        if (!file || typeof file.file_name !== 'string' || typeof file.sha256 !== 'string' || !(file.content instanceof Uint8Array))
          return fail('unavailable', '更正附件原件不可核实。')
        return { fileName: file.file_name, sha256: file.sha256, bytes: Buffer.from(file.content) }
      })
    },
    saveDraft(input: unknown, session: Session): Promise<InvoiceCorrectionResult> {
      const { proof, files } = normalized(input)
      return run(session, true, async (tx, actor) => {
        if (proof.workspaceId !== actor.workspaceId || proof.actorId !== actor.actorId)
          return fail('forbidden', '更正命令与当前身份不一致。')
        const [sealed] = await tx.select<Row>('SELECT command_id FROM invoice_correction_resolutions WHERE command_id=?', [proof.commandId])
        if (sealed)
          return fail('conflict', '原更正编号已封存，迟到请求不能写入。')
        const [prior] = await tx.select<Row>('SELECT * FROM invoice_correction_receipts WHERE command_id=?', [proof.commandId])
        if (prior) {
          if (prior.fingerprint !== financeCommandFingerprint(proof))
            return fail('conflict', '原更正编号不能用于不同内容。')
          return parse(prior.result_json) as InvoiceCorrectionResult
        }
        for (const table of ['invoice_command_receipts', 'invoice_command_resolutions', 'invoice_print_receipts']) {
          if ((await tx.select(`SELECT command_id FROM ${table} WHERE command_id=?`, [proof.commandId])).length)
            return fail('conflict', '该编号已用于其他发票操作。')
        }
        const start = await readInvoiceCorrectionStart(tx, actor, String(proof.invoiceId), String(proof.baseInvoiceVersion))
        const [row] = proof.correctionId ? await tx.select<Row>('SELECT * FROM invoice_corrections WHERE id=?', [proof.correctionId]) : []
        const previous = row ? draft(parse(row.record_json)) : null
        if (proof.correctionId && (!previous || previous.invoiceId !== proof.invoiceId))
          return fail('not-found', '更正草稿不存在或不属于当前发票。')
        if (previous && (previous.state !== 'draft' || previous.version !== proof.baseCorrectionVersion || previous.baseInvoiceVersion !== proof.baseInvoiceVersion))
          return fail('conflict', '更正草稿或原票版本已变化。')
        const known = previous?.attachments ?? []
        const kept = (proof.keepFileIds as string[]).map(fileId => known.find(file => file.id === fileId))
        if (kept.some(file => !file))
          return fail('validation-failed', '更正附件不属于当前草稿。')
        const now = new Date().toISOString()
        const correctionId = previous?.id ?? randomUUID()
        const added: InvoiceCorrectionAttachment[] = files.map(file => ({ id: randomUUID(), fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType, sha256: file.sha256 }))
        const record: InvoiceCorrectionDraft = { id: correctionId, invoiceId: String(proof.invoiceId), baseInvoiceVersion: String(proof.baseInvoiceVersion), version: String(previous ? Number(previous.version) + 1 : 1), state: 'draft', baseline: previous?.baseline ?? start.baseline, proposed: proof.proposed as InvoiceCorrectionContent, reason: String(proof.reason), attachments: [...kept as InvoiceCorrectionAttachment[], ...added], createdAt: previous?.createdAt ?? now, updatedAt: now, submittedAt: null, resultInvoiceVersion: null }
        await assertReadSources(tx, actor, record.invoiceId, record)
        if (previous)
          await tx.execute('UPDATE invoice_corrections SET version=?,record_json=?,updated_at=? WHERE id=?', [Number(record.version), JSON.stringify(record), now, correctionId])
        else
          await tx.execute('INSERT INTO invoice_corrections VALUES(?,?,?,?,?,?,?,?,?,?,?)', [correctionId, record.invoiceId, Number(record.baseInvoiceVersion), 1, 'draft', JSON.stringify(record.baseline), JSON.stringify(record), now, now, null, null])
        for (const [index, file] of files.entries()) {
          const metadata = added[index]!
          await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,\'invoice_correction\',?,?,?,?,\'correction-evidence\',?,?)', [metadata.id, correctionId, metadata.fileName, metadata.fileSize, metadata.mimeType, actor.actorId, now])
          await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [metadata.id, Buffer.from(file.bytes), metadata.sha256])
          await tx.execute('INSERT INTO invoice_correction_files VALUES(?,?,?)', [metadata.id, correctionId, metadata.sha256])
        }
        const result: InvoiceCorrectionResult = { commandId: String(proof.commandId), correctionId, invoiceId: record.invoiceId, version: record.version, updatedAt: now }
        await tx.execute('INSERT INTO invoice_correction_receipts VALUES(?,?,?,?,?,?,?,?,?)', [proof.commandId, actor.workspaceId, actor.actorId, correctionId, 'save-draft', financeCommandFingerprint(proof), JSON.stringify(proof), JSON.stringify(result), now])
        await tx.execute('INSERT INTO invoice_correction_versions VALUES(?,?,?,?,?,?)', [correctionId, Number(record.version), proof.commandId, actor.actorId, JSON.stringify(record), now])
        await tx.execute('UPDATE invoice_correction_revision SET revision=revision+1 WHERE singleton=1')
        return result
      })
    },
    submit(input: unknown, session: Session): Promise<InvoiceCorrectionSubmitResult> {
      const request = submitCommand(input)
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          return fail('forbidden', '更正提交与当前身份不一致。')
        if ((await tx.select('SELECT command_id FROM invoice_correction_resolutions WHERE command_id=?', [request.commandId])).length)
          return fail('conflict', '原更正编号已封存，迟到提交不能写入。')
        const [receipt] = await tx.select<Row>('SELECT * FROM invoice_correction_receipts WHERE command_id=?', [request.commandId])
        if (receipt) {
          if (receipt.fingerprint !== financeCommandFingerprint(request))
            return fail('conflict', '原更正编号不能用于不同内容。')
          return parse(receipt.result_json) as InvoiceCorrectionSubmitResult
        }
        for (const table of ['invoice_command_receipts', 'invoice_command_resolutions', 'invoice_print_receipts']) {
          if ((await tx.select(`SELECT command_id FROM ${table} WHERE command_id=?`, [request.commandId])).length)
            return fail('conflict', '该编号已用于其他发票操作。')
        }
        const [row] = await tx.select<Row>('SELECT * FROM invoice_corrections WHERE id=?', [request.correctionId])
        const previous = row ? draft(parse(row.record_json)) : null
        if (!previous || previous.invoiceId !== request.invoiceId)
          return fail('not-found', '更正草稿不存在或不属于当前发票。')
        if (previous.state !== 'draft' || previous.version !== request.baseCorrectionVersion || previous.baseInvoiceVersion !== request.baseInvoiceVersion)
          return fail('conflict', '更正草稿或原票版本已变化。')
        if (!previous.reason.trim() || !invoiceCorrectionChanges(previous.baseline, previous.proposed).length)
          return fail('validation-failed', '请填写更正原因并核对实际变动。')
        if (!previous.proposed.buyer || !previous.proposed.supplierId || !previous.proposed.supplierVersion)
          return fail('validation-failed', '请明确选择我方主体和已有分供方并核对来源版本。')
        await assertReadSources(tx, actor, previous.invoiceId, previous)
        const start = await readInvoiceCorrectionStart(tx, actor, previous.invoiceId, previous.baseInvoiceVersion)
        if (!isDeepStrictEqual(start.baseline, previous.baseline))
          return fail('conflict', '原票基准或来源证明已变化，请重新核对。')
        if (!options.invoice)
          return fail('unavailable', '发票更正提交尚未接通。')
        const now = new Date().toISOString()
        const invoiceResult = await options.invoice.apply(tx, actor, previous, request, now)
        const nextInvoiceVersion = String(Number(previous.baseInvoiceVersion) + 1)
        if (invoiceResult.commandId !== request.commandId || invoiceResult.invoiceId !== previous.invoiceId || invoiceResult.version !== nextInvoiceVersion || invoiceResult.updatedAt !== now)
          return fail('unavailable', '原票更新回执与更正提交不一致。')
        const record: InvoiceCorrectionDraft = { ...previous, version: String(Number(previous.version) + 1), state: 'submitted', updatedAt: now, submittedAt: now, resultInvoiceVersion: nextInvoiceVersion }
        await tx.execute('UPDATE invoice_corrections SET version=?,state=\'submitted\',record_json=?,updated_at=?,submitted_at=?,result_invoice_version=? WHERE id=?', [Number(record.version), JSON.stringify(record), now, now, Number(nextInvoiceVersion), record.id])
        const result: InvoiceCorrectionSubmitResult = { commandId: request.commandId, correctionId: record.id, invoiceId: record.invoiceId, version: record.version, invoiceVersion: nextInvoiceVersion, updatedAt: now }
        await tx.execute('INSERT INTO invoice_correction_receipts VALUES(?,?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, record.id, 'submit', financeCommandFingerprint(request), JSON.stringify(request), JSON.stringify(result), now])
        await tx.execute('INSERT INTO invoice_correction_versions VALUES(?,?,?,?,?,?)', [record.id, Number(record.version), request.commandId, actor.actorId, JSON.stringify(record), now])
        await tx.execute('UPDATE invoice_correction_revision SET revision=revision+1 WHERE singleton=1')
        return result
      })
    },
    get(correctionId: string, session: Session): Promise<InvoiceCorrectionDraft> {
      if (!id(correctionId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '更正单身份无效。'))
      return run(session, false, async (tx, actor) => {
        const [row] = await tx.select<Row>('SELECT record_json FROM invoice_corrections WHERE id=?', [correctionId])
        if (!row)
          return fail('not-found', '更正单不存在。')
        const record = draft(parse(row.record_json))
        await assertReadSources(tx, actor, record.invoiceId, record)
        return record
      })
    },
    resolve(input: unknown, session: Session): Promise<{ outcome: 'applied', result: InvoiceCorrectionResult | InvoiceCorrectionSubmitResult } | { outcome: 'not-applied', commandId: string }> {
      if (!object(input) || !exact(input, ['workspaceId', 'actorId', 'commandId', 'action', 'invoiceId', 'correctionId'])
        || !id(input.workspaceId) || !id(input.actorId) || !id(input.commandId) || !['save-draft', 'submit'].includes(String(input.action)) || !id(input.invoiceId) || !(input.correctionId === null || id(input.correctionId)) || (input.action === 'submit' && !id(input.correctionId))) {
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '更正原编号核对范围无效。'))
      }
      const request = input as unknown as InvoiceCorrectionResolutionRequest
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          return fail('forbidden', '更正原编号不属于当前身份。')
        const [receipt] = await tx.select<Row>('SELECT * FROM invoice_correction_receipts WHERE command_id=?', [request.commandId])
        if (receipt) {
          const proof = parse(receipt.request_json)
          if (!object(proof) || proof.action !== request.action || proof.invoiceId !== request.invoiceId || proof.correctionId !== request.correctionId)
            return fail('conflict', '更正原编号属于另一范围或操作。')
          const [head] = await tx.select<Row>('SELECT record_json FROM invoice_corrections WHERE id=?', [receipt.correction_id])
          if (!head)
            return fail('unavailable', '原回执缺少更正单。')
          await assertReadSources(tx, actor, request.invoiceId, draft(parse(head.record_json)))
          return { outcome: 'applied' as const, result: parse(receipt.result_json) as InvoiceCorrectionResult }
        }
        const [sealed] = await tx.select<Row>('SELECT * FROM invoice_correction_resolutions WHERE command_id=?', [request.commandId])
        if (sealed && (sealed.workspace_id !== actor.workspaceId || sealed.actor_id !== actor.actorId || sealed.action !== request.action || sealed.invoice_id !== request.invoiceId || sealed.correction_id !== request.correctionId))
          return fail('conflict', '更正原编号已封存在另一范围。')
        for (const table of ['invoice_command_receipts', 'invoice_command_resolutions', 'invoice_print_receipts']) {
          if ((await tx.select(`SELECT command_id FROM ${table} WHERE command_id=?`, [request.commandId])).length)
            return fail('conflict', '该编号已用于其他发票操作。')
        }
        await assertReadSources(tx, actor, request.invoiceId)
        if (request.correctionId) {
          const [head] = await tx.select<Row>('SELECT invoice_id FROM invoice_corrections WHERE id=?', [request.correctionId])
          if (!head || head.invoice_id !== request.invoiceId)
            return fail('not-found', '更正单不存在或不属于当前发票。')
        }
        if (!sealed) {
          await tx.execute('INSERT INTO invoice_correction_resolutions VALUES(?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, request.action, request.invoiceId, request.correctionId, new Date().toISOString()])
          await tx.execute('UPDATE invoice_correction_revision SET revision=revision+1 WHERE singleton=1')
        }
        return { outcome: 'not-applied' as const, commandId: request.commandId }
      })
    },
  }
}
