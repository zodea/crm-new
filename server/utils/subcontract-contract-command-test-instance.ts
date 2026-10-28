import type { ContractFormAttachment, ProjectContractFormDraft } from '../../app/lib/contract/forms'
import type { ContractOriginalContent } from '../../app/lib/forms/original-content'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { OurSignatorySnapshot } from '../../app/lib/our-signatory/contract'
import type {
  SubcontractContractCommandRequestDTO,
  SubcontractContractCommandResultDTO,
  SubcontractContractFormReadDTO,
} from '../../app/lib/subcontract-contract/command-contract'
import type {
  SubcontractContractDetailSource,
  SubcontractContractFactSources,
} from '../../app/lib/subcontract-contract/repository'
import type { BusinessSession } from './business-session'
import type { CommandJournal } from './command-journal'
import { Buffer } from 'node:buffer'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { SUBCONTRACT_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/subcontract-contract/command-contract'
import {
  subcontractContractProblem,
  SubcontractContractRepositoryProblem,
} from '../../app/lib/subcontract-contract/repository'
import { assertCommandUnsealed, commandReplay, parseResolveCommandBody, resolveJournalCommand } from './command-journal'
import { contractMigratedAttachments, contractOriginalBytes, contractOriginalDigest } from './contract-original'
import { contractMigratedSignatory } from './contract-signatory-migration'
import { assertRetainedMigrationReferences } from './core-identity-migration'
import { developmentOurSignatoryOwner } from './our-signatory-runtime'
import { projectCommandTestInstance } from './project-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

interface Option { id: string, name: string, contact?: string, contactPhone?: string }

export interface StoredSubcontractContract {
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  originals: Map<string, { bytes: Uint8Array, sha256: string }>
  version: number
  createdAt: string
  updatedAt: string
  migrationBatchId: string | null
  settlementStatus: string | null
  clearanceStatus: string | null
}
type StoredContract = StoredSubcontractContract
export interface SubcontractContractOwnerSnapshot {
  schemaVersion: 1
  sourceVersion: number
  contracts: StoredSubcontractContract[]
  supplements: SubcontractContractFactSources['supplements']
}

interface Options {
  resolveSignatory?: (draft: ProjectContractFormDraft, existing: StoredContract | null, required: boolean, session: BusinessSession, sessionId?: string | null) => Promise<OurSignatorySnapshot | null>
  createId?: () => string
  createAttachmentId?: () => string
  now?: () => string
  projects?: readonly Option[]
  suppliers?: readonly Option[]
  resolveProjects?: (sessionId?: string | null) => readonly Option[]
  resolveSuppliers?: (sessionId?: string | null) => readonly Option[]
}

function failure(code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict' | 'relationship-mismatch' | 'unavailable', message: string, fieldErrors: Record<string, string[]> = {}) {
  return new SubcontractContractRepositoryProblem({
    ...subcontractContractProblem(code, message),
    fieldErrors,
    traceId: `subcontract-contract-command-${code}`,
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function createSubcontractContractCommandTestInstance(options: Options = {}) {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const createAttachmentId = options.createAttachmentId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const references = (sessionId?: string | null) => ({
    projects: new Map([...(options.resolveProjects?.(sessionId) ?? options.projects ?? [])].map(row => [row.id, row])),
    suppliers: new Map([...(options.resolveSuppliers?.(sessionId) ?? options.suppliers ?? [])].map(row => [row.id, row])),
  })
  let contracts = new Map<string, StoredContract>()
  const replay = new Map<string, SubcontractContractCommandResultDTO>()
  const journal: CommandJournal<SubcontractContractCommandResultDTO> = { commands: replay, commandFingerprints: new Map(), sealedCommands: new Set() }
  let migratedProjects = new Map<string, Option>()
  let migratedSuppliers = new Map<string, Option>()
  let migratedSupplements: SubcontractContractFactSources['supplements'] = []
  let sourceVersion = 0

  function authorize(session: BusinessSession) {
    if (!session.capabilities.includes(SUBCONTRACT_CONTRACT_WRITE_CAPABILITY))
      throw failure('forbidden', '无分包合同写入权限')
  }

  function validate(draft: ProjectContractFormDraft, action: SubcontractContractCommandRequestDTO['action'], sessionId?: string | null) {
    const { projects, suppliers } = references(sessionId)
    if (draft.lineItems?.length)
      throw failure('validation-failed', '分包合同不接受采购明细')
    if (draft.customerId)
      throw failure('validation-failed', '分包合同不接受甲方客户关系')
    if (draft.subKind && !['劳务', '专业'].includes(draft.subKind))
      throw failure('validation-failed', '分包合同分类必须是劳务或专业', { subKind: ['分包合同分类必须是劳务或专业'] })
    if (draft.projectId && !projects.has(draft.projectId) && !migratedProjects.has(draft.projectId))
      throw failure('validation-failed', '项目不存在或不可用', { projectId: ['项目不存在或不可用'] })
    if (draft.supplierId && !suppliers.has(draft.supplierId) && !migratedSuppliers.has(draft.supplierId))
      throw failure('validation-failed', '分供方不存在或不可用', { supplierId: ['分供方不存在或不可用'] })
    if (action === 'draft')
      return
    const required: Array<[keyof ProjectContractFormDraft, string]> = [
      ['name', '合同名称'],
      ['projectId', '项目'],
      ['supplierId', '分供方'],
      ['subKind', '分包分类'],
      ['content', '合同内容简述'],
      ['signDate', '签约日期'],
    ]
    const fieldErrors: Record<string, string[]> = {}
    for (const [field, label] of required) {
      const value = draft[field]
      if (value == null || (typeof value === 'string' && !value.trim()))
        fieldErrors[String(field)] = [`${label}为必填项`]
    }
    if (draft.amount == null || !Number.isFinite(draft.amount) || draft.amount < 0)
      fieldErrors.amount = ['合同金额必须是非负有限数值']
    if (Object.keys(fieldErrors).length)
      throw failure('validation-failed', '请检查分包合同必填字段', fieldErrors)
  }

  function cleanDraft(source: ProjectContractFormDraft, id: string): ProjectContractFormDraft & { id: string } {
    return {
      ...source,
      id,
      isSupplement: false,
      originalContractId: null,
      customerId: null,
      projectId: text(source.projectId) || null,
      supplierId: text(source.supplierId) || null,
      subKind: text(source.subKind),
      lineItems: undefined,
    }
  }

  function toRow(stored: StoredContract, refs = references()): SubcontractContractDetailSource {
    const { projects, suppliers } = refs
    const draft = stored.draft
    return {
      ourSignatorySnapshot: draft.ourSignatorySnapshot ? structuredClone(draft.ourSignatorySnapshot) : null,
      legacyPartyA: draft.legacyPartyA ?? null,
      dataOrigin: 'real',
      id: draft.id,
      no: text(draft.no),
      name: text(draft.name),
      kind: '分包',
      subKind: text(draft.subKind),
      projectId: draft.projectId ?? null,
      projectName: projects.get(draft.projectId ?? '')?.name ?? migratedProjects.get(draft.projectId ?? '')?.name ?? '',
      projectPermission: 'allowed',
      supplierId: draft.supplierId ?? null,
      supplierName: suppliers.get(draft.supplierId ?? '')?.name ?? migratedSuppliers.get(draft.supplierId ?? '')?.name ?? '',
      supplierPermission: 'allowed',
      amount: draft.amount === null || draft.amount === undefined ? null : Number(draft.amount),
      settlementStatus: stored.settlementStatus,
      clearanceStatus: stored.clearanceStatus,
      content: text(draft.content),
      invoiceType: text(draft.invoiceType),
      contactName: text(draft.contactName),
      contactPhone: text(draft.contactPhone),
      taxRate: draft.taxRate ?? null,
      signDate: text(draft.signDate) || null,
      mainTerms: text(draft.mainTerms),
      paymentTerms: text(draft.paymentTerms),
      warrantyTerms: text(draft.warrantyTerms),
      retentionRatio: draft.retentionRatio ?? null,
      retentionAmount: draft.retentionAmount ?? null,
      retentionDays: draft.retentionDays ?? null,
      status: text(draft.status) || '草稿',
      note: text(draft.note),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    }
  }

  let applyMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO) => void

  function prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO): () => void {
    const current = {
      contracts,
      migratedProjects,
      migratedSuppliers,
      migratedSupplements,
      sourceVersion,
    }
    contracts = structuredClone(contracts)
    migratedProjects = structuredClone(migratedProjects)
    migratedSuppliers = structuredClone(migratedSuppliers)
    migratedSupplements = structuredClone(migratedSupplements)
    try {
      applyMigrationSnapshot(snapshot)
      const candidate = {
        contracts,
        migratedProjects,
        migratedSuppliers,
        migratedSupplements,
        sourceVersion,
      }
      return () => {
        contracts = candidate.contracts
        migratedProjects = candidate.migratedProjects
        migratedSuppliers = candidate.migratedSuppliers
        migratedSupplements = candidate.migratedSupplements
        sourceVersion = candidate.sourceVersion
      }
    }
    finally {
      contracts = current.contracts
      migratedProjects = current.migratedProjects
      migratedSuppliers = current.migratedSuppliers
      migratedSupplements = current.migratedSupplements
      sourceVersion = current.sourceVersion
    }
  }

  const instance = {
    /** Reuse the domain inside one formal transaction, without importing a second master directory. */
    importState(snapshot: SubcontractContractOwnerSnapshot) {
      if (snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.sourceVersion) || snapshot.sourceVersion < 0 || new Set(snapshot.contracts.map(row => row.draft.id)).size !== snapshot.contracts.length)
        throw failure('unavailable', '分包owner原身份或版本无效')
      for (const row of snapshot.contracts) {
        if (!row.draft.id || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt)) || !(row.originals instanceof Map))
          throw failure('unavailable', '分包原资料、时间、版本或原件目录缺失')
        for (const file of row.attachments) {
          if (!file.id || file.ownerType !== 'contract' || file.ownerId !== row.draft.id)
            throw failure('unavailable', '分包原件串了正式归属')
          const original = row.originals.get(file.id)
          if (original && (original.bytes.length !== file.fileSize || contractOriginalDigest(original.bytes) !== original.sha256 || file.sha256 !== original.sha256))
            throw failure('unavailable', '分包原件字节与摘要不一致')
        }
      }
      contracts = new Map(structuredClone(snapshot.contracts).map(row => [row.draft.id, row]))
      migratedSupplements = structuredClone(snapshot.supplements)
      sourceVersion = snapshot.sourceVersion
    },
    exportState(): SubcontractContractOwnerSnapshot {
      return { schemaVersion: 1, sourceVersion, contracts: structuredClone([...contracts.values()]), supplements: structuredClone(migratedSupplements) }
    },
    reset() {
      contracts.clear()
      replay.clear()
      journal.commandFingerprints.clear()
      journal.sealedCommands.clear()
      migratedProjects = new Map()
      migratedSuppliers = new Map()
      migratedSupplements = []
      sourceVersion += 1
    },
    context(session: BusinessSession, sessionId?: string | null) {
      authorize(session)
      const { projects, suppliers } = references(sessionId)
      return {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        capabilities: [...session.capabilities],
        projects: [...new Map([...migratedProjects, ...projects]).values()].map(row => ({ id: row.id, label: row.name })),
        suppliers: [...new Map([...migratedSuppliers, ...suppliers]).values()].map(row => ({ id: row.id, label: row.name, contactName: row.contact ?? '', contactPhone: row.contactPhone ?? '' })),
      }
    },
    rows(sessionId?: string | null) {
      const refs = references(sessionId)
      return [...contracts.values()].map(record => toRow(record, refs))
    },
    /** 预算对比保留原金额与真实关联资格，调用方须先取得分包读取授权。 */
    budgetRows(sessionId?: string | null) {
      const refs = references(sessionId)
      return [...contracts.values()].map(record => ({
        ...toRow(record, refs),
        amount: record.draft.amount ?? null,
        projectResolved: Boolean(record.draft.projectId && (refs.projects.has(record.draft.projectId) || migratedProjects.has(record.draft.projectId))),
        supplierResolved: Boolean(record.draft.supplierId && (refs.suppliers.has(record.draft.supplierId) || migratedSuppliers.has(record.draft.supplierId))),
      }))
    },
    facts(): SubcontractContractFactSources {
      return {
        supplements: structuredClone(migratedSupplements),
        changes: [],
        invoices: [],
        paymentApplications: [],
        paymentRecords: [],
        settlements: [],
        penalties: [],
        files: [...contracts.values()].flatMap(stored => stored.attachments
          .filter(file => file.deletedAt === null)
          .map(file => ({
            dataOrigin: 'real' as const,
            id: file.id,
            contractId: stored.draft.id,
            fileName: file.fileName,
            fileSize: file.fileSize,
            mimeType: file.mimeType,
            category: file.category,
            uploadedAt: file.uploadedAt,
          }))),
      }
    },
    sourceVersion() {
      return `subcontract-contract-command-${sourceVersion}`
    },
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[]) {
      assertRetainedMigrationReferences(removed, 'subcontract_contracts', [...contracts.values()].map(row => ({
        id: row.draft.id!,
        references: [{ type: 'projects', id: row.draft.projectId }, { type: 'suppliers', id: row.draft.supplierId }],
      })), message => failure('conflict', message))
    },
    prepareMigrationSnapshot,
    synchronizeMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO) {
      prepareMigrationSnapshot(snapshot)()
    },
    applyMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO) {
      const activeBatchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
      const entities = activeBatchId ? snapshot.entities : []
      const migratedIds = new Set(entities.filter(entity => entity.entityType === 'subcontract_contracts' && entity.deletedAt === null).map(entity => entity.id))
      for (const [id, stored] of contracts) {
        if (stored.migrationBatchId && (!migratedIds.has(id) || stored.migrationBatchId !== activeBatchId)) {
          if (stored.version !== 1)
            throw failure('conflict', '迁入分包合同已有后来修改、删除或附件变更，不能回滚移除')
          contracts.delete(id)
          sourceVersion += 1
        }
      }
      migratedProjects = new Map(entities.filter(entity => entity.entityType === 'projects' && entity.deletedAt === null).map(entity => [entity.id, { id: entity.id, name: entity.name }]))
      migratedSuppliers = new Map(entities.filter(entity => entity.entityType === 'suppliers' && entity.deletedAt === null).map(entity => [entity.id, { id: entity.id, name: entity.name }]))
      const attribute = (entity: CoreMigrationServerEntityDTO, key: string) => entity.attributes[key] == null ? '' : String(entity.attributes[key])
      const numeric = (entity: CoreMigrationServerEntityDTO, key: string) => typeof entity.attributes[key] === 'number' ? entity.attributes[key] as number : null
      const subcontractContractIds = new Set(entities
        .filter(entity => entity.entityType === 'subcontract_contracts' && entity.deletedAt === null)
        .map(entity => entity.id))
      migratedSupplements = entities
        .filter(entity => entity.entityType === 'contract_supplements'
          && entity.deletedAt === null
          && subcontractContractIds.has(entity.references.contractId ?? ''))
        .map(entity => ({
          dataOrigin: 'real' as const,
          id: entity.id,
          contractId: entity.references.contractId ?? null,
          no: attribute(entity, 'no'),
          name: entity.name,
          amount: entity.amount == null ? null : Number(entity.amount),
          date: attribute(entity, 'signDate') || null,
          status: attribute(entity, 'status'),
        }))
      for (const entity of entities) {
        if (entity.entityType !== 'subcontract_contracts' || entity.deletedAt !== null || contracts.has(entity.id))
          continue
        const createdAt = attribute(entity, 'createdAt') || '1970-01-01T00:00:00.000Z'
        const draft: ProjectContractFormDraft = {
          ...contractMigratedSignatory(entity, (message) => { throw failure('unavailable', message) }),
          id: entity.id,
          no: attribute(entity, 'no'),
          name: entity.name,
          subKind: attribute(entity, 'subKind'),
          projectId: entity.references.projectId ?? null,
          supplierId: entity.references.supplierId ?? null,
          content: attribute(entity, 'content'),
          invoiceType: attribute(entity, 'invoiceType'),
          contactName: attribute(entity, 'contactName'),
          contactPhone: attribute(entity, 'contactPhone'),
          taxRate: numeric(entity, 'taxRate'),
          signDate: attribute(entity, 'signDate'),
          mainTerms: attribute(entity, 'mainTerms'),
          paymentTerms: attribute(entity, 'paymentTerms'),
          warrantyTerms: attribute(entity, 'warrantyTerms'),
          retentionRatio: numeric(entity, 'retentionRatio'),
          retentionAmount: numeric(entity, 'retentionAmount'),
          retentionDays: numeric(entity, 'retentionDays'),
          amount: entity.amount === null ? null : Number(entity.amount),
          status: attribute(entity, 'status') || '履约中',
          note: attribute(entity, 'note'),
        }
        validate(draft, 'save')
        const originals = new Map<string, { bytes: Uint8Array, sha256: string }>()
        const attachments = contractMigratedAttachments(entity.attributes.attachmentsJson ?? '[]', {
          ownerId: entity.id,
          legacyOwnerId: entity.legacyId,
          originals,
          allocatedIds: new Set([...contracts.values()].flatMap(row => row.attachments.map(file => file.id))),
          fail: (message) => {
            throw failure('validation-failed', message)
          },
        })
        contracts.set(entity.id, {
          draft: cleanDraft(draft, entity.id),
          attachments,
          originals,
          version: 1,
          createdAt,
          updatedAt: attribute(entity, 'updatedAt') || createdAt,
          migrationBatchId: activeBatchId,
          settlementStatus: attribute(entity, 'settlementStatus') || null,
          clearanceStatus: attribute(entity, 'clearanceStatus') || null,
        })
        sourceVersion += 1
      }
    },
    form(id: string, session: BusinessSession): SubcontractContractFormReadDTO {
      authorize(session)
      const stored = contracts.get(id)
      if (!stored)
        throw failure('not-found', '未找到分包合同')
      return {
        draft: { ...stored.draft },
        attachments: structuredClone(stored.attachments),
        version: String(stored.version),
        updatedAt: stored.updatedAt,
      }
    },
    readFileContent(id: string, fileId: string, session: BusinessSession): ContractOriginalContent {
      if (!session.capabilities.includes('subcontract-contract:read'))
        throw failure('forbidden', '无分包合同原件读取权限')
      const stored = contracts.get(id)
      const file = stored?.attachments.find(row => row.id === fileId && row.ownerId === id && row.ownerType === 'contract' && row.deletedAt === null)
      if (!stored || !file)
        throw failure('not-found', '分包合同附件不存在、已删除或不属于当前合同')
      const original = stored.originals.get(fileId)
      if (!original)
        throw failure('not-found', '旧分包合同附件正文未迁入，请核对原始文件；路径不代表可读取的原件')
      if (original.bytes.byteLength !== file.fileSize || contractOriginalDigest(original.bytes) !== original.sha256 || (file.sha256 !== undefined && file.sha256 !== original.sha256))
        throw failure('unavailable', '分包合同原件正文、长度或摘要不一致，停止读取')
      return { ownerId: id, fileId, dataOrigin: 'real', fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize, sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') }
    },
    async execute(request: SubcontractContractCommandRequestDTO, session: BusinessSession, sessionId?: string | null): Promise<SubcontractContractCommandResultDTO> {
      request = structuredClone(request)
      authorize(session)
      if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId
        || request.requiredCapability !== SUBCONTRACT_CONTRACT_WRITE_CAPABILITY) {
        throw failure('forbidden', '分包合同命令会话不一致')
      }
      const { key: commandKey, previous: replayed } = commandReplay(journal, request, session, 'subcontract-contract', message => failure('conflict', message))
      if (replayed)
        return replayed
      const existing = request.id ? contracts.get(request.id) ?? null : null
      if (request.id && !existing)
        throw failure('not-found', '未找到分包合同')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '分包合同已有更新版本')
      if (!existing && request.baseVersion !== null)
        throw failure('conflict', '新建分包合同不能携带旧版本')
      validate(request.draft, request.action, sessionId)
      let candidate = request.draft
      if (options.resolveSignatory) {
        const snapshot = await options.resolveSignatory(candidate, existing, request.action !== 'draft', session, sessionId)
        candidate = { ...candidate, ourSignatoryId: snapshot?.id ?? null, ourSignatoryVersion: snapshot?.version ?? null, ourSignatorySnapshot: snapshot }
        authorize(session)
        assertCommandUnsealed(journal, commandKey, message => failure('conflict', message))
        const completed = commandReplay(journal, request, session, 'subcontract-contract', message => failure('conflict', message)).previous
        if (completed)
          return structuredClone(completed)
        if (existing && contracts.get(existing.draft.id) !== existing)
          throw failure('conflict', '合同在核对签约主体期间已变化，请保留输入并核对版本')
        validate(candidate, request.action, sessionId)
      }
      const id = existing?.draft.id ?? createId()
      if (!existing && contracts.has(id))
        throw failure('conflict', '新合同稳定编号已存在，不能覆盖既有事实')
      const timestamp = now()
      const version = (existing?.version ?? 0) + 1
      const removed = new Set(request.attachments.removeIds ?? [])
      const restored = new Set(request.attachments.restoreIds ?? [])
      for (const fileId of [...removed, ...restored]) {
        if (removed.has(fileId) && restored.has(fileId))
          throw failure('validation-failed', '同一附件不能同时删除和恢复')
        if (!existing?.attachments.some(row => row.id === fileId && row.ownerId === id && row.ownerType === 'contract'))
          throw failure('relationship-mismatch', '附件不存在或不属于当前分包合同')
      }
      const attachments = (existing?.attachments ?? []).map(file => ({
        ...file,
        deletedAt: removed.has(file.id) ? timestamp : restored.has(file.id) ? null : file.deletedAt,
      }))
      const originals = new Map(existing?.originals ?? [])
      const allocated = new Set([...contracts.values()].flatMap(row => row.attachments.map(file => file.id)))
      for (const file of request.attachments.add ?? []) {
        if (!text(file.fileName))
          throw failure('validation-failed', '分包合同附件名称不能为空')
        const bytes = contractOriginalBytes(file, { required: true, fail: (message) => {
          throw failure('validation-failed', message)
        } })
        if (bytes === null)
          throw failure('validation-failed', '分包合同附件正文缺失')
        const fileId = createAttachmentId()
        if (!fileId.trim() || allocated.has(fileId) || originals.has(fileId))
          throw failure('conflict', '附件稳定编号已存在，不能覆盖原件或历史')
        allocated.add(fileId)
        originals.set(fileId, { bytes, sha256: contractOriginalDigest(bytes) })
        attachments.push({
          id: fileId,
          ownerType: 'contract',
          ownerId: id,
          fileName: text(file.fileName),
          filePath: '',
          fileSize: bytes.byteLength,
          sha256: contractOriginalDigest(bytes),
          mimeType: text(file.mimeType),
          category: text(file.category),
          uploader: session.actorId,
          uploadedAt: timestamp,
          deletedAt: null,
        })
      }
      contracts.set(id, {
        draft: cleanDraft({ ...candidate, status: request.action === 'submit' ? '审批中' : request.action === 'draft' ? '草稿' : candidate.status }, id),
        attachments,
        originals,
        version,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        migrationBatchId: existing?.migrationBatchId ?? null,
        settlementStatus: existing?.settlementStatus ?? null,
        clearanceStatus: existing?.clearanceStatus ?? null,
      })
      sourceVersion += 1
      const result = { id, commandId: request.commandId, version: String(version), updatedAt: timestamp, attachmentIds: attachments.filter(file => file.deletedAt === null).map(file => file.id) }
      replay.set(commandKey, structuredClone(result))
      return result
    },
    resolve(commandId: string, session: BusinessSession) {
      authorize(session)
      parseResolveCommandBody({ commandId })
      return resolveJournalCommand(journal, commandId, session, 'subcontract-contract')
    },
  }
  applyMigrationSnapshot = instance.applyMigrationSnapshot
  return instance
}

export const subcontractContractCommandTestInstance = createSubcontractContractCommandTestInstance({
  resolveSignatory: (draft, existing, required, _session, sessionId) => developmentOurSignatoryOwner(sessionId).withTransaction(async (tx) => {
    try {
      return await resolveContractSignatory(tx, { id: draft.ourSignatoryId, version: draft.ourSignatoryVersion, prior: existing?.draft.ourSignatorySnapshot, required })
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw new SubcontractContractRepositoryProblem(cause.problem)
      throw cause
    }
  }),
  resolveProjects: sessionId => projectCommandTestInstance.rows(sessionId),
  resolveSuppliers: sessionId => supplierCommandTestInstance.rows(sessionId),
})
