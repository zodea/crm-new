import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ReceiptCommand, ReceiptCommandResult, ReceiptRecord, ReceiptReferenceFacts } from '../../app/lib/receipt/contract'
import type { BusinessSession } from './business-session'
import type { StoredReceipt } from './receipt-migration'
import { createHash, randomUUID } from 'node:crypto'
import { RECEIPT_READ_CAPABILITY, RECEIPT_WRITE_CAPABILITY, receiptProblem } from '../../app/lib/receipt/contract'
import { validateReceiptDraft } from '../../app/lib/receipt/domain'
import { prepareReceiptAttachments, readReceiptAttachment } from './receipt-attachments'
import { assertUniqueReceiptBankSerial } from './receipt-constraints'
import { prepareReceiptMigration } from './receipt-migration'

interface Options {
  references: (sessionId?: string | null) => ReceiptReferenceFacts
  createId?: () => string
  now?: () => string
}

interface State {
  records: Map<string, StoredReceipt>
  commands: Map<string, { fingerprint: string, result: ReceiptCommandResult }>
  payloads: Map<string, string>
  version: number
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

export function createReceiptCommandTestInstance(options: Options) {
  const states = new Map<string, State>()
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  function stateFor(sessionId?: string | null) {
    const key = sessionId || 'default'
    let state = states.get(key)
    if (!state) {
      state = { records: new Map(), commands: new Map(), payloads: new Map(), version: 0 }
      states.set(key, state)
    }
    return state
  }

  function authorize(session: BusinessSession, capability: string) {
    if (!session.capabilities.includes(capability))
      throw receiptProblem('forbidden', '无收款操作权限')
  }

  return {
    reset(sessionId?: string | null) { states.delete(sessionId || 'default') },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const state = stateFor(sessionId)
      const prepared = prepareReceiptMigration(state.records, state.payloads, snapshot, options.references(sessionId))
      return () => {
        if (!prepared.changed)
          return
        state.records = prepared.records
        state.payloads = prepared.payloads
        state.commands = new Map([...state.commands].filter(([, command]) => state.records.has(command.result.id)))
        state.version++
      }
    },
    facts(sessionId?: string | null) {
      const state = stateFor(sessionId)
      return { rows: structuredClone([...state.records.values()]), sourceVersion: `receipt-${state.version}` }
    },
    form(id: string, session: BusinessSession, sessionId?: string | null): ReceiptRecord {
      authorize(session, RECEIPT_READ_CAPABILITY)
      const record = stateFor(sessionId).records.get(id)
      if (!record)
        throw receiptProblem('not-found', '收款记录不存在或已删除')
      return structuredClone(record)
    },
    fileContent(id: string, fileId: string, session: BusinessSession, sessionId?: string | null) {
      authorize(session, RECEIPT_READ_CAPABILITY)
      const state = stateFor(sessionId)
      const record = state.records.get(id)
      if (!record)
        throw receiptProblem('not-found', '收款记录不存在或已删除')
      return readReceiptAttachment(record.attachments, state.payloads, fileId)
    },
    execute(request: ReceiptCommand, session: BusinessSession, sessionId?: string | null): ReceiptCommandResult {
      authorize(session, RECEIPT_WRITE_CAPABILITY)
      if (request.origin !== 'real' || request.workspaceId !== session.workspaceId || request.actorId !== session.actorId
        || request.requiredCapability !== RECEIPT_WRITE_CAPABILITY) {
        throw receiptProblem('forbidden', '收款命令的来源或会话身份无效')
      }
      if (!request.commandId?.trim() || !['draft', 'save', 'submit'].includes(request.action))
        throw receiptProblem('validation-failed', '收款命令编号或保存动作无效')
      const state = stateFor(sessionId)
      const existing = request.id ? state.records.get(request.id) : undefined
      for (const [field, capability] of [['projectId', 'project:list:read'], ['customerId', 'customer:list:read'], ['contractId', 'construction-contract:read']] as const) {
        if (request.draft[field] || existing?.draft[field])
          authorize(session, capability)
      }
      const fingerprint = createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex')
      const previous = state.commands.get(request.commandId)
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw receiptProblem('conflict', '同一命令编号不能提交不同内容，请重新发起保存')
        return structuredClone(previous.result)
      }
      if (request.id && !existing)
        throw receiptProblem('not-found', '收款记录不存在或已删除')
      if (request.baseVersion !== (existing?.version ?? null))
        throw receiptProblem('conflict', '收款记录已更新，请重新读取并核对后保存')
      const draft = validateReceiptDraft(request.draft, request.action, options.references(sessionId))
      assertUniqueReceiptBankSerial([...state.records.values()].filter(row => row.id !== existing?.id).map(row => ({ draft: row.draft })).concat({ draft }))
      const timestamp = now()
      const id = existing?.id ?? createId()
      const attachments = prepareReceiptAttachments({
        ownerId: id,
        records: existing?.attachments ?? [],
        payloads: state.payloads,
        changes: request.attachments ?? {},
        now: timestamp,
        actorId: session.actorId,
        createId,
      })
      const record: StoredReceipt = {
        id,
        dataOrigin: 'real',
        draft: { ...draft, no: draft.no || `SK-${id}`, status: request.action === 'submit' ? 'submitted' : request.action === 'draft' ? 'draft' : existing?.draft.status ?? 'draft' },
        version: String(Number(existing?.version ?? 0) + 1),
        attachments: attachments.records,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        createdBy: existing?.createdBy ?? session.actorId,
        updatedBy: session.actorId,
        migrationBatchId: existing?.migrationBatchId ?? null,
      }
      state.records.set(id, record)
      state.payloads = attachments.payloads
      state.version++
      const result = { id, commandId: request.commandId, version: record.version, updatedAt: timestamp, attachmentIds: attachments.attachmentIds }
      state.commands.set(request.commandId, { fingerprint, result })
      return structuredClone(result)
    },
  }
}
