import type {
  ConstructionContractCommandRequestDTO,
  ConstructionContractCommandResultDTO,
  ConstructionContractFormReadDTO,
} from '../../app/lib/construction-contract/command-contract'
import type { ConstructionManagementFeeConfiguration } from '../../app/lib/construction-contract/management-fee'
import type {
  ConstructionContractDetailSource,
  ConstructionContractFactSources,
} from '../../app/lib/construction-contract/repository'
import type {
  ContractFormAttachment,
  ProjectContractFormDraft,
} from '../../app/lib/contract/forms'
import type { ContractOriginalContent } from '../../app/lib/forms/original-content'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { OurSignatorySnapshot } from '../../app/lib/our-signatory/contract'
import type { BusinessSession } from './business-session'
import type { CommandJournal } from './command-journal'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { CONSTRUCTION_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/construction-contract/command-contract'
import { adoptConstructionManagementFee, decodeConstructionManagementFee, emptyConstructionManagementFee, validateConstructionManagementFee } from '../../app/lib/construction-contract/management-fee'
import {
  constructionContractProblem,
  ConstructionContractRepositoryProblem,
} from '../../app/lib/construction-contract/repository'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { assertCommandUnsealed, commandReplay, parseResolveCommandBody, resolveJournalCommand } from './command-journal'
import { contractMigratedAttachments, contractOriginalBytes, contractOriginalDigest } from './contract-original'
import { contractMigratedSignatory } from './contract-signatory-migration'
import { assertRetainedMigrationReferences } from './core-identity-migration'
import { customerCommandTestInstance } from './customer-command-test-instance'

import { developmentOurSignatoryOwner } from './our-signatory-runtime'
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

export interface StoredConstructionContract {
  managementFee: ConstructionManagementFeeConfiguration
  id: string
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  originals: Map<string, { bytes: Uint8Array, sha256: string }>
  version: number
  createdAt: string
  updatedAt: string
  actualCompletionDate: string | null
  migrationBatchId: string | null
}
type StoredContract = StoredConstructionContract
export interface ConstructionContractOwnerSnapshot {
  schemaVersion: 1
  sourceVersion: number
  contracts: StoredConstructionContract[]
  supplements: ConstructionContractFactSources['supplements']
}

interface SessionState extends CommandJournal<ConstructionContractCommandResultDTO> {
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
  resolveSignatory?: (draft: ProjectContractFormDraft, existing: StoredContract | null, required: boolean, session: BusinessSession, sessionId?: string | null) => Promise<OurSignatorySnapshot | null>
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
  managementFee?: ConstructionManagementFeeConfiguration
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
  code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict' | 'relationship-mismatch' | 'unavailable',
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
        commandFingerprints: new Map(),
        sealedCommands: new Set(),
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
      managementFeeAmount: source.managementFeeAmount ?? null,
      managementFeeBasis: source.managementFeeBasis ?? '',
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

  function validate(state: SessionState, draft: ProjectContractFormDraft, action: ConstructionContractCommandRequestDTO['action'], existing: StoredContract | null = null) {
    const fieldErrors: Record<string, string[]> = {}
    try {
      validateConstructionManagementFee(draft.managementFeeAmount ?? null, draft.managementFeeBasis ?? '')
    }
    catch (error) {
      fieldErrors.managementFeeAmount = [error instanceof Error ? error.message : '总合同管理费配置无效']
    }
    if (draft.isSupplement)
      fieldErrors.isSupplement = ['施工主合同入口不接受补充协议']
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
    const preservedPair = existing && text(existing.draft.projectId) === text(draft.projectId) && text(existing.draft.customerId) === text(draft.customerId)
    if (project && text(draft.customerId) && project.customerId !== text(draft.customerId) && !preservedPair)
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
      managementFee: structuredClone(stored.managementFee),
      ourSignatorySnapshot: draft.ourSignatorySnapshot ? structuredClone(draft.ourSignatorySnapshot) : null,
      legacyPartyA: draft.legacyPartyA ?? null,
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
      amount: number(draft.amount),
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
    /** A transaction-local formal owner adopts current records without importing or synchronizing masters. */
    importState(snapshot: ConstructionContractOwnerSnapshot) {
      if (snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.sourceVersion) || snapshot.sourceVersion < 0 || new Set(snapshot.contracts.map(row => row.id)).size !== snapshot.contracts.length)
        throw failure('unavailable', '施工合同当前owner快照身份或版本无效')
      const state = stateFor()
      for (const row of snapshot.contracts) {
        if (!row.id || row.draft.id !== row.id || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt)) || !(row.originals instanceof Map))
          throw failure('unavailable', '施工合同原身份、时间、版本或原件目录无效')
        decodeConstructionManagementFee(row.managementFee)
        for (const file of row.attachments) {
          if (file.ownerType !== 'contract' || file.ownerId !== row.id || !file.id)
            throw failure('unavailable', '施工合同附件串了原归属')
          const body = row.originals.get(file.id)
          if (body && (body.bytes.length !== file.fileSize || contractOriginalDigest(body.bytes) !== body.sha256 || file.sha256 !== body.sha256))
            throw failure('unavailable', '施工合同原件正文与摘要不一致')
        }
      }
      state.contracts = new Map(structuredClone(snapshot.contracts).map(row => [row.id, row]))
      state.migratedSupplements = structuredClone(snapshot.supplements)
      state.sourceVersion = snapshot.sourceVersion
    },
    exportState(): ConstructionContractOwnerSnapshot {
      const state = stateFor()
      return { schemaVersion: 1, sourceVersion: state.sourceVersion, contracts: structuredClone([...state.contracts.values()]), supplements: structuredClone(state.migratedSupplements) }
    },
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
          }))).concat(state.migratedSupplements.flatMap((supplement) => {
          const files = (supplement as ConstructionContractFactSources['supplements'][number] & { attachments?: ContractFormAttachment[] }).attachments ?? []
          return files.filter(file => file.deletedAt === null).map(file => ({ dataOrigin: 'real' as const, id: file.id, contractId: supplement.contractId!, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType, category: file.category, uploadedAt: file.uploadedAt }))
        })),
      }
    },
    sourceVersion(sessionId?: string | null) {
      return `construction-contract-command-${stateFor(sessionId).sourceVersion}`
    },
    importExisting(records: readonly ConstructionContractMigrationRecord[], sessionId?: string | null) {
      const state = stateFor(sessionId)
      const imported: string[] = []
      const candidate = new Map(state.contracts)
      const allocatedIds = new Set([...candidate.values()].flatMap(row => row.attachments.map(file => file.id)))
      for (const record of records) {
        const id = text(record.id)
        if (!id || (record.draft.id && text(record.draft.id) !== id))
          throw failure('validation-failed', '迁移施工合同 ID 无效或不一致')
        validate(state, record.draft, 'save')
        const managementFee = record.managementFee
          ? decodeConstructionManagementFee(record.managementFee)
          : adoptConstructionManagementFee(emptyConstructionManagementFee(), record.draft, { version: `import-${id}`, contractVersion: String(record.version ?? 1), adoptedAt: record.updatedAt, actorId: null, commandId: null })
        const cleaned = cleanDraft({ ...record.draft, managementFeeAmount: managementFee.amount, managementFeeBasis: managementFee.basis }, id)
        const current = candidate.get(id)
        if (current) {
          if (JSON.stringify(current.draft) === JSON.stringify(cleaned) && JSON.stringify(current.managementFee) === JSON.stringify(managementFee))
            continue
          throw failure('conflict', '迁移施工合同 ID 已存在且内容不一致')
        }
        const originals = new Map<string, { bytes: Uint8Array, sha256: string }>()
        const attachments = contractMigratedAttachments(record.attachments ?? [], { ownerId: id, allocatedIds, originals, fail: (message) => {
          throw failure('validation-failed', message)
        } })
        candidate.set(id, {
          managementFee,
          id,
          draft: cleaned,
          attachments,
          originals,
          version: record.version ?? 1,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          actualCompletionDate: record.actualCompletionDate ?? null,
          migrationBatchId: record.migrationBatchId ?? null,
        })
        imported.push(id)
      }
      state.contracts = candidate
      state.sourceVersion += imported.length
      return imported
    },
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[], sessionId?: string | null) {
      assertRetainedMigrationReferences(removed, 'construction_contracts', [...stateFor(sessionId).contracts.values()].map(row => ({
        id: row.id,
        references: [{ type: 'projects', id: row.draft.projectId }, { type: 'customers', id: row.draft.customerId }],
      })), message => failure('conflict', message))
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
          if (stored.version !== 1)
            throw failure('conflict', '迁入施工合同已有后来修改、删除或附件变更，不能回滚移除')
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
          ...contractMigratedSignatory(entity, (message) => { throw failure('unavailable', message) }),
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
          managementFeeAmount: numericAttribute(entity, 'managementFeeAmount'),
          managementFeeBasis: attribute(entity, 'managementFeeBasis'),
          retentionRatio: numericAttribute(entity, 'retentionRatio'),
          retentionAmount: numericAttribute(entity, 'retentionAmount'),
          retentionDays: numericAttribute(entity, 'retentionDays'),
          invoiceName: attribute(entity, 'invoiceName'),
          invoiceTaxNo: attribute(entity, 'invoiceTaxNo'),
          invoiceAddressPhone: attribute(entity, 'invoiceAddressPhone'),
          invoiceBank: attribute(entity, 'invoiceBank'),
          invoiceBankAccount: attribute(entity, 'invoiceBankAccount'),
          amount: entity.amount === null ? null : Number(entity.amount),
          status: attribute(entity, 'status') || '履约中',
          note: attribute(entity, 'note'),
        }
        validate(state, draft, 'save')
        const originals = new Map<string, { bytes: Uint8Array, sha256: string }>()
        const attachments = contractMigratedAttachments(entity.attributes.attachmentsJson ?? '[]', {
          ownerId: entity.id,
          legacyOwnerId: entity.legacyId,
          originals,
          allocatedIds: new Set([...state.contracts.values()].flatMap(row => row.attachments.map(file => file.id))),
          fail: (message) => {
            throw failure('validation-failed', message)
          },
        })
        let managementFee: ConstructionManagementFeeConfiguration
        try {
          managementFee = entity.attributes.managementFeeConfigurationJson !== undefined
            ? decodeConstructionManagementFee(JSON.parse(attribute(entity, 'managementFeeConfigurationJson')))
            : adoptConstructionManagementFee(emptyConstructionManagementFee(), draft, { version: `migration-${entity.id}`, contractVersion: '1', adoptedAt: updatedAt, actorId: null, commandId: null })
          if (managementFee.amount !== (draft.managementFeeAmount ?? null) || managementFee.basis !== (draft.managementFeeBasis ?? ''))
            throw new Error('原配置金额/依据与冻结历史不一致')
        }
        catch { throw failure('unavailable', '迁入总合同管理费配置或冻结采用证据无效，停止迁移') }
        state.contracts.set(entity.id, {
          managementFee,
          id: entity.id,
          draft: cleanDraft(draft, entity.id),
          attachments,
          originals,
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
    readFileContent(id: string, fileId: string, session: BusinessSession, sessionId?: string | null): ContractOriginalContent {
      if (!session.capabilities.includes('construction-contract:read'))
        throw failure('forbidden', '无施工合同原件读取权限')
      const stored = stateFor(sessionId).contracts.get(id)
      const file = stored?.attachments.find(row => row.id === fileId && row.ownerId === id && row.ownerType === 'contract' && row.deletedAt === null)
      if (!stored || !file)
        throw failure('not-found', '施工合同附件不存在、已删除或不属于当前合同')
      const original = stored.originals.get(fileId)
      if (!original)
        throw failure('not-found', '旧施工合同附件正文未迁入，请核对原始文件；路径不代表可读取的原件')
      if (original.bytes.byteLength !== file.fileSize || contractOriginalDigest(original.bytes) !== original.sha256 || (file.sha256 !== undefined && file.sha256 !== original.sha256))
        throw failure('unavailable', '施工合同原件正文、长度或摘要不一致，停止读取')
      return { ownerId: id, fileId, dataOrigin: 'real', fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize, sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') }
    },
    async execute(request: ConstructionContractCommandRequestDTO, session: BusinessSession, sessionId?: string | null) {
      request = structuredClone(request)
      assertEnvelope(request, session)
      let state = stateFor(sessionId)
      const reject = (message: string) => failure('conflict', message)
      const { key: commandKey, previous: duplicate } = commandReplay(state, request, session, 'construction-contract', reject)
      if (duplicate)
        return structuredClone(duplicate)
      if (options.assertReferences) {
        await options.assertReferences(request.draft, sessionId)
        state = stateFor(sessionId)
        assertEnvelope(request, session)
        assertCommandUnsealed(state, commandKey, reject)
        const completed = commandReplay(state, request, session, 'construction-contract', reject).previous
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
      validate(state, request.draft, request.action, existing)
      let candidate = request.draft
      if (options.resolveSignatory) {
        const snapshot = await options.resolveSignatory(candidate, existing, request.action !== 'draft', session, sessionId)
        candidate = { ...candidate, ourSignatoryId: snapshot?.id ?? null, ourSignatoryVersion: snapshot?.version ?? null, ourSignatorySnapshot: snapshot }
        state = stateFor(sessionId)
        assertEnvelope(request, session)
        assertCommandUnsealed(state, commandKey, reject)
        const completed = commandReplay(state, request, session, 'construction-contract', reject).previous
        if (completed)
          return structuredClone(completed)
        if (existing && state.contracts.get(existing.id) !== existing)
          throw failure('conflict', '合同在核对签约主体期间已变化，请保留输入并核对版本')
        validate(state, candidate, request.action, existing)
      }
      const timestamp = now()
      const managementFee = adoptConstructionManagementFee(existing?.managementFee ?? emptyConstructionManagementFee(), candidate, { version: randomUUID(), contractVersion: String((existing?.version ?? 0) + 1), adoptedAt: timestamp, actorId: session.actorId, commandId: request.commandId })
      candidate = { ...candidate, managementFeeAmount: managementFee.amount, managementFeeBasis: managementFee.basis }
      const id = existing?.id ?? createId()
      if (!existing && state.contracts.has(id))
        throw failure('conflict', '新合同稳定编号已存在，不能覆盖既有事实')
      const removed = new Set(request.attachments.removeIds ?? [])
      const restored = new Set(request.attachments.restoreIds ?? [])
      for (const fileId of [...removed, ...restored]) {
        if (removed.has(fileId) && restored.has(fileId))
          throw failure('validation-failed', '同一附件不能同时删除和恢复')
        if (!existing?.attachments.some(row => row.id === fileId && row.ownerId === id && row.ownerType === 'contract'))
          throw failure('relationship-mismatch', '附件不存在或不属于当前施工合同')
      }
      const attachments = (existing?.attachments ?? []).map(file => ({
        ...file,
        deletedAt: removed.has(file.id) ? timestamp : restored.has(file.id) ? null : file.deletedAt,
      }))
      const originals = new Map(existing?.originals ?? [])
      const allocated = new Set([...state.contracts.values()].flatMap(row => row.attachments.map(file => file.id)))
      for (const file of request.attachments.add ?? []) {
        if (!text(file.fileName))
          throw failure('validation-failed', '施工合同附件名称不能为空')
        const bytes = contractOriginalBytes(file, { required: true, fail: (message) => {
          throw failure('validation-failed', message)
        } })
        if (bytes === null)
          throw failure('validation-failed', '施工合同附件正文缺失')
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
      const stored: StoredContract = {
        managementFee,
        id,
        draft: cleanDraft({ ...candidate, status: request.action === 'submit' ? '审批中' : request.action === 'draft' ? '草稿' : candidate.status }, id),
        attachments,
        originals,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        actualCompletionDate: existing?.actualCompletionDate ?? null,
        migrationBatchId: existing?.migrationBatchId ?? null,
      }
      assertCommandUnsealed(state, commandKey, reject)
      state.contracts.set(id, stored)
      state.sourceVersion += 1
      const result: ConstructionContractCommandResultDTO = {
        id,
        commandId: request.commandId,
        version: String(stored.version),
        updatedAt: timestamp,
        attachmentIds: attachments.filter(file => file.deletedAt === null).map(file => file.id),
      }
      state.commands.set(commandKey, result)
      return structuredClone(result)
    },
    resolve(commandId: string, session: BusinessSession, sessionId?: string | null) {
      if (!session.capabilities.includes(CONSTRUCTION_CONTRACT_WRITE_CAPABILITY))
        throw failure('forbidden', '无施工合同原提交核对权限')
      parseResolveCommandBody({ commandId })
      return resolveJournalCommand(stateFor(sessionId), commandId, session, 'construction-contract')
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
  resolveSignatory: (draft, existing, required, _session, sessionId) => developmentOurSignatoryOwner(sessionId).withTransaction(async (tx) => {
    try {
      return await resolveContractSignatory(tx, { id: draft.ourSignatoryId, version: draft.ourSignatoryVersion, prior: existing?.draft.ourSignatorySnapshot, required })
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw new ConstructionContractRepositoryProblem(cause.problem)
      throw cause
    }
  }),
  resolveProjects: sessionId => projectCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name, customerId: row.customerId ?? null })),
  resolveCustomers: sessionId => customerCommandTestInstance.rows(sessionId),
  assertReferences: async (draft, sessionId) => (await import('./construction-contract-references')).assertConstructionContractReferences(draft, sessionId),
})
