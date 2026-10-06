import type {
  CustomerCommandRequestDTO,
  CustomerCommandResultDTO,
  CustomerFormReadDTO,
} from '../../app/lib/customer/command-contract'
import type { CustomerListSourceRow } from '../../app/lib/customer/repository'
import type {
  CustomerFormDraft,
  FormAttachment,
  FormAttachmentChanges,
  FormAttachmentDraft,
} from '../../app/lib/master-data/forms'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { BusinessSession } from './business-session'
import type { CommandJournal } from './command-journal'
import { randomUUID } from 'node:crypto'
import { CUSTOMER_WRITE_CAPABILITY } from '../../app/lib/customer/command-contract'
import { customerProblem, CustomerRepositoryProblem } from '../../app/lib/customer/repository'
import { commandReplay, parseResolveCommandBody, resolveJournalCommand } from './command-journal'
import { migratedIdentityDraft, migratedIdentityRecords, migratedIdentityTimestamp } from './core-identity-migration'

interface StoredCustomer {
  migrationBatchId?: string | null
  id: string
  draft: CustomerFormDraft
  attachments: FormAttachment[]
  version: number
  updatedAt: string
}

interface SessionState extends CommandJournal<CustomerCommandResultDTO> {
  commands: Map<string, CustomerCommandResultDTO>
  customers: Map<string, StoredCustomer>
  sourceVersion: number
}

interface Options {
  createId?: () => string
  now?: () => string
}

function failure(code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict', message: string, fieldErrors: Record<string, string[]> = {}): CustomerRepositoryProblem {
  return new CustomerRepositoryProblem({ ...customerProblem(code, message), fieldErrors })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanDraft(value: CustomerFormDraft): CustomerFormDraft {
  return {
    ...(text(value.id) ? { id: text(value.id) } : {}),
    name: text(value.name),
    aliases: Array.isArray(value.aliases) ? value.aliases.map(text).filter(Boolean) : [],
    taxNo: text(value.taxNo),
    legalRep: text(value.legalRep),
    registeredAddress: text(value.registeredAddress),
    invoiceName: text(value.invoiceName),
    bank: text(value.bank),
    bankAccount: text(value.bankAccount),
    contact: text(value.contact),
    contactPhone: text(value.contactPhone),
    note: text(value.note),
    status: text(value.status) || 'active',
  }
}

function attachmentFromDraft(customerId: string, draft: FormAttachmentDraft, now: string): FormAttachment {
  return {
    id: `file-${randomUUID()}`,
    ownerType: 'customer',
    ownerId: customerId,
    fileName: text(draft.fileName),
    filePath: text(draft.filePath),
    fileSize: Math.max(0, draft.fileSize ?? 0),
    mimeType: text(draft.mimeType),
    category: text(draft.category),
    uploader: text(draft.uploader),
    uploadedAt: now,
    deletedAt: null,
  }
}

function applyAttachments(customerId: string, current: readonly FormAttachment[], changes: FormAttachmentChanges, now: string): FormAttachment[] {
  const removed = new Set(changes.removeIds ?? [])
  const restored = new Set(changes.restoreIds ?? [])
  return [
    ...current.map(file => ({
      ...file,
      deletedAt: removed.has(file.id) ? now : restored.has(file.id) ? null : file.deletedAt,
    })),
    ...(changes.add ?? []).map(file => attachmentFromDraft(customerId, file, now)),
  ]
}

function toRow(customer: StoredCustomer): CustomerListSourceRow {
  const draft = customer.draft
  return {
    dataOrigin: 'real',
    id: customer.id,
    name: text(draft.name),
    aliases: [...(draft.aliases ?? [])],
    taxNo: text(draft.taxNo),
    legalRep: text(draft.legalRep),
    registeredAddress: text(draft.registeredAddress),
    invoiceName: text(draft.invoiceName),
    bank: text(draft.bank),
    bankAccount: text(draft.bankAccount),
    contact: text(draft.contact),
    contactPhone: text(draft.contactPhone),
    status: text(draft.status) || 'active',
    note: text(draft.note),
    updatedAt: customer.updatedAt,
  }
}

export function createCustomerCommandTestInstance(options: Options = {}) {
  const states = new Map<string, SessionState>()
  const createId = options.createId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = { commands: new Map(), commandFingerprints: new Map(), sealedCommands: new Set(), customers: new Map(), sourceVersion: 0 }
      states.set(key, state)
    }
    return state
  }

  function assertEnvelope(request: CustomerCommandRequestDTO, session: BusinessSession) {
    if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId)
      throw failure('forbidden', '请求身份与当前会话不匹配')
    if (request.requiredCapability !== CUSTOMER_WRITE_CAPABILITY || !session.capabilities.includes(CUSTOMER_WRITE_CAPABILITY))
      throw failure('forbidden', '无客户写入权限')
    if (!text(request.commandId))
      throw failure('validation-failed', 'commandId 必填', { commandId: ['commandId 必填'] })
  }

  return {
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const current = stateFor(sessionId)
      const records = migratedIdentityRecords(current.customers, snapshot, 'customers', entity => ({
        id: entity.id,
        draft: migratedIdentityDraft<CustomerFormDraft>('customer', entity),
        attachments: [],
        version: 1,
        updatedAt: migratedIdentityTimestamp(entity),
      }))
      const candidate = { ...current, customers: records, sourceVersion: current.sourceVersion + (records === current.customers ? 0 : 1) }
      return () => states.set(keyFor(sessionId), candidate)
    },
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    rows(sessionId?: string | null): CustomerListSourceRow[] {
      return [...stateFor(sessionId).customers.values()].map(toRow)
    },
    sourceVersion(sessionId?: string | null): string {
      return `customer-command-${stateFor(sessionId).sourceVersion}`
    },
    form(id: string, session: BusinessSession, sessionId?: string | null): CustomerFormReadDTO {
      if (!session.capabilities.includes(CUSTOMER_WRITE_CAPABILITY))
        throw failure('forbidden', '无客户写入权限')
      const stored = stateFor(sessionId).customers.get(id)
      if (!stored)
        throw failure('not-found', '正式客户不存在')
      return {
        draft: { ...stored.draft, id: stored.id, aliases: [...(stored.draft.aliases ?? [])] },
        attachments: stored.attachments.map(file => ({ ...file })),
        version: String(stored.version),
        updatedAt: stored.updatedAt,
      }
    },
    async execute(request: CustomerCommandRequestDTO, session: BusinessSession, sessionId?: string | null): Promise<CustomerCommandResultDTO> {
      request = structuredClone(request)
      assertEnvelope(request, session)
      const state = stateFor(sessionId)
      const { key: commandKey, previous: duplicate } = commandReplay(state, request, session, 'customer', message => failure('conflict', message))
      if (duplicate)
        return { ...duplicate, attachmentIds: [...duplicate.attachmentIds] }
      const draft = cleanDraft(request.draft)
      if (request.action !== 'draft') {
        const fieldErrors: Record<string, string[]> = {}
        if (!draft.name)
          fieldErrors.name = ['客户名称为必填项']
        if (!draft.contact)
          fieldErrors.contact = ['联系人为必填项']
        if (Object.keys(fieldErrors).length)
          throw failure('validation-failed', '客户表单校验失败', fieldErrors)
      }
      if ((request.attachments.add ?? []).some(file =>
        !text(file.fileName)
        || (file.fileSize !== undefined && (!Number.isFinite(file.fileSize) || file.fileSize < 0)))) {
        throw failure('validation-failed', '客户附件信息无效', { attachments: ['附件名称和大小无效'] })
      }
      const existing = request.id ? state.customers.get(request.id) : null
      if (request.id && !existing)
        throw failure('not-found', '正式客户不存在')
      if (!request.id && request.baseVersion !== null)
        throw failure('validation-failed', '新建客户不能带 baseVersion')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '客户已被其他操作更新，请先处理最新版本')
      const duplicateTaxNo = draft.taxNo && [...state.customers.values()].some(item => item.id !== request.id && text(item.draft.taxNo) === draft.taxNo)
      if (duplicateTaxNo)
        throw failure('validation-failed', '统一社会信用代码已存在', { taxNo: ['统一社会信用代码已存在'] })
      const timestamp = now()
      const id = existing?.id ?? createId()
      const attachments = applyAttachments(id, existing?.attachments ?? [], request.attachments, timestamp)
      if (attachments.filter(file => file.deletedAt === null).length > 9)
        throw failure('validation-failed', '客户附件最多 9 份', { attachments: ['客户附件最多 9 份'] })
      const stored: StoredCustomer = {
        id,
        draft: { ...draft, id },
        attachments,
        version: (existing?.version ?? 0) + 1,
        updatedAt: timestamp,
        migrationBatchId: existing?.migrationBatchId ?? null,
      }
      state.customers.set(id, stored)
      state.sourceVersion += 1
      const result: CustomerCommandResultDTO = {
        id,
        commandId: request.commandId,
        version: String(stored.version),
        updatedAt: timestamp,
        attachmentIds: stored.attachments.filter(file => !file.deletedAt).map(file => file.id),
      }
      state.commands.set(commandKey, structuredClone(result))
      return { ...result, attachmentIds: [...result.attachmentIds] }
    },
    resolve(commandId: string, session: BusinessSession, sessionId?: string | null) {
      if (!session.capabilities.includes(CUSTOMER_WRITE_CAPABILITY))
        throw failure('forbidden', '无客户原提交核对权限')
      parseResolveCommandBody({ commandId })
      return resolveJournalCommand(stateFor(sessionId), commandId, session, 'customer')
    },
  }
}

export const customerCommandTestInstance = createCustomerCommandTestInstance()
