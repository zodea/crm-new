import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ReceiptCommand, ReceiptCommandResult, ReceiptRecord, ReceiptReferenceFacts } from '../../app/lib/receipt/contract'
import type { BusinessSession } from './business-session'
import type { CommandJournal } from './command-journal'
import type { StoredReceipt } from './receipt-migration'
import { randomUUID } from 'node:crypto'
import { RECEIPT_READ_CAPABILITY, RECEIPT_WRITE_CAPABILITY, receiptProblem } from '../../app/lib/receipt/contract'
import { validateReceiptDraft } from '../../app/lib/receipt/domain'
import { commandReplay, parseResolveCommandBody, resolveJournalCommand } from './command-journal'
import { assertRetainedMigrationReferences } from './core-identity-migration'
import { prepareReceiptAttachments, readReceiptAttachment } from './receipt-attachments'
import { assertUniqueReceiptBankSerial } from './receipt-constraints'
import { prepareReceiptMigration } from './receipt-migration'

interface Options {
  references: (sessionId?: string | null) => ReceiptReferenceFacts
  createId?: () => string
  now?: () => string
}

interface State extends CommandJournal<ReceiptCommandResult> {
  records: Map<string, StoredReceipt>
  payloads: Map<string, string>
  version: number
}

export function createReceiptCommandTestInstance(options: Options) {
  const states = new Map<string, State>()
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  function stateFor(sessionId?: string | null) {
    const key = sessionId || 'default'
    let state = states.get(key)
    if (!state) {
      state = { records: new Map(), commands: new Map(), commandFingerprints: new Map(), sealedCommands: new Set(), payloads: new Map(), version: 0 }
      states.set(key, state)
    }
    return state
  }

  function authorize(session: BusinessSession, capability: string) {
    if (!session.capabilities.includes(capability))
      throw receiptProblem('forbidden', '无收款操作权限')
  }

  return {
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[], sessionId?: string | null) {
      assertRetainedMigrationReferences(removed, 'receipt_registrations', [...stateFor(sessionId).records.values()].map(row => ({
        id: row.id,
        references: [{ type: 'projects', id: row.draft.projectId }, { type: 'customers', id: row.draft.customerId }, { type: 'construction_contracts', id: row.draft.contractId }],
      })), message => receiptProblem('conflict', message))
    },
    reset(sessionId?: string | null) { states.delete(sessionId || 'default') },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const state = stateFor(sessionId)
      const prepared = prepareReceiptMigration(state.records, state.payloads, snapshot, options.references(sessionId))
      return () => {
        if (!prepared.changed)
          return
        state.records = prepared.records
        state.payloads = prepared.payloads
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
      request = structuredClone(request)
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
      const { key: commandKey, previous } = commandReplay(state, request, session, 'receipt', message => receiptProblem('conflict', message))
      if (previous) {
        return previous
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
      state.commands.set(commandKey, structuredClone(result))
      return structuredClone(result)
    },
    resolve(commandId: string, session: BusinessSession, sessionId?: string | null) {
      authorize(session, RECEIPT_WRITE_CAPABILITY)
      parseResolveCommandBody({ commandId })
      return resolveJournalCommand(stateFor(sessionId), commandId, session, 'receipt')
    },
  }
}
