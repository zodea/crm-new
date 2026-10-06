import type { SupplierFormDraft } from '../../app/lib/master-data/forms'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type {
  SupplierCommandRequestDTO,
  SupplierCommandResultDTO,
  SupplierFormReadDTO,
  SupplierImportCommandRequestDTO,
} from '../../app/lib/supplier/command-contract'
import type { SupplierCredentialAggregate } from '../../app/lib/supplier/credential-domain'
import type { SupplierListSourceRow } from '../../app/lib/supplier/repository'
import type { BusinessSession } from './business-session'
import type { SupplierCredentialScope } from './supplier-credential-service'
import { randomUUID } from 'node:crypto'
import { supplierCredentialMasterDraft } from '../../app/lib/migration/supplier-credential-source'
import { SUPPLIER_WRITE_CAPABILITY } from '../../app/lib/supplier/command-contract'
import { SupplierCredentialNotAppliedProblem } from '../../app/lib/supplier/credential-contract'
import { credentialMasterChanged, credentialRecords, currentCredentialStatus, emptySupplierCredentialAggregate, invalidateCredentialReview } from '../../app/lib/supplier/credential-domain'
import { shanghaiBusinessDate } from '../../app/lib/supplier/credentials'
import { supplierProblem, SupplierRepositoryProblem } from '../../app/lib/supplier/repository'
import { preserveTaxpayerVerification } from '../../app/lib/supplier/taxpayer-verification'
import { migratedIdentityDraft, migratedIdentityRecords, migratedIdentityTimestamp } from './core-identity-migration'
import { migratedSupplierCredentialMaster, prepareSupplierCredentialMigration } from './supplier-credential-migration'

export interface StoredSupplier {
  migrationBatchId?: string | null
  id: string
  draft: SupplierFormDraft
  credentialStatus: string
  version: number
  updatedAt: string
}

export interface SupplierCommandState {
  commands: Map<string, SupplierCommandResultDTO>
  commandFingerprints: Map<string, string>
  importFingerprints: Map<string, string>
  importedIds: Set<string>
  suppliers: Map<string, StoredSupplier>
  credentialScopes: Map<string, SupplierCredentialAggregate>
  sourceVersion: number
}

interface Options {
  createId?: () => string
  now?: () => string
  /** A transaction-local snapshot, never a second persistent authority. */
  initialState?: SupplierCommandState
}

type SessionState = SupplierCommandState

export interface SupplierImportAdoptionTransaction {
  commit: () => void
  rollback: () => void
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function failure(code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict', message: string, fieldErrors: Record<string, string[]> = {}): SupplierRepositoryProblem {
  return new SupplierRepositoryProblem({ ...supplierProblem(code, message), fieldErrors })
}

function cleanDraft(value: SupplierFormDraft): SupplierFormDraft {
  return {
    ...(text(value.id) ? { id: text(value.id) } : {}),
    name: text(value.name),
    aliases: Array.isArray(value.aliases) ? value.aliases.map(text).filter(Boolean) : [],
    externalRef: text(value.externalRef),
    uniqueCode: text(value.uniqueCode),
    taxNo: text(value.taxNo),
    businessType: text(value.businessType),
    supplierCategory: text(value.supplierCategory),
    rating: text(value.rating),
    legalRep: text(value.legalRep),
    registeredCapital: value.registeredCapital === null ? null : Number.isFinite(value.registeredCapital) ? value.registeredCapital : null,
    registeredDate: text(value.registeredDate),
    address: text(value.address),
    taxpayerType: text(value.taxpayerType),
    taxpayerVerificationStatus: text(value.taxpayerVerificationStatus),
    taxpayerVerificationSource: text(value.taxpayerVerificationSource),
    taxpayerVerifiedAt: value.taxpayerVerifiedAt === null ? null : text(value.taxpayerVerifiedAt),
    taxpayerVerificationNote: text(value.taxpayerVerificationNote),
    mainBusiness: text(value.mainBusiness),
    laborScope: text(value.laborScope),
    invoiceName: text(value.invoiceName),
    invoiceAddress: text(value.invoiceAddress),
    bank: text(value.bank),
    bankAccount: text(value.bankAccount),
    phone: text(value.phone),
    contact: text(value.contact),
    contactPhone: text(value.contactPhone),
    contactTitle: text(value.contactTitle),
    note: text(value.note),
    approvalStatus: text(value.approvalStatus) || 'active',
  }
}

function assertUniqueSupplierDraft(state: SessionState, draft: SupplierFormDraft, supplierId?: string) {
  if (draft.taxNo && [...state.suppliers.values()].some(item => item.id !== supplierId && text(item.draft.taxNo) === draft.taxNo))
    throw failure('validation-failed', '统一社会信用代码已存在', { taxNo: ['统一社会信用代码已存在'] })
  if (draft.uniqueCode && [...state.suppliers.values()].some(item => item.id !== supplierId && text(item.draft.uniqueCode) === draft.uniqueCode))
    throw failure('validation-failed', '分供方内部编码已存在', { uniqueCode: ['分供方内部编码已存在'] })
}

function toRow(stored: StoredSupplier): SupplierListSourceRow {
  const draft = stored.draft
  return {
    dataOrigin: 'real',
    id: stored.id,
    name: text(draft.name),
    aliases: [...(draft.aliases ?? [])],
    externalRef: text(draft.externalRef),
    uniqueCode: text(draft.uniqueCode),
    taxNo: text(draft.taxNo),
    businessType: text(draft.businessType),
    supplierCategory: text(draft.supplierCategory),
    rating: text(draft.rating),
    legalRep: text(draft.legalRep),
    registeredCapital: draft.registeredCapital ?? null,
    registeredDate: text(draft.registeredDate) || null,
    address: text(draft.address),
    taxpayerType: text(draft.taxpayerType),
    mainBusiness: text(draft.mainBusiness),
    laborScope: text(draft.laborScope),
    invoiceName: text(draft.invoiceName),
    invoiceAddress: text(draft.invoiceAddress),
    bank: text(draft.bank),
    bankAccount: text(draft.bankAccount),
    phone: text(draft.phone),
    contact: text(draft.contact),
    contactPhone: text(draft.contactPhone),
    contactTitle: text(draft.contactTitle),
    credentialStatus: stored.credentialStatus,
    note: text(draft.note),
    updatedAt: stored.updatedAt,
  }
}

function importedStoredSupplier(row: SupplierListSourceRow): StoredSupplier {
  return {
    id: row.id,
    credentialStatus: row.credentialStatus,
    draft: cleanDraft({
      id: row.id,
      name: row.name,
      aliases: row.aliases,
      externalRef: row.externalRef,
      uniqueCode: row.uniqueCode,
      taxNo: row.taxNo,
      businessType: row.businessType,
      supplierCategory: row.supplierCategory,
      rating: row.rating,
      legalRep: row.legalRep,
      registeredCapital: row.registeredCapital,
      registeredDate: row.registeredDate ?? '',
      address: row.address,
      taxpayerType: row.taxpayerType,
      taxpayerVerificationStatus: '',
      taxpayerVerificationSource: '',
      taxpayerVerifiedAt: null,
      taxpayerVerificationNote: '',
      mainBusiness: row.mainBusiness,
      laborScope: row.laborScope ?? '',
      invoiceName: row.invoiceName,
      invoiceAddress: row.invoiceAddress,
      bank: row.bank,
      bankAccount: row.bankAccount,
      phone: row.phone,
      contact: row.contact,
      contactPhone: row.contactPhone,
      contactTitle: row.contactTitle,
      note: row.note,
      approvalStatus: 'draft',
    }),
    version: 1,
    updatedAt: row.updatedAt,
  }
}

function cloneState(state: SessionState): SessionState {
  return {
    commands: new Map(state.commands),
    commandFingerprints: new Map(state.commandFingerprints),
    importFingerprints: new Map(state.importFingerprints),
    importedIds: new Set(state.importedIds),
    suppliers: new Map([...state.suppliers].map(([id, stored]) => [id, {
      ...stored,
      draft: { ...stored.draft, aliases: [...(stored.draft.aliases ?? [])] },
    }])),
    credentialScopes: new Map([...state.credentialScopes].map(([id, aggregate]) => [id, structuredClone(aggregate)])),
    sourceVersion: state.sourceVersion,
  }
}

export function createSupplierCommandService(options: Options = {}) {
  const states = new Map<string, SessionState>()
  if (options.initialState)
    states.set('default', cloneState(options.initialState))
  const createId = options.createId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = { commands: new Map(), commandFingerprints: new Map(), importFingerprints: new Map(), importedIds: new Set(), suppliers: new Map(), credentialScopes: new Map(), sourceVersion: 0 }
      states.set(key, state)
    }
    return state
  }

  function assertEnvelope(request: Pick<SupplierCommandRequestDTO, 'workspaceId' | 'actorId' | 'requiredCapability' | 'commandId'>, session: BusinessSession) {
    if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId)
      throw failure('forbidden', '请求身份与当前会话不匹配')
    if (request.requiredCapability !== SUPPLIER_WRITE_CAPABILITY || !session.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
      throw failure('forbidden', '无分供方写入权限')
    if (!text(request.commandId))
      throw failure('validation-failed', 'commandId 必填', { commandId: ['commandId 必填'] })
  }

  function credentialScope(supplierId: string, sessionId?: string | null): SupplierCredentialScope {
    const state = stateFor(sessionId)
    const supplier = state.suppliers.get(supplierId)
    if (!supplier)
      throw failure('not-found', '当前正式分供方不存在')
    const aggregate = state.credentialScopes.get(supplierId) ?? emptySupplierCredentialAggregate(supplierId)
    return { draft: structuredClone(supplier.draft), version: supplier.version, aggregate: structuredClone(aggregate) }
  }

  const instance = {
    snapshot(sessionId?: string | null): SupplierCommandState {
      return cloneState(stateFor(sessionId))
    },
    readCredentialScope: credentialScope,
    transactCredentialScope<T>(supplierId: string, operation: (scope: SupplierCredentialScope) => { changed: boolean, value: T, commandId?: string }, sessionId?: string | null): T {
      const scope = credentialScope(supplierId, sessionId)
      const result = operation(scope)
      if (result.changed) {
        const state = stateFor(sessionId)
        const supplier = state.suppliers.get(supplierId)!
        const draft = cleanDraft(scope.draft)
        try {
          assertUniqueSupplierDraft(state, draft, supplierId)
        }
        catch (cause) {
          // 当前候选还没有发布；可证明本命令被重复字段校验整体拒绝。
          if (result.commandId && cause instanceof SupplierRepositoryProblem)
            throw new SupplierCredentialNotAppliedProblem(result.commandId, cause.message, 'validation-failed')
          throw cause
        }
        if (credentialMasterChanged(supplier.draft, draft))
          invalidateCredentialReview(scope.aggregate)
        state.credentialScopes.set(supplierId, scope.aggregate)
        state.suppliers.set(supplierId, { ...supplier, draft: { ...draft, id: supplierId }, version: supplier.version + 1, credentialStatus: currentCredentialStatus(scope.aggregate, new Date(now())), updatedAt: now() })
        state.sourceVersion++
      }
      return result.value
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const current = stateFor(sessionId)
      const credentialPlan = prepareSupplierCredentialMigration([...current.credentialScopes.values()], snapshot, new Date(now()))
      const credentialScopes = new Map(credentialPlan.aggregates.map(row => [row.supplierId, row]))
      const records = migratedIdentityRecords(current.suppliers, snapshot, 'suppliers', (entity) => {
        const master = migratedSupplierCredentialMaster(snapshot, entity.id)
        const draft = master ? supplierCredentialMasterDraft(master) : migratedIdentityDraft<SupplierFormDraft>('supplier', entity)
        const aggregate = credentialScopes.get(entity.id)
        return { id: entity.id, draft: { ...draft, id: entity.id }, credentialStatus: aggregate ? currentCredentialStatus(aggregate, new Date(now())) : 'incomplete', version: 1, updatedAt: migratedIdentityTimestamp(entity) }
      })
      for (const [id, aggregate] of credentialScopes) {
        if (current.suppliers.has(id) && !records.has(id) && aggregate.migrationBatchId === null && (aggregate.credentials.length || aggregate.requirements.length || aggregate.review))
          throw failure('conflict', '迁入分供方已有独立证照资料，恢复将使原件归属悬空')
      }
      const candidate = { ...current, suppliers: records, credentialScopes, sourceVersion: current.sourceVersion + (records === current.suppliers && !credentialPlan.changed ? 0 : 1), commands: new Map([...current.commands].filter(([, result]) => records.has(result.id))) }
      return () => states.set(keyFor(sessionId), candidate)
    },
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    prepareImportedSuppliers(rows: readonly SupplierListSourceRow[], sessionId?: string | null): SupplierImportAdoptionTransaction {
      const key = keyFor(sessionId)
      const previous = states.get(key)
      const snapshot = previous ? cloneState(previous) : null
      let committed = false
      return {
        commit() {
          committed = true
          const state = stateFor(sessionId)
          let changed = false
          for (const row of rows) {
            if (state.suppliers.has(row.id))
              continue
            state.suppliers.set(row.id, importedStoredSupplier(row))
            state.importedIds.add(row.id)
            changed = true
          }
          if (changed)
            state.sourceVersion += 1
        },
        rollback() {
          if (!committed)
            return
          if (snapshot)
            states.set(key, cloneState(snapshot))
          else
            states.delete(key)
          committed = false
        },
      }
    },
    removeImportedSuppliers(ids: readonly string[], sessionId?: string | null) {
      const state = states.get(keyFor(sessionId))
      if (!state)
        return
      let removed = false
      for (const id of ids) {
        if (!state.importedIds.delete(id))
          continue
        state.suppliers.delete(id)
        removed = true
      }
      if (removed)
        state.sourceVersion += 1
    },
    rows(sessionId?: string | null, asOf = now()): SupplierListSourceRow[] {
      return [...stateFor(sessionId).suppliers.values()].map((stored) => {
        const scope = credentialScope(stored.id, sessionId)
        const fileIds = credentialRecords(scope.aggregate).filter(row => row.category === '营业执照' && row.file?.state === 'available').map(row => row.file!.id)
        return { ...toRow(stored), credentialStatus: currentCredentialStatus(scope.aggregate, new Date(asOf)), businessLicense: { state: fileIds.length ? 'available' as const : 'missing' as const, fileCount: fileIds.length, fileIds } }
      })
    },
    sourceVersion(sessionId?: string | null, asOf = now()): string {
      return `supplier-command-${stateFor(sessionId).sourceVersion}-${shanghaiBusinessDate(new Date(asOf))}`
    },
    form(id: string, session: BusinessSession, sessionId?: string | null): SupplierFormReadDTO {
      if (!session.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
        throw failure('forbidden', '无分供方写入权限')
      const stored = stateFor(sessionId).suppliers.get(id)
      if (!stored)
        throw failure('not-found', '正式分供方不存在')
      credentialScope(id, sessionId)
      return {
        draft: { ...stored.draft, id, aliases: [...(stored.draft.aliases ?? [])] },
        attachments: [],
        version: String(stored.version),
        updatedAt: stored.updatedAt,
      }
    },
    async importRow(request: SupplierImportCommandRequestDTO, session: BusinessSession, sessionId?: string | null): Promise<SupplierCommandResultDTO> {
      assertEnvelope(request, session)
      if (!text(request.draft.name))
        throw failure('validation-failed', '公司全称不能为空', { name: ['公司全称不能为空'] })
      const state = stateFor(sessionId)
      const fingerprint = JSON.stringify(request)
      const previousFingerprint = state.importFingerprints.get(request.commandId)
      if ((previousFingerprint && previousFingerprint !== fingerprint)
        || (!previousFingerprint && state.commands.has(request.commandId))) {
        throw failure('conflict', '此导入标识已用于其他内容，请重新发起导入')
      }
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return { ...duplicate, attachmentIds: [] }
      const externalRef = text(request.draft.externalRef)
      const matches = externalRef
        ? [...state.suppliers.values()].filter(item => text(item.draft.externalRef) === externalRef)
        : []
      if (matches.length > 1)
        throw failure('conflict', '外部旧 ID 对应多个分供方，请先核对匹配标识', { externalRef: ['外部旧 ID 未唯一匹配'] })
      const existing = matches[0]
      // 查找、合并与 execute 的写入在同一同步段内完成；不以客户端分页结果推测匹配。
      // 新建沿既定最小导入合同；重导只覆盖明确映射的字段，核验结论由原有规则维护。
      const draft: SupplierFormDraft = {
        ...(existing?.draft ?? { aliases: [], supplierCategory: '其他', taxpayerType: '未核验', approvalStatus: 'draft' }),
        ...request.draft,
        externalRef,
      }
      state.importFingerprints.set(request.commandId, fingerprint)
      return instance.execute({
        ...request,
        ...(existing ? { id: existing.id } : {}),
        draft,
        baseVersion: existing ? String(existing.version) : null,
        action: 'draft',
        attachments: {},
      }, session, sessionId)
    },
    async execute(request: SupplierCommandRequestDTO, session: BusinessSession, sessionId?: string | null): Promise<SupplierCommandResultDTO> {
      assertEnvelope(request, session)
      const state = stateFor(sessionId)
      const fingerprint = JSON.stringify(request)
      const previousFingerprint = state.commandFingerprints.get(request.commandId)
      if (previousFingerprint !== undefined && previousFingerprint !== fingerprint)
        throw failure('conflict', '此保存标识已用于其他内容，请核对原提交')
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return { ...duplicate, attachmentIds: [] }
      let draft = cleanDraft(request.draft)
      if (request.action !== 'draft') {
        const fieldErrors: Record<string, string[]> = {}
        if (!draft.name)
          fieldErrors.name = ['公司全称为必填项']
        if (!draft.supplierCategory)
          fieldErrors.supplierCategory = ['分供方类别为必填项']
        if (!draft.contact)
          fieldErrors.contact = ['主要联系人为必填项']
        if (Object.keys(fieldErrors).length)
          throw failure('validation-failed', '分供方表单校验失败', fieldErrors)
      }
      const existing = request.id ? state.suppliers.get(request.id) : null
      draft = preserveTaxpayerVerification(existing?.draft ?? null, draft)
      if (existing)
        credentialScope(existing.id, sessionId)
      if (existing && request.draft.laborScope === undefined)
        draft.laborScope = existing.draft.laborScope ?? ''
      if (request.id && !existing)
        throw failure('not-found', '正式分供方不存在')
      if (!request.id && request.baseVersion !== null)
        throw failure('validation-failed', '新建分供方不能带 baseVersion')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '分供方已被其他操作更新，请先处理最新版本')
      assertUniqueSupplierDraft(state, draft, request.id)
      const timestamp = now()
      const id = existing?.id ?? createId()
      const aggregate = structuredClone(state.credentialScopes.get(id) ?? emptySupplierCredentialAggregate(id))
      if (existing && credentialMasterChanged(existing.draft, draft))
        invalidateCredentialReview(aggregate)
      if (aggregate.migrationBatchId)
        aggregate.changedAfterMigration = true
      const stored: StoredSupplier = {
        id,
        draft: { ...draft, id },
        credentialStatus: currentCredentialStatus(aggregate, new Date(timestamp)),
        version: (existing?.version ?? 0) + 1,
        updatedAt: timestamp,
        migrationBatchId: existing?.migrationBatchId ?? null,
      }
      state.suppliers.set(id, stored)
      aggregate.supplierAudits.push({ id: randomUUID(), action: existing ? 'update' : 'create', outcome: request.action, sourceCategory: state.importFingerprints.has(request.commandId) ? 'import' : 'form', changedFields: Object.keys(draft).filter(key => JSON.stringify(existing?.draft[key as keyof SupplierFormDraft]) !== JSON.stringify(draft[key as keyof SupplierFormDraft])), notePresent: Boolean(draft.note), createdAt: timestamp, actorId: session.actorId })
      state.credentialScopes.set(id, aggregate)
      state.sourceVersion += 1
      const result = {
        id,
        commandId: request.commandId,
        version: String(stored.version),
        updatedAt: timestamp,
        attachmentIds: [],
      }
      state.commands.set(request.commandId, result)
      state.commandFingerprints.set(request.commandId, fingerprint)
      return { ...result, attachmentIds: [] }
    },
  }
  return instance
}
