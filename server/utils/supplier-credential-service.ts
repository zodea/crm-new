import type { SupplierFormDraft } from '../../app/lib/master-data/forms'
import type { SupplierCredentialAudit, SupplierCredentialCommand, SupplierCredentialCommandResult, SupplierCredentialFileContent, SupplierCredentialFileQuery, SupplierCredentialSnapshot, SupplierCredentialUpload } from '../../app/lib/supplier/credential-contract'
import type { SupplierCredentialAggregate } from '../../app/lib/supplier/credential-domain'
import type { DataOriginDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { credentialProblem, SUPPLIER_CREDENTIAL_READ_CAPABILITY, SUPPLIER_CREDENTIAL_WRITE_CAPABILITY } from '../../app/lib/supplier/credential-contract'
import { automaticCredentialStatus, credentialRecords, credentialRequirements, credentialReviewBasis, currentCredentialStatus, normalizeCredentialValidity } from '../../app/lib/supplier/credential-domain'
import { assertSupplierCredentialFile, MAX_CREDENTIAL_FILE_BYTES } from '../../app/lib/supplier/credential-files'
import { REQUIRED_SUPPLIER_CREDENTIALS, shanghaiBusinessDate, SUPPLIER_CREDENTIAL_CATEGORIES } from '../../app/lib/supplier/credentials'

export interface SupplierCredentialScope {
  draft: SupplierFormDraft
  version: number
  aggregate: SupplierCredentialAggregate
}
export interface SupplierCredentialPorts {
  read: (supplierId: string, sessionId?: string | null) => SupplierCredentialScope
  /** 同步复制、重验及提交，不在验证与写入之间让出执行权。 */
  transact: <T>(supplierId: string, operation: (scope: SupplierCredentialScope) => { changed: boolean, value: T }, sessionId?: string | null) => T
  demoRead?: (supplierId: string, sessionId?: string | null) => SupplierCredentialScope
}

function assertRead(origin: DataOriginDTO, session: BusinessSession) {
  if (!session.capabilities.includes(SUPPLIER_CREDENTIAL_READ_CAPABILITY)
    || !session.capabilities.includes('supplier:list:read')
    || (origin === 'demo' && !session.capabilities.includes('demo:read'))) {
    throw credentialProblem('forbidden', '无当前来源的证照查看权限')
  }
}

function fileBytes(draft: SupplierCredentialUpload) {
  const limit = MAX_CREDENTIAL_FILE_BYTES
  if (!Number.isSafeInteger(draft.fileSize) || draft.fileSize < 1 || draft.fileSize > limit || draft.payloadBase64.length > Math.ceil(limit / 3) * 4)
    throw credentialProblem('validation-failed', '证照原件不能为空，且单份不能超过 20 MB')
  const bytes = Buffer.from(draft.payloadBase64, 'base64')
  if (bytes.toString('base64') !== draft.payloadBase64 || bytes.length !== draft.fileSize)
    throw credentialProblem('validation-failed', '证照正文或文件大小不一致')
  if (!draft.fileName.trim() || draft.fileName.length > 500)
    throw credentialProblem('validation-failed', '请核对证照文件名称')
  try {
    assertSupplierCredentialFile({ ...draft, fileName: draft.fileName.trim() }, bytes)
  }
  catch (error) {
    throw credentialProblem('validation-failed', (error as Error).message)
  }
  return { payloadBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function createSupplierCredentialService(ports: SupplierCredentialPorts, options: { now?: () => string, createId?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? randomUUID
  const scopeFor = (supplierId: string, origin: DataOriginDTO, sessionId?: string | null) => {
    if (origin === 'real')
      return ports.read(supplierId, sessionId)
    if (!ports.demoRead)
      throw credentialProblem('unavailable', '当前演示证照专用来源不可用')
    return ports.demoRead(supplierId, sessionId)
  }
  return {
    read(supplierId: string, origin: DataOriginDTO, session: BusinessSession, sessionId?: string | null): SupplierCredentialSnapshot {
      assertRead(origin, session)
      const scope = scopeFor(supplierId, origin, sessionId)
      if (scope.aggregate.supplierId !== supplierId)
        throw credentialProblem('relationship-mismatch', '证照与当前分供方身份不一致')
      const timestamp = now()
      const aggregate = scope.aggregate
      const status = currentCredentialStatus(aggregate, new Date(timestamp))
      return {
        dataOrigin: origin,
        supplierId,
        supplierName: scope.draft.name ?? '',
        supplierVersion: String(scope.version),
        credentialVersion: String(aggregate.version),
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        capabilities: session.capabilities.filter(capability => origin === 'real' || capability !== SUPPLIER_CREDENTIAL_WRITE_CAPABILITY),
        asOf: timestamp,
        businessDate: shanghaiBusinessDate(new Date(timestamp)),
        status,
        review: status === 'qualified' || status === 'rejected' ? structuredClone(aggregate.review) : null,
        credentials: credentialRecords(aggregate),
        requirements: credentialRequirements(aggregate),
        audits: aggregate.audits.map(audit => ({ ...structuredClone(audit), canRestore: ['delete', 'credential_delete'].includes(audit.action) && audit.deletionToken !== null && aggregate.credentials.some(row => row.id === audit.credentialId && row.deletedAt !== null && row.deletionToken === audit.deletionToken) })),
      }
    },
    file(query: SupplierCredentialFileQuery, session: BusinessSession, sessionId?: string | null): SupplierCredentialFileContent {
      assertRead(query.origin, session)
      const aggregate = scopeFor(query.supplierId, query.origin, sessionId).aggregate
      const credential = aggregate.credentials.find(row => row.id === query.credentialId && row.deletedAt === null && row.supplierId === query.supplierId)
      if (!credential)
        throw credentialProblem('not-found', '当前分供方不存在这份有效证照')
      const file = aggregate.files.find(row => row.id === query.fileId && row.ownerId === credential.id && row.ownerType === 'supplier_credential' && row.deletedAt === null)
      if (!file || credential.fileRefId !== file.id)
        throw credentialProblem('relationship-mismatch', '原件与当前证照归属不一致')
      const identity = { ...query, id: file.id, ownerType: file.ownerType, ownerId: file.ownerId, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType }
      if (file.payloadBase64 === null)
        return { ...identity, state: 'missing', reason: 'missing-payload' }
      const bytes = Buffer.from(file.payloadBase64, 'base64')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (bytes.toString('base64') !== file.payloadBase64 || bytes.length !== file.fileSize || (file.sha256 !== null && file.sha256 !== sha256))
        throw credentialProblem('unavailable', '证照原件校验失败，请重试')
      return { ...identity, state: 'available', payloadBase64: file.payloadBase64, sha256 }
    },
    execute(command: SupplierCredentialCommand, session: BusinessSession, sessionId?: string | null): SupplierCredentialCommandResult {
      assertRead(command.origin, session)
      if (command.origin !== 'real' || command.workspaceId !== session.workspaceId || command.actorId !== session.actorId
        || command.requiredCapability !== SUPPLIER_CREDENTIAL_WRITE_CAPABILITY || !session.capabilities.includes(SUPPLIER_CREDENTIAL_WRITE_CAPABILITY)) {
        throw credentialProblem('forbidden', '当前会话不能修改这份证照资料')
      }
      if (!command.commandId.trim())
        throw credentialProblem('validation-failed', '保存标识不能为空')
      const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex')
      return ports.transact(command.supplierId, (scope) => {
        const aggregate = scope.aggregate
        const previous = aggregate.commands.find(row => row.commandId === command.commandId)
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw credentialProblem('conflict', '此保存标识已用于其他内容，请核对原提交')
          return { changed: false, value: structuredClone(previous.result) }
        }
        if (command.baseSupplierVersion !== String(scope.version) || command.baseCredentialVersion !== String(aggregate.version))
          throw credentialProblem('conflict', '分供方或证照资料已变化，请保留输入并核对最新版本')
        const timestamp = now()
        const basis = credentialReviewBasis(aggregate)
        const credentialId = 'credentialId' in command ? command.credentialId : null
        const target = credentialId ? aggregate.credentials.find(row => row.id === credentialId && row.supplierId === command.supplierId) : null
        if (credentialId && (!target || (command.action !== 'restore' && target.deletedAt !== null)))
          throw credentialProblem('not-found', '当前分供方不存在这份有效证照')
        const audit: SupplierCredentialAudit = { id: createId(), credentialId, action: command.action, categoryBefore: target?.category ?? '', categoryAfter: target?.category ?? '', changedFields: [], validFromBefore: target?.validFrom ?? '', validFromAfter: target?.validFrom ?? '', expiresAtBefore: target?.expiresAt ?? '', expiresAtAfter: target?.expiresAt ?? '', longTermBefore: target?.longTerm ?? null, longTermAfter: target?.longTerm ?? null, confidence: null, createdAt: timestamp, actorId: session.actorId, deletionToken: null, canRestore: false }
        if (command.action === 'upload') {
          const validity = normalizeCredentialValidity(command.draft)
          const content = fileBytes(command.draft)
          const id = createId()
          const fileId = createId()
          aggregate.credentials.push({ ...validity, id, supplierId: command.supplierId, fileRefId: fileId, legacyFilePath: '', ocrResult: {}, ocrConfidence: null, ocrConfirmedResult: {}, ocrConfirmedAt: null, ocrReviewStatus: 'not_started', verifiedAt: null, addedAt: timestamp, updatedAt: timestamp, deletedAt: null, deletionToken: null, migrationBatchId: null, legacyId: null })
          aggregate.files.push({ id: fileId, ownerType: 'supplier_credential', ownerId: id, fileName: command.draft.fileName.trim(), fileSize: command.draft.fileSize, mimeType: command.draft.mimeType.toLowerCase(), ...content, createdAt: timestamp, deletedAt: null, migrationBatchId: null, legacyId: null })
          audit.credentialId = id
          audit.categoryAfter = validity.category
          audit.changedFields = ['file', 'category', 'validFrom', 'expiresAt', 'longTerm']
        }
        else if (command.action === 'edit' && target) {
          const validity = normalizeCredentialValidity(command.draft)
          audit.changedFields = (['category', 'validFrom', 'expiresAt', 'longTerm'] as const).filter(field => target[field] !== validity[field])
          Object.assign(target, validity, { updatedAt: timestamp })
          audit.categoryAfter = target.category
          audit.validFromAfter = target.validFrom
          audit.expiresAtAfter = target.expiresAt
          audit.longTermAfter = target.longTerm
        }
        else if (command.action === 'requirement') {
          const draft = command.draft
          if (!SUPPLIER_CREDENTIAL_CATEGORIES.includes(draft.category) || !['required', 'optional', 'not_applicable'].includes(draft.requirement))
            throw credentialProblem('validation-failed', '资料要求无效')
          const fixed = REQUIRED_SUPPLIER_CREDENTIALS.includes(draft.category)
          if (fixed && draft.requirement !== 'required')
            throw credentialProblem('validation-failed', '营业执照、法人身份证和银行账户资料是固定必需资料，不能降级')
          if (!fixed && draft.requirement === 'required' && !draft.reason.trim())
            throw credentialProblem('validation-failed', '请说明当前项目或合同要求提供这项条件资料的原因')
          const existing = aggregate.requirements.find(row => row.category === draft.category && row.deletedAt === null)
          const record = { id: existing?.id ?? createId(), supplierId: command.supplierId, category: draft.category, requirement: draft.requirement, reason: draft.reason.trim(), updatedAt: timestamp, deletedAt: null, migrationBatchId: existing?.migrationBatchId ?? null, legacyId: existing?.legacyId ?? null }
          if (existing)
            Object.assign(existing, record)
          else
            aggregate.requirements.push(record)
          audit.categoryAfter = draft.category
          audit.changedFields = ['requirement', 'reason']
        }
        else if (command.action === 'review') {
          if (currentCredentialStatus(aggregate, new Date(timestamp)) !== 'reviewing')
            throw credentialProblem('validation-failed', '只有资料齐全待核验时才能人工通过或退回')
          if (!['qualified', 'rejected'].includes(command.draft.decision) || (command.draft.decision === 'rejected' && !command.draft.note.trim()))
            throw credentialProblem('validation-failed', '退回核验时必须填写原因')
          aggregate.review = { decision: command.draft.decision, reviewedAt: timestamp, actorId: session.actorId, note: command.draft.note.trim() }
          aggregate.supplierAudits.push({ id: audit.id, action: 'credential_review', outcome: command.draft.decision, sourceCategory: 'manual_document', changedFields: ['credentialStatus'], notePresent: Boolean(command.draft.note.trim()), createdAt: timestamp, actorId: session.actorId })
        }
        else if (command.action === 'delete' && target) {
          const token = createId()
          target.deletedAt = timestamp
          target.deletionToken = token
          target.updatedAt = timestamp
          const file = aggregate.files.find(row => row.id === target.fileRefId && row.ownerId === target.id && row.deletedAt === null)
          if (file)
            file.deletedAt = timestamp
          audit.deletionToken = token
          audit.canRestore = true
          audit.changedFields = ['deletedAt']
        }
        else if (command.action === 'restore' && target) {
          const deletion = aggregate.audits.find(row => row.id === command.auditId && ['delete', 'credential_delete'].includes(row.action) && row.credentialId === target.id)
          if (!target.deletedAt || !deletion || !target.deletionToken || target.deletionToken !== command.deletionToken || deletion.deletionToken !== target.deletionToken)
            throw credentialProblem('conflict', '这次删除已经失效，不能用旧撤回恢复当前资料')
          const file = aggregate.files.find(row => row.id === target.fileRefId && row.ownerId === target.id)
          if (file && file.deletedAt !== target.deletedAt)
            throw credentialProblem('conflict', '证照与原件删除边界不一致，请先核对')
          target.deletedAt = null
          target.deletionToken = null
          target.updatedAt = timestamp
          if (file)
            file.deletedAt = null
          audit.changedFields = ['deletedAt']
        }
        if (command.action !== 'review' && basis !== credentialReviewBasis(aggregate))
          aggregate.review = null
        if (automaticCredentialStatus(aggregate, new Date(timestamp)) === 'incomplete')
          aggregate.review = null
        if (command.action !== 'review')
          aggregate.audits.push(audit)
        aggregate.version++
        if (aggregate.migrationBatchId)
          aggregate.changedAfterMigration = true
        const result = { commandId: command.commandId, supplierId: command.supplierId, credentialId: audit.credentialId, auditId: audit.id, deletionToken: audit.deletionToken, supplierVersion: String(scope.version + 1), credentialVersion: String(aggregate.version) }
        aggregate.commands.push({ commandId: command.commandId, fingerprint, result })
        return { changed: true, value: structuredClone(result) }
      }, sessionId)
    },
  }
}
