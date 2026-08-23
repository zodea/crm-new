import type { SupplierFormDraft } from '../../app/lib/master-data/forms'
import type {
  SupplierCommandRequestDTO,
  SupplierCommandResultDTO,
  SupplierFormReadDTO,
} from '../../app/lib/supplier/command-contract'
import type { SupplierListSourceRow } from '../../app/lib/supplier/repository'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { SUPPLIER_WRITE_CAPABILITY } from '../../app/lib/supplier/command-contract'
import { supplierProblem, SupplierRepositoryProblem } from '../../app/lib/supplier/repository'

interface StoredSupplier {
  id: string
  draft: SupplierFormDraft
  version: number
  updatedAt: string
}

interface SessionState {
  commands: Map<string, SupplierCommandResultDTO>
  suppliers: Map<string, StoredSupplier>
  sourceVersion: number
}

interface Options {
  createId?: () => string
  now?: () => string
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
    invoiceName: text(draft.invoiceName),
    invoiceAddress: text(draft.invoiceAddress),
    bank: text(draft.bank),
    bankAccount: text(draft.bankAccount),
    phone: text(draft.phone),
    contact: text(draft.contact),
    contactPhone: text(draft.contactPhone),
    contactTitle: text(draft.contactTitle),
    credentialStatus: 'incomplete',
    note: text(draft.note),
    updatedAt: stored.updatedAt,
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
      state = { commands: new Map(), suppliers: new Map(), sourceVersion: 0 }
      states.set(key, state)
    }
    return state
  }

  function assertEnvelope(request: SupplierCommandRequestDTO, session: BusinessSession) {
    if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId)
      throw failure('forbidden', '请求身份与当前会话不匹配')
    if (request.requiredCapability !== SUPPLIER_WRITE_CAPABILITY || !session.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
      throw failure('forbidden', '无分供方写入权限')
    if (!text(request.commandId))
      throw failure('validation-failed', 'commandId 必填', { commandId: ['commandId 必填'] })
  }

  return {
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
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
      const stored: StoredSupplier = {
        id,
        draft: { ...draft, id },
        version: (existing?.version ?? 0) + 1,
        updatedAt: timestamp,
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
}

export const supplierCommandTestInstance = createSupplierCommandTestInstance()
