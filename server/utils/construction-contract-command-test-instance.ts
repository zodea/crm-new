import type {
  ConstructionContractCommandRequestDTO,
  ConstructionContractCommandResultDTO,
  ConstructionContractFormReadDTO,
} from '../../app/lib/construction-contract/command-contract'
import type {
  ConstructionContractDetailSource,
  ConstructionContractFactSources,
} from '../../app/lib/construction-contract/repository'
import type {
  ContractFormAttachment,
  ProjectContractFormDraft,
} from '../../app/lib/contract/forms'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { CONSTRUCTION_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/construction-contract/command-contract'
import {
  constructionContractProblem,
  ConstructionContractRepositoryProblem,
} from '../../app/lib/construction-contract/repository'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { projectCommandTestInstance } from './project-command-test-instance'

interface ProjectOption {
  id: string
  name: string
  customerId: string | null
}

interface CustomerOption {
  id: string
  name: string
}

interface StoredContract {
  id: string
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: number
  createdAt: string
  updatedAt: string
  actualCompletionDate: string | null
  migrationBatchId: string | null
}

interface SessionState {
  referenceProjects: Map<string, ProjectOption>
  referenceCustomers: Map<string, CustomerOption>
  commands: Map<string, ConstructionContractCommandResultDTO>
  contracts: Map<string, StoredContract>
  sourceVersion: number
  migratedProjects: Map<string, ProjectOption>
  migratedCustomers: Map<string, CustomerOption>
  migratedSupplements: ConstructionContractFactSources['supplements']
}

interface Options {
  assertReferences?: (draft: ProjectContractFormDraft, sessionId?: string | null) => Promise<void>
  createId?: () => string
  createAttachmentId?: () => string
  now?: () => string
  projects?: ProjectOption[]
  customers?: CustomerOption[]
  resolveProjects?: (sessionId?: string | null) => readonly ProjectOption[]
  resolveCustomers?: (sessionId?: string | null) => readonly CustomerOption[]
}

export interface ConstructionContractMigrationRecord {
  id: string
  draft: ProjectContractFormDraft
  attachments?: ContractFormAttachment[]
  version?: number
  createdAt: string
  updatedAt: string
  actualCompletionDate?: string | null
  migrationBatchId?: string | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function attribute(entity: CoreMigrationServerEntityDTO, key: string): string {
  const value = entity.attributes[key]
  return value == null ? '' : String(value)
}

function numericAttribute(entity: CoreMigrationServerEntityDTO, key: string): number | null {
  const value = entity.attributes[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function failure(
  code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict',
  message: string,
  fieldErrors: Record<string, string[]> = {},
) {
  return new ConstructionContractRepositoryProblem({
    ...constructionContractProblem(code, message),
    fieldErrors,
  })
}

export function createConstructionContractCommandTestInstance(options: Options = {}) {
  const states = new Map<string, SessionState>()
  const createId = options.createId ?? (() => randomUUID())
  const createAttachmentId = options.createAttachmentId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = {
        referenceProjects: new Map(),
        referenceCustomers: new Map(),
        commands: new Map(),
        contracts: new Map(),
        sourceVersion: 0,
        migratedProjects: new Map(),
        migratedCustomers: new Map(),
        migratedSupplements: [],
      }
      states.set(key, state)
    }
    state.referenceProjects = new Map((options.resolveProjects?.(sessionId) ?? options.projects ?? []).map(row => [row.id, row]))
    state.referenceCustomers = new Map((options.resolveCustomers?.(sessionId) ?? options.customers ?? []).map(row => [row.id, row]))
    return state
  }

  function cleanDraft(source: ProjectContractFormDraft, id: string): ProjectContractFormDraft & { id: string } {
    return {
      ...source,
      id,
      isSupplement: false,
      originalContractId: null,
      no: text(source.no),
      name: text(source.name),
      projectId: text(source.projectId) || null,
      customerId: text(source.customerId) || null,
      supplierId: null,
      subKind: '',
      content: text(source.content),
      invoiceType: text(source.invoiceType),
      contactName: text(source.contactName),
      contactPhone: text(source.contactPhone),
      taxRate: number(source.taxRate),
      signDate: text(source.signDate),
      mainTerms: text(source.mainTerms),
      paymentTerms: text(source.paymentTerms),
      brandQualityTerms: text(source.brandQualityTerms),
      scheduleTerms: text(source.scheduleTerms),
      warrantyTerms: text(source.warrantyTerms),
      specialTerms: text(source.specialTerms),
      retentionRatio: number(source.retentionRatio),
      retentionAmount: number(source.retentionAmount),
      retentionDays: number(source.retentionDays),
      invoiceName: text(source.invoiceName),
      invoiceTaxNo: text(source.invoiceTaxNo),
      invoiceAddressPhone: text(source.invoiceAddressPhone),
      invoiceBank: text(source.invoiceBank),
      invoiceBankAccount: text(source.invoiceBankAccount),
      amount: number(source.amount),
      status: text(source.status) || '履约中',
      note: typeof source.note === 'string' ? source.note : '',
      lineItems: undefined,
    }
  }

  function projectFor(state: SessionState, id: string) {
    return state.referenceProjects.get(id) ?? state.migratedProjects.get(id)
  }

  function customerFor(state: SessionState, id: string) {
    return state.referenceCustomers.get(id) ?? state.migratedCustomers.get(id)
  }

  function validate(state: SessionState, draft: ProjectContractFormDraft, action: ConstructionContractCommandRequestDTO['action']) {
    const fieldErrors: Record<string, string[]> = {}
    if (action !== 'draft') {
      if (!text(draft.name))
        fieldErrors.name = ['合同名称为必填项']
      if (!text(draft.projectId))
        fieldErrors.projectId = ['项目为必填项']
      if (!text(draft.customerId))
        fieldErrors.customerId = ['甲方客户为必填项']
      if (!text(draft.content))
        fieldErrors.content = ['合同内容为必填项']
      if (!text(draft.signDate))
        fieldErrors.signDate = ['签约日期为必填项']
    }
    for (const [field, value, label] of [
      ['amount', draft.amount, '含税合同金额'],
      ['taxRate', draft.taxRate, '税率'],
      ['retentionAmount', draft.retentionAmount, '质保金金额'],
      ['retentionDays', draft.retentionDays, '质保期'],
    ] as const) {
      if (number(value) != null && number(value)! < 0)
        fieldErrors[field] = [`${label}不能为负数`]
    }
    const retentionRatio = number(draft.retentionRatio)
    if (retentionRatio != null && (retentionRatio < 0 || retentionRatio > 1))
      fieldErrors.retentionRatio = ['质保金比例必须在 0 到 1 之间']
    if (draft.lineItems !== undefined)
      fieldErrors.lineItems = ['施工合同不接受采购明细']
    if (Object.keys(fieldErrors).length)
      throw failure('validation-failed', '施工合同表单校验失败', fieldErrors)
    const project = projectFor(state, text(draft.projectId))
    if (text(draft.projectId) && !project)
      throw failure('validation-failed', '项目不存在或来源不可用', { projectId: ['项目不存在'] })
    if (text(draft.customerId) && !customerFor(state, text(draft.customerId)))
      throw failure('validation-failed', '客户不存在或来源不可用', { customerId: ['客户不存在'] })
    if (project && text(draft.customerId) && project.customerId !== text(draft.customerId))
      throw failure('validation-failed', '项目与甲方客户关系不匹配', { customerId: ['必须选择项目当前客户'] })
  }

  function assertEnvelope(request: ConstructionContractCommandRequestDTO, session: BusinessSession) {
    if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId)
      throw failure('forbidden', '请求身份与当前会话不匹配')
    if (request.requiredCapability !== CONSTRUCTION_CONTRACT_WRITE_CAPABILITY
      || !session.capabilities.includes(CONSTRUCTION_CONTRACT_WRITE_CAPABILITY)) {
      throw failure('forbidden', '无施工合同写入权限')
    }
    if (!text(request.commandId))
      throw failure('validation-failed', 'commandId 必填')
  }

  function toRow(state: SessionState, stored: StoredContract): ConstructionContractDetailSource {
    const draft = stored.draft
    const project = projectFor(state, text(draft.projectId))
    const customer = customerFor(state, text(draft.customerId))
    return {
      dataOrigin: 'real',
      id: stored.id,
      no: text(draft.no),
      name: text(draft.name),
      kind: '施工',
      projectId: text(draft.projectId) || null,
      projectName: project?.name ?? '',
      projectPermission: 'allowed',
      customerId: text(draft.customerId) || null,
      customerName: customer?.name ?? '',
      customerPermission: 'allowed',
      amount: number(draft.amount) ?? 0,
      settledAmount: 0,
      invoicedAmount: 0,
      receivedAmount: 0,
      actualCompletionDate: stored.actualCompletionDate,
      content: text(draft.content),
      invoiceType: text(draft.invoiceType),
      contactName: text(draft.contactName),
      contactPhone: text(draft.contactPhone),
      taxRate: number(draft.taxRate),
      signDate: text(draft.signDate) || null,
      mainTerms: text(draft.mainTerms),
      paymentTerms: text(draft.paymentTerms),
      warrantyTerms: text(draft.warrantyTerms),
      retentionRatio: number(draft.retentionRatio),
      retentionAmount: number(draft.retentionAmount),
      retentionDays: number(draft.retentionDays),
      invoiceName: text(draft.invoiceName),
      invoiceTaxNo: text(draft.invoiceTaxNo),
      invoiceAddressPhone: text(draft.invoiceAddressPhone),
      invoiceBank: text(draft.invoiceBank),
      invoiceBankAccount: text(draft.invoiceBankAccount),
      status: text(draft.status),
      note: typeof draft.note === 'string' ? draft.note : '',
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    }
  }

  let applyMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) => void

  function prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null): () => void {
    const stateKey = keyFor(sessionId)
    const current = stateFor(sessionId)
    const candidate = structuredClone(current)
    states.set(stateKey, candidate)
    try {
      applyMigrationSnapshot(snapshot, sessionId)
    }
    finally {
      states.set(stateKey, current)
    }
    return () => states.set(stateKey, candidate)
  }

  const instance = {
    formContext(sessionId?: string | null) {
      const state = stateFor(sessionId)
      return {
        projects: [...new Map([...state.migratedProjects, ...state.referenceProjects]).values()],
        customers: [...new Map([...state.migratedCustomers, ...state.referenceCustomers]).values()],
      }
    },
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    rows(sessionId?: string | null) {
      const state = stateFor(sessionId)
      return [...state.contracts.values()].map(stored => toRow(state, stored))
    },
    facts(sessionId?: string | null): ConstructionContractFactSources {
      const state = stateFor(sessionId)
      return {
        supplements: structuredClone(state.migratedSupplements),
        changes: [],
        monthlyStatements: [],
        finalSettlements: [],
        penalties: [],
        invoiceApplications: [],
        invoiceRegistrations: [],
        receipts: [],
        acceptances: [],
        warranties: [],
        files: [...state.contracts.values()].flatMap(stored => stored.attachments
          .filter(file => file.deletedAt === null)
          .map(file => ({
            dataOrigin: 'real' as const,
            id: file.id,
            contractId: stored.id,
            fileName: file.fileName,
            fileSize: file.fileSize,
            mimeType: file.mimeType,
            category: file.category,
            uploadedAt: file.uploadedAt,
          }))),
      }
    },
    sourceVersion(sessionId?: string | null) {
      return `construction-contract-command-${stateFor(sessionId).sourceVersion}`
    },
    importExisting(records: readonly ConstructionContractMigrationRecord[], sessionId?: string | null) {
      const state = stateFor(sessionId)
      const imported: string[] = []
      for (const record of records) {
        const id = text(record.id)
        if (!id || (record.draft.id && text(record.draft.id) !== id))
          throw failure('validation-failed', '迁移施工合同 ID 无效或不一致')
        validate(state, record.draft, 'save')
        const cleaned = cleanDraft(record.draft, id)
        const current = state.contracts.get(id)
        if (current) {
          if (JSON.stringify(current.draft) === JSON.stringify(cleaned))
            continue
          throw failure('conflict', '迁移施工合同 ID 已存在且内容不一致')
        }
        state.contracts.set(id, {
          id,
          draft: cleaned,
          attachments: structuredClone(record.attachments ?? []),
          version: record.version ?? 1,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          actualCompletionDate: record.actualCompletionDate ?? null,
          migrationBatchId: record.migrationBatchId ?? null,
        })
        state.sourceVersion += 1
        imported.push(id)
      }
      return imported
    },
    prepareMigrationSnapshot,
    synchronizeMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      prepareMigrationSnapshot(snapshot, sessionId)()
    },
    applyMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const state = stateFor(sessionId)
      const activeBatchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
      const entities = activeBatchId ? snapshot.entities : []
      const migratedIds = new Set(
        entities
          .filter(entity => entity.entityType === 'construction_contracts' && entity.deletedAt === null)
          .map(entity => entity.id),
      )

      for (const [id, stored] of state.contracts) {
        if (stored.migrationBatchId && (!migratedIds.has(id) || stored.migrationBatchId !== activeBatchId)) {
          state.contracts.delete(id)
          state.sourceVersion += 1
        }
      }
      state.migratedProjects = new Map(entities
        .filter(entity => entity.entityType === 'projects' && entity.deletedAt === null)
        .map(entity => [entity.id, {
          id: entity.id,
          name: entity.name,
          customerId: entity.references.customerId ?? null,
        }]))
      state.migratedCustomers = new Map(entities
        .filter(entity => entity.entityType === 'customers' && entity.deletedAt === null)
        .map(entity => [entity.id, { id: entity.id, name: entity.name }]))
      const constructionContractIds = new Set(entities
        .filter(entity => entity.entityType === 'construction_contracts' && entity.deletedAt === null)
        .map(entity => entity.id))
      state.migratedSupplements = entities
        .filter(entity => entity.entityType === 'contract_supplements'
          && entity.deletedAt === null
          && constructionContractIds.has(entity.references.contractId ?? ''))
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
        if (entity.entityType !== 'construction_contracts' || entity.deletedAt !== null)
          continue
        const current = state.contracts.get(entity.id)
        if (current) {
          if (current.migrationBatchId === activeBatchId)
            continue
          throw failure('conflict', '迁移施工合同 ID 与既有中央命令记录冲突')
        }
        const projectId = entity.references.projectId ?? null
        const customerId = entity.references.customerId ?? null
        const createdAt = attribute(entity, 'createdAt') || '1970-01-01T00:00:00.000Z'
        const updatedAt = attribute(entity, 'updatedAt') || createdAt
        const draft: ProjectContractFormDraft = {
          id: entity.id,
          no: attribute(entity, 'no'),
          name: entity.name,
          projectId,
          customerId,
          content: attribute(entity, 'content'),
          invoiceType: attribute(entity, 'invoiceType'),
          contactName: attribute(entity, 'contactName'),
          contactPhone: attribute(entity, 'contactPhone'),
          taxRate: numericAttribute(entity, 'taxRate'),
          signDate: attribute(entity, 'signDate'),
          mainTerms: attribute(entity, 'mainTerms'),
          paymentTerms: attribute(entity, 'paymentTerms'),
          warrantyTerms: attribute(entity, 'warrantyTerms'),
          retentionRatio: numericAttribute(entity, 'retentionRatio'),
          retentionAmount: numericAttribute(entity, 'retentionAmount'),
          retentionDays: numericAttribute(entity, 'retentionDays'),
          invoiceName: attribute(entity, 'invoiceName'),
          invoiceTaxNo: attribute(entity, 'invoiceTaxNo'),
          invoiceAddressPhone: attribute(entity, 'invoiceAddressPhone'),
          invoiceBank: attribute(entity, 'invoiceBank'),
          invoiceBankAccount: attribute(entity, 'invoiceBankAccount'),
          amount: Number(entity.amount ?? 0),
          status: attribute(entity, 'status') || '履约中',
          note: attribute(entity, 'note'),
        }
        validate(state, draft, 'save')
        state.contracts.set(entity.id, {
          id: entity.id,
          draft: cleanDraft(draft, entity.id),
          attachments: [],
          version: 1,
          createdAt,
          updatedAt,
          actualCompletionDate: attribute(entity, 'actualCompletionDate') || null,
          migrationBatchId: activeBatchId,
        })
        state.sourceVersion += 1
      }
    },
    form(id: string, session: BusinessSession, sessionId?: string | null): ConstructionContractFormReadDTO {
      if (!session.capabilities.includes(CONSTRUCTION_CONTRACT_WRITE_CAPABILITY))
        throw failure('forbidden', '无施工合同写入权限')
      const stored = stateFor(sessionId).contracts.get(id)
      if (!stored)
        throw failure('not-found', '正式施工合同不存在')
      return {
        draft: structuredClone(stored.draft),
        attachments: structuredClone(stored.attachments),
        version: String(stored.version),
        updatedAt: stored.updatedAt,
      }
    },
    async execute(request: ConstructionContractCommandRequestDTO, session: BusinessSession, sessionId?: string | null) {
      assertEnvelope(request, session)
      const state = stateFor(sessionId)
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return structuredClone(duplicate)
      if (options.assertReferences) {
        await options.assertReferences(request.draft, sessionId)
        const completed = state.commands.get(request.commandId)
        if (completed)
          return structuredClone(completed)
      }
      const existing = request.id ? state.contracts.get(request.id) ?? null : null
      if (request.id && !existing)
        throw failure('not-found', '正式施工合同不存在')
      if (!request.id && request.baseVersion !== null)
        throw failure('validation-failed', '新建施工合同不能带 baseVersion')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '施工合同已被其他操作更新，请先处理最新版本')
      validate(state, request.draft, request.action)
      const timestamp = now()
      const id = existing?.id ?? createId()
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
          fileSize: number(file.fileSize) ?? 0,
          mimeType: text(file.mimeType),
          category: text(file.category),
          uploader: text(file.uploader),
          uploadedAt: timestamp,
          deletedAt: null,
        })
      }
      const stored: StoredContract = {
        id,
        draft: cleanDraft({ ...request.draft, status: request.action === 'submit' ? '审批中' : request.action === 'draft' ? '草稿' : request.draft.status }, id),
        attachments,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        actualCompletionDate: existing?.actualCompletionDate ?? null,
        migrationBatchId: existing?.migrationBatchId ?? null,
      }
      state.contracts.set(id, stored)
      state.sourceVersion += 1
      const result: ConstructionContractCommandResultDTO = {
        id,
        commandId: request.commandId,
        version: String(stored.version),
        updatedAt: timestamp,
        attachmentIds: attachments.filter(file => file.deletedAt === null).map(file => file.id),
      }
      state.commands.set(request.commandId, result)
      return structuredClone(result)
    },
  }
  applyMigrationSnapshot = instance.applyMigrationSnapshot
  return instance
}

export const CONSTRUCTION_CONTRACT_EXISTING_ID = 'construction-contract-existing-320'

export const CONSTRUCTION_CONTRACT_EXISTING_RECORD: ConstructionContractMigrationRecord = {
  id: CONSTRUCTION_CONTRACT_EXISTING_ID,
  draft: {
    id: CONSTRUCTION_CONTRACT_EXISTING_ID,
    no: 'SG-EXISTING-320',
    name: '既有中央施工合同',
    projectId: 'project-real-320',
    customerId: 'customer-real-320',
    content: '既有施工合同受控迁入中央',
    signDate: '2026-01-08',
    amount: 960000,
    status: '履约中',
  },
  attachments: [],
  version: 1,
  createdAt: '2026-01-08T00:00:00.000Z',
  updatedAt: '2026-01-08T00:00:00.000Z',
  actualCompletionDate: null,
  migrationBatchId: null,
}

export const constructionContractCommandTestInstance = createConstructionContractCommandTestInstance({
  resolveProjects: sessionId => projectCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name, customerId: row.customerId ?? null })),
  resolveCustomers: sessionId => customerCommandTestInstance.rows(sessionId),
  assertReferences: async (draft, sessionId) => (await import('./construction-contract-references')).assertConstructionContractReferences(draft, sessionId),
})
