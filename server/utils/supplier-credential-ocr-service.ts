import type { OcrRecognitionResult, OcrRuntimeRequestOptions } from '../../app/lib/recognize/engine'
import type { SupplierCredentialAudit, SupplierCredentialCommand, SupplierCredentialCommandResult, SupplierCredentialFileContent, SupplierCredentialFileQuery } from '../../app/lib/supplier/credential-contract'
import type { CredentialOcrFieldKey } from '../../app/lib/supplier/credential-ocr'
import type { BusinessSession } from './business-session'
import type { SupplierCredentialPorts, SupplierCredentialScope } from './supplier-credential-service'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { credentialProblem, SupplierCredentialNotAppliedProblem } from '../../app/lib/supplier/credential-contract'
import { CREDENTIAL_MASTER_FIELDS, credentialReviewBasis, invalidateCredentialReview, normalizeCredentialValidity } from '../../app/lib/supplier/credential-domain'
import { parseCredentialOcr, resolveCredentialOcrChoices } from '../../app/lib/supplier/credential-ocr'
import { preserveTaxpayerVerification } from '../../app/lib/supplier/taxpayer-verification'
import { supplierCredentialRecognition } from './supplier-credential-recognition'
import { createSupplierCredentialService } from './supplier-credential-service'

type RecognitionCommand = Extract<SupplierCredentialCommand, { action: 'ocr-recognize' }>
type ConfirmationCommand = Extract<SupplierCredentialCommand, { action: 'ocr-confirm' }>
interface Options {
  recognize: (input: { fileName: string, contentType: string, data: Uint8Array, options: OcrRuntimeRequestOptions }) => Promise<OcrRecognitionResult>
  now?: () => string
  createId?: () => string
}

export interface PersistentSupplierCredentialOcrPorts {
  read: (supplierId: string, sessionId?: string | null) => Promise<SupplierCredentialScope>
  file: (query: SupplierCredentialFileQuery, session: BusinessSession, sessionId?: string | null) => Promise<SupplierCredentialFileContent>
  transact: <T>(supplierId: string, operation: (scope: SupplierCredentialScope) => { changed: boolean, value: T, commandId?: string }, sessionId?: string | null) => Promise<T>
}
interface OcrPorts {
  read: (supplierId: string, sessionId?: string | null) => SupplierCredentialScope | Promise<SupplierCredentialScope>
  file: (query: SupplierCredentialFileQuery, session: BusinessSession, sessionId?: string | null) => SupplierCredentialFileContent | Promise<SupplierCredentialFileContent>
  transact: <T>(supplierId: string, operation: (scope: SupplierCredentialScope) => { changed: boolean, value: T, commandId?: string }, sessionId?: string | null) => T | Promise<T>
}

function authorize(command: SupplierCredentialCommand, session: BusinessSession, confirmation = false) {
  const required = ['supplier:list:read', 'supplier-credential:read', 'supplier-credential:write', ...(confirmation ? ['supplier:write'] : [])]
  if (command.origin !== 'real' || command.workspaceId !== session.workspaceId || command.actorId !== session.actorId
    || command.requiredCapability !== 'supplier-credential:write' || required.some(capability => !session.capabilities.includes(capability))) {
    throw credentialProblem('forbidden', '当前会话不能识别或确认这份分供方证照')
  }
  if (!command.commandId.trim())
    throw credentialProblem('validation-failed', '保存标识不能为空')
}

function receipt(scope: SupplierCredentialScope, command: SupplierCredentialCommand, fingerprint: string) {
  const previous = scope.aggregate.commands.find(row => row.commandId === command.commandId)
  if (previous && previous.fingerprint !== fingerprint)
    throw credentialProblem('conflict', '此保存标识已用于其他内容，请核对原提交')
  return previous ? structuredClone(previous.result) : null
}
function current(scope: SupplierCredentialScope, command: RecognitionCommand | ConfirmationCommand) {
  if (String(scope.version) !== command.baseSupplierVersion || String(scope.aggregate.version) !== command.baseCredentialVersion)
    throw new SupplierCredentialNotAppliedProblem(command.commandId, '分供方或证照资料已变化，请保留选择并重新核对', 'conflict')
  const target = scope.aggregate.credentials.find(row => row.id === command.credentialId && row.supplierId === command.supplierId && row.deletedAt === null)
  if (!target)
    throw new SupplierCredentialNotAppliedProblem(command.commandId, '当前证照已删除或不属于此分供方', 'not-found')
  const file = scope.aggregate.files.find(row => row.id === target.fileRefId && row.ownerId === target.id && row.ownerType === 'supplier_credential' && row.deletedAt === null)
  if (!file || file.payloadBase64 === null)
    throw new SupplierCredentialNotAppliedProblem(command.commandId, '此证照未保存可读取的原件，请先上传原件', 'not-found')
  return { target, file }
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function createSupplierCredentialOcrService(ports: SupplierCredentialPorts, options: Options) {
  const credentials = createSupplierCredentialService(ports, options)
  const service = createSupplierCredentialOcrCore({ ...ports, file: credentials.file }, options)
  return {
    recognize: service.recognize,
    confirm(command: ConfirmationCommand, session: BusinessSession, sessionId?: string | null): SupplierCredentialCommandResult {
      return service.confirm(command, session, sessionId) as SupplierCredentialCommandResult
    },
  }
}

export function createPersistentSupplierCredentialOcrService(ports: PersistentSupplierCredentialOcrPorts, options: Options) {
  const service = createSupplierCredentialOcrCore(ports, options)
  return {
    recognize: service.recognize,
    async confirm(command: ConfirmationCommand, session: BusinessSession, sessionId?: string | null) {
      return service.confirm(command, session, sessionId)
    },
  }
}

function createSupplierCredentialOcrCore(ports: OcrPorts, options: Options) {
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? randomUUID
  const pending = new Map<string, { fingerprint: string, promise: Promise<SupplierCredentialCommandResult> }>()
  function publish(scope: SupplierCredentialScope, command: RecognitionCommand | ConfirmationCommand, fingerprint: string, audit: SupplierCredentialAudit) {
    scope.aggregate.audits.push(audit)
    scope.aggregate.version++
    if (scope.aggregate.migrationBatchId)
      scope.aggregate.changedAfterMigration = true
    const value: SupplierCredentialCommandResult = { commandId: command.commandId, supplierId: command.supplierId, credentialId: command.credentialId, auditId: audit.id, deletionToken: null, supplierVersion: String(scope.version + 1), credentialVersion: String(scope.aggregate.version) }
    scope.aggregate.commands.push({ commandId: command.commandId, fingerprint, result: value })
    return { changed: true, value: structuredClone(value), commandId: command.commandId }
  }
  function auditFor(command: RecognitionCommand | ConfirmationCommand, scope: SupplierCredentialScope, timestamp: string): SupplierCredentialAudit {
    const target = scope.aggregate.credentials.find(row => row.id === command.credentialId)!
    return { id: createId(), credentialId: target.id, action: command.action, categoryBefore: target.category, categoryAfter: target.category, changedFields: [], validFromBefore: target.validFrom, validFromAfter: target.validFrom, expiresAtBefore: target.expiresAt, expiresAtAfter: target.expiresAt, longTermBefore: target.longTerm, longTermAfter: target.longTerm, confidence: null, createdAt: timestamp, actorId: command.actorId, deletionToken: null, canRestore: false }
  }
  return {
    async recognize(command: RecognitionCommand, session: () => BusinessSession, sessionId?: string | null): Promise<SupplierCredentialCommandResult> {
      authorize(command, session())
      const fingerprint = digest(command)
      const capture = ports.read(command.supplierId, sessionId)
      const captured = capture instanceof Promise ? await capture : capture
      const previous = receipt(captured, command, fingerprint)
      if (previous)
        return previous
      const { target, file } = current(captured, command)
      const original = ports.file({ supplierId: command.supplierId, credentialId: target.id, fileId: file.id, origin: 'real' }, session(), sessionId)
      const content = original instanceof Promise ? await original : original
      if (content.state !== 'available')
        throw credentialProblem('not-found', '此证照缺少原件正文')
      const key = JSON.stringify([sessionId ?? '', command.workspaceId, command.actorId, command.supplierId, command.commandId])
      const existing = pending.get(key)
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw credentialProblem('conflict', '此保存标识正在处理其他内容')
        return existing.promise
      }
      const operation = (async () => {
        // 外部识别不持有事务；原件来自已鉴权的中央文件读取。
        let result: OcrRecognitionResult
        let parsed: ReturnType<typeof parseCredentialOcr>
        try {
          result = await options.recognize({ fileName: content.fileName, contentType: content.mimeType, data: Buffer.from(content.payloadBase64, 'base64'), options: command.options })
          parsed = parseCredentialOcr(result, content.fileName)
        }
        catch (cause) {
          throw new SupplierCredentialNotAppliedProblem(command.commandId, cause instanceof Error ? cause.message : '识别失败，原件已保留')
        }
        authorize(command, session())
        return ports.transact(command.supplierId, (scope) => {
          const previous = receipt(scope, command, fingerprint)
          if (previous)
            return { changed: false, value: previous }
          const fresh = current(scope, command)
          if (fresh.file.id !== content.id || fresh.file.payloadBase64 !== content.payloadBase64)
            throw new SupplierCredentialNotAppliedProblem(command.commandId, '证照原件已变化，请重新识别当前原件', 'conflict')
          const timestamp = now()
          const audit = auditFor(command, scope, timestamp)
          fresh.target.recognition = { id: createId(), fileId: content.id, sha256: content.sha256, recognizedAt: timestamp, result: structuredClone(result) as unknown as Record<string, unknown>, parsed }
          fresh.target.ocrResult = structuredClone(result) as unknown as Record<string, unknown>
          fresh.target.ocrConfidence = parsed.category.confidence
          fresh.target.ocrReviewStatus = 'pending'
          fresh.target.updatedAt = timestamp
          audit.confidence = parsed.category.confidence
          audit.changedFields = ['ocrResult', 'ocrConfidence', 'ocrReviewStatus']
          return publish(scope, command, fingerprint, audit)
        }, sessionId)
      })()
      pending.set(key, { fingerprint, promise: operation })
      try {
        return await operation
      }
      finally {
        if (pending.get(key)?.promise === operation)
          pending.delete(key)
      }
    },
    confirm(command: ConfirmationCommand, session: BusinessSession, sessionId?: string | null): SupplierCredentialCommandResult | Promise<SupplierCredentialCommandResult> {
      authorize(command, session, true)
      const fingerprint = digest(command)
      return ports.transact(command.supplierId, (scope) => {
        const previous = receipt(scope, command, fingerprint)
        if (previous)
          return { changed: false, value: previous }
        const { target, file } = current(scope, command)
        const recognition = supplierCredentialRecognition(target, file)
        if (!recognition || recognition.id !== command.draft.recognitionId || recognition.fileId !== file.id
          || recognition.sha256 !== createHash('sha256').update(Buffer.from(file.payloadBase64!, 'base64')).digest('hex')) {
          throw new SupplierCredentialNotAppliedProblem(command.commandId, '原始识别候选或原件已变化，请保留选择并重新核对', 'conflict')
        }
        const decisions = command.draft.decisions
        if (!decisions || ![decisions.category, decisions.longTerm].every(value => ['keep-current', 'use-recognized', 'manual'].includes(value))
          || (decisions.category === 'keep-current' && command.draft.category !== target.category)
          || (decisions.category === 'use-recognized' && command.draft.category !== recognition.parsed.category.category)
          || (decisions.longTerm === 'keep-current' && command.draft.longTerm !== target.longTerm)
          || (decisions.longTerm === 'use-recognized' && command.draft.longTerm !== recognition.parsed.longTerm)) {
          throw new SupplierCredentialNotAppliedProblem(command.commandId, '类别或长期有效状态与人工决定不一致，请重新核对', 'validation-failed')
        }
        const timestamp = now()
        const basis = credentialReviewBasis(scope.aggregate)
        const audit = auditFor(command, scope, timestamp)
        const before = structuredClone(scope.draft)
        let fields: Partial<Record<CredentialOcrFieldKey, string>>
        try {
          fields = resolveCredentialOcrChoices(recognition.parsed.fields, { ...scope.draft, validFrom: target.validFrom, expiresAt: target.expiresAt }, command.draft.choices)
        }
        catch (cause) { throw new SupplierCredentialNotAppliedProblem(command.commandId, (cause as Error).message, 'validation-failed') }
        let validity: ReturnType<typeof normalizeCredentialValidity>
        try {
          validity = normalizeCredentialValidity({ category: command.draft.category, validFrom: fields.validFrom ?? target.validFrom, expiresAt: fields.expiresAt ?? target.expiresAt, longTerm: command.draft.longTerm })
        }
        catch (cause) { throw new SupplierCredentialNotAppliedProblem(command.commandId, (cause as Error).message, 'validation-failed') }
        for (const key of CREDENTIAL_MASTER_FIELDS) {
          if (fields[key] !== undefined)
            scope.draft[key] = fields[key]
        }
        scope.draft = preserveTaxpayerVerification(before, scope.draft)
        const changedMaster = CREDENTIAL_MASTER_FIELDS.filter(key => before[key as keyof typeof before] !== scope.draft[key as keyof typeof before])
        Object.assign(target, validity, { recognition, ocrConfirmedResult: { recognitionId: recognition.id, category: validity.category, longTerm: validity.longTerm, fields, choices: structuredClone(command.draft.choices), decisions: structuredClone(decisions) }, ocrConfirmedAt: timestamp, ocrReviewStatus: 'confirmed', updatedAt: timestamp })
        audit.categoryAfter = target.category
        audit.validFromAfter = target.validFrom
        audit.expiresAtAfter = target.expiresAt
        audit.longTermAfter = target.longTerm
        audit.changedFields = [...changedMaster, ...(['category', 'validFrom', 'expiresAt', 'longTerm'] as const).filter(key => audit[`${key}Before` as keyof SupplierCredentialAudit] !== target[key]), 'ocrConfirmedResult', 'ocrConfirmedAt', 'ocrReviewStatus']
        audit.confidence = target.ocrConfidence
        if (basis !== credentialReviewBasis(scope.aggregate) || changedMaster.length)
          invalidateCredentialReview(scope.aggregate)
        scope.aggregate.supplierAudits.push({ id: audit.id, action: 'credential_ocr_confirm', outcome: 'confirmed', sourceCategory: 'manual_ocr', changedFields: changedMaster, notePresent: false, createdAt: timestamp, actorId: session.actorId })
        return publish(scope, command, fingerprint, audit)
      }, sessionId)
    },
  }
}
