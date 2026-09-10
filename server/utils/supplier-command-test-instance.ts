import type { SupplierFormDraft } from '../../app/lib/master-data/forms'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type {
  SupplierCommandRequestDTO,
  SupplierCommandResultDTO,
  SupplierFormReadDTO,
  SupplierImportCommandRequestDTO,
} from '../../app/lib/supplier/command-contract'
import type { SupplierListSourceRow } from '../../app/lib/supplier/repository'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { SUPPLIER_WRITE_CAPABILITY } from '../../app/lib/supplier/command-contract'
import { supplierProblem, SupplierRepositoryProblem } from '../../app/lib/supplier/repository'
import { migratedIdentityDraft, migratedIdentityRecords, migratedIdentityTimestamp } from './core-identity-migration'

interface StoredSupplier {
  migrationBatchId?: string | null
  id: string
  draft: SupplierFormDraft
  credentialStatus: string
  version: number
  updatedAt: string
}

interface SessionState {
  commands: Map<string, SupplierCommandResultDTO>
  importFingerprints: Map<string, string>
  importedIds: Set<string>
  suppliers: Map<string, StoredSupplier>
  sourceVersion: number
}

interface Options {
  createId?: () => string
  now?: () => string
}

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
    importFingerprints: new Map(state.importFingerprints),
    importedIds: new Set(state.importedIds),
    suppliers: new Map([...state.suppliers].map(([id, stored]) => [id, {
      ...stored,
      draft: { ...stored.draft, aliases: [...(stored.draft.aliases ?? [])] },
    }])),
    sourceVersion: state.sourceVersion,
  }
}

export function createSupplierCommandTestInstance(options: Options = {}) {
  const states = new Map<string, SessionState>()
  const createId = options.createId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = { commands: new Map(), importFingerprints: new Map(), importedIds: new Set(), suppliers: new Map(), sourceVersion: 0 }
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

  const instance = {
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const current = stateFor(sessionId)
      const records = migratedIdentityRecords(current.suppliers, snapshot, 'suppliers', entity => ({
        id: entity.id,
        draft: migratedIdentityDraft<SupplierFormDraft>('supplier', entity),
        credentialStatus: 'incomplete',
        version: 1,
        updatedAt: migratedIdentityTimestamp(entity),
      }))
      const candidate = { ...current, suppliers: records, sourceVersion: current.sourceVersion + (records === current.suppliers ? 0 : 1), commands: new Map([...current.commands].filter(([, result]) => records.has(result.id))) }
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
    rows(sessionId?: string | null): SupplierListSourceRow[] {
      return [...stateFor(sessionId).suppliers.values()].map(toRow)
    },
    sourceVersion(sessionId?: string | null): string {
      return `supplier-command-${stateFor(sessionId).sourceVersion}`
    },
    form(id: string, session: BusinessSession, sessionId?: string | null): SupplierFormReadDTO {
      if (!session.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
        throw failure('forbidden', '无分供方写入权限')
      const stored = stateFor(sessionId).suppliers.get(id)
      if (!stored)
        throw failure('not-found', '正式分供方不存在')
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
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return { ...duplicate, attachmentIds: [] }
      const draft = cleanDraft(request.draft)
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
      if (existing && request.draft.laborScope === undefined)
        draft.laborScope = existing.draft.laborScope ?? ''
      if (request.id && !existing)
        throw failure('not-found', '正式分供方不存在')
      if (!request.id && request.baseVersion !== null)
        throw failure('validation-failed', '新建分供方不能带 baseVersion')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '分供方已被其他操作更新，请先处理最新版本')
      const duplicateTaxNo = draft.taxNo && [...state.suppliers.values()].some(item => item.id !== request.id && text(item.draft.taxNo) === draft.taxNo)
      const duplicateCode = draft.uniqueCode && [...state.suppliers.values()].some(item => item.id !== request.id && text(item.draft.uniqueCode) === draft.uniqueCode)
      if (duplicateTaxNo)
        throw failure('validation-failed', '统一社会信用代码已存在', { taxNo: ['统一社会信用代码已存在'] })
      if (duplicateCode)
        throw failure('validation-failed', '分供方内部编码已存在', { uniqueCode: ['分供方内部编码已存在'] })
      const timestamp = now()
      const id = existing?.id ?? createId()
      const invalidatesCredentialReview = existing && ['qualified', 'rejected'].includes(existing.credentialStatus)
        && (['name', 'uniqueCode', 'taxNo', 'legalRep', 'address', 'bank', 'bankAccount'] as const)
          .some(field => text(existing.draft[field]) !== text(draft[field]))
      const stored: StoredSupplier = {
        id,
        draft: { ...draft, id },
        credentialStatus: invalidatesCredentialReview ? 'incomplete' : existing?.credentialStatus ?? 'incomplete',
        version: (existing?.version ?? 0) + 1,
        updatedAt: timestamp,
        migrationBatchId: existing?.migrationBatchId ?? null,
      }
      state.suppliers.set(id, stored)
      state.sourceVersion += 1
      const result = {
        id,
        commandId: request.commandId,
        version: String(stored.version),
        updatedAt: timestamp,
        attachmentIds: [],
      }
      state.commands.set(request.commandId, result)
      return { ...result, attachmentIds: [] }
    },
  }
  return instance
}

export const supplierCommandTestInstance = createSupplierCommandTestInstance()
