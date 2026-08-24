import type { ContractFormAttachment, ProjectContractFormDraft } from '../../app/lib/contract/forms'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
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
import projectsSeed from '../../app/lib/db/seed/projects.json'
import suppliersSeed from '../../app/lib/db/seed/suppliers.json'
import { SUBCONTRACT_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/subcontract-contract/command-contract'
import {
  subcontractContractProblem,
  SubcontractContractRepositoryProblem,
} from '../../app/lib/subcontract-contract/repository'

interface Option { id: string, name: string }

interface StoredContract {
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: number
  createdAt: string
  updatedAt: string
  migrationBatchId: string | null
  settlementStatus: string | null
  clearanceStatus: string | null
}

interface Options {
  createId?: () => string
  createAttachmentId?: () => string
  now?: () => string
  projects?: readonly Option[]
  suppliers?: readonly Option[]
}

function failure(code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict', message: string, fieldErrors: Record<string, string[]> = {}) {
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
  const projects = new Map((options.projects ?? []).map(row => [row.id, row]))
  const suppliers = new Map((options.suppliers ?? []).map(row => [row.id, row]))
  const contracts = new Map<string, StoredContract>()
  const replay = new Map<string, SubcontractContractCommandResultDTO>()
  let migratedProjects = new Map<string, Option>()
  let migratedSuppliers = new Map<string, Option>()
  let sourceVersion = 0

  function authorize(session: BusinessSession) {
    if (!session.capabilities.includes(SUBCONTRACT_CONTRACT_WRITE_CAPABILITY))
      throw failure('forbidden', '无分包合同写入权限')
  }

  function validate(draft: ProjectContractFormDraft, action: SubcontractContractCommandRequestDTO['action']) {
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

  function toRow(stored: StoredContract): SubcontractContractDetailSource {
    const draft = stored.draft
    return {
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
      amount: Number(draft.amount ?? 0),
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

  return {
    reset() {
      contracts.clear()
      replay.clear()
      migratedProjects = new Map()
      migratedSuppliers = new Map()
      sourceVersion += 1
    },
    context(session: BusinessSession) {
      authorize(session)
      return {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        capabilities: [...session.capabilities],
        projects: [...new Map([...projects, ...migratedProjects]).values()].map(row => ({ id: row.id, label: row.name })),
        suppliers: [...new Map([...suppliers, ...migratedSuppliers]).values()].map(row => ({ id: row.id, label: row.name })),
      }
    },
    rows() {
      return [...contracts.values()].map(toRow)
    },
    facts(): SubcontractContractFactSources {
      return {
        supplements: [],
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
    synchronizeMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO) {
      const activeBatchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
      const entities = activeBatchId ? snapshot.entities : []
      const migratedIds = new Set(entities.filter(entity => entity.entityType === 'subcontract_contracts' && entity.deletedAt === null).map(entity => entity.id))
      for (const [id, stored] of contracts) {
        if (stored.migrationBatchId && (!migratedIds.has(id) || stored.migrationBatchId !== activeBatchId)) {
          contracts.delete(id)
          sourceVersion += 1
        }
      }
      migratedProjects = new Map(entities.filter(entity => entity.entityType === 'projects' && entity.deletedAt === null).map(entity => [entity.id, { id: entity.id, name: entity.name }]))
      migratedSuppliers = new Map(entities.filter(entity => entity.entityType === 'suppliers' && entity.deletedAt === null).map(entity => [entity.id, { id: entity.id, name: entity.name }]))
      const attribute = (entity: CoreMigrationServerEntityDTO, key: string) => entity.attributes[key] == null ? '' : String(entity.attributes[key])
      const numeric = (entity: CoreMigrationServerEntityDTO, key: string) => typeof entity.attributes[key] === 'number' ? entity.attributes[key] as number : null
      for (const entity of entities) {
        if (entity.entityType !== 'subcontract_contracts' || entity.deletedAt !== null || contracts.has(entity.id))
          continue
        const createdAt = attribute(entity, 'createdAt') || '1970-01-01T00:00:00.000Z'
        const draft: ProjectContractFormDraft = {
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
          amount: Number(entity.amount ?? 0),
          status: attribute(entity, 'status') || '履约中',
          note: attribute(entity, 'note'),
        }
        validate(draft, 'save')
        contracts.set(entity.id, {
          draft: cleanDraft(draft, entity.id),
          attachments: [],
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
    async execute(request: SubcontractContractCommandRequestDTO, session: BusinessSession): Promise<SubcontractContractCommandResultDTO> {
      authorize(session)
      if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId
        || request.requiredCapability !== SUBCONTRACT_CONTRACT_WRITE_CAPABILITY) {
        throw failure('forbidden', '分包合同命令会话不一致')
      }
      const replayed = replay.get(request.commandId)
      if (replayed)
        return replayed
      const existing = request.id ? contracts.get(request.id) ?? null : null
      if (request.id && !existing)
        throw failure('not-found', '未找到分包合同')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '分包合同已有更新版本')
      if (!existing && request.baseVersion !== null)
        throw failure('conflict', '新建分包合同不能携带旧版本')
      validate(request.draft, request.action)
      const id = existing?.draft.id ?? createId()
      const timestamp = now()
      const version = (existing?.version ?? 0) + 1
      const removed = new Set(request.attachments.removeIds ?? [])
      const restored = new Set(request.attachments.restoreIds ?? [])
      const attachments = (existing?.attachments ?? []).map(file => ({
        ...file,
        deletedAt: removed.has(file.id) ? timestamp : restored.has(file.id) ? null : file.deletedAt,
      }))
      for (const file of request.attachments.add ?? []) {
        attachments.push({
          id: createAttachmentId(),
          ownerType: 'contract',
          ownerId: id,
          fileName: text(file.fileName),
          filePath: text(file.filePath),
          fileSize: Number(file.fileSize) || 0,
          mimeType: text(file.mimeType),
          category: text(file.category),
          uploader: text(file.uploader),
          uploadedAt: timestamp,
          deletedAt: null,
        })
      }
      contracts.set(id, {
        draft: cleanDraft({ ...request.draft, status: request.action === 'submit' ? '审批中' : request.action === 'draft' ? '草稿' : request.draft.status }, id),
        attachments,
        version,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        migrationBatchId: existing?.migrationBatchId ?? null,
        settlementStatus: existing?.settlementStatus ?? null,
        clearanceStatus: existing?.clearanceStatus ?? null,
      })
      sourceVersion += 1
      const result = { id, commandId: request.commandId, version: String(version), updatedAt: timestamp, attachmentIds: attachments.filter(file => file.deletedAt === null).map(file => file.id) }
      replay.set(request.commandId, result)
      return result
    },
  }
}

export const SUBCONTRACT_CONTRACT_FORM_PROJECTS = projectsSeed.map(row => ({ id: row.id, name: row.name }))
export const SUBCONTRACT_CONTRACT_FORM_SUPPLIERS = suppliersSeed.map(row => ({ id: row.id, name: row.name }))

export const subcontractContractCommandTestInstance = createSubcontractContractCommandTestInstance({
  projects: SUBCONTRACT_CONTRACT_FORM_PROJECTS,
  suppliers: SUBCONTRACT_CONTRACT_FORM_SUPPLIERS,
})
