import type { DeliveryCentralRecord, DeliveryCommand, DeliveryCommandResult, DeliveryContext, DeliveryDraft, DeliveryFileContent, DeliveryList, DeliveryReferenceFacts, DeliveryRevision, DeliveryRevisionAction, DeliverySourceUpload } from '../../app/lib/delivery-record/contract'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { BusinessSession } from './business-session'
import { createHash, randomUUID } from 'node:crypto'
import { DELIVERY_READ_CAPABILITY, DELIVERY_WRITE_CAPABILITY, deliveryProblem } from '../../app/lib/delivery-record/contract'
import { normalizeDeliveryDraft } from '../../app/lib/delivery-record/domain'
import { deliveryNaturalKey } from '../../app/lib/delivery/review'
import { resolveBusinessSession } from './business-session'
import { assertRetainedMigrationReferences } from './core-identity-migration'
import { readDeliveryAsset, validateDeliverySource } from './delivery-assets'
import { prepareDeliveryMigration } from './delivery-migration'

export interface DeliveryState {
  records: Map<string, DeliveryCentralRecord>
  assets: Map<string, DeliveryFileContent>
  legacyOriginals: Map<string, DeliveryFileContent[]>
  revisions: Map<string, DeliveryRevision[]>
  commands: Map<string, { fingerprint: string, result: DeliveryCommandResult }>
  version: number
}
interface Options {
  references: (sessionId?: string | null) => DeliveryReferenceFacts
  createId?: () => string
  now?: () => string
  beforeCommit?: () => void
}
function emptyState(): DeliveryState {
  return { records: new Map(), assets: new Map(), legacyOriginals: new Map(), revisions: new Map(), commands: new Map(), version: 0 }
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : entry)
}
function publicRecord(record: DeliveryCentralRecord): DeliveryCentralRecord {
  return { ...structuredClone(record), legacyAudit: record.legacyAudit ? '旧审计原文已留存；无法完整核实的历史待核验' : null }
}
function publicRevision(revision: DeliveryRevision): DeliveryRevision {
  return {
    ...structuredClone(revision),
    before: revision.before ? publicRecord(revision.before) : null,
    after: publicRecord(revision.after),
    changes: revision.changes.map(change => change.field === 'legacyAudit'
      ? { field: change.field, before: change.before ? '旧审计原文已留存' : null, after: change.after ? '旧审计原文已留存' : null }
      : structuredClone(change)),
  }
}

export function createDeliveryCommandService(options: Options) {
  const states = new Map<string, DeliveryState>()
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (session: BusinessSession, sessionId?: string | null) => JSON.stringify([session.workspaceId, sessionId || 'default'])
  function stateFor(session: BusinessSession, sessionId?: string | null) {
    const key = keyFor(session, sessionId)
    const state = states.get(key) ?? emptyState()
    states.set(key, state)
    return state
  }
  function authorize(session: BusinessSession, capability: string) {
    if (!session.capabilities.includes(capability))
      throw deliveryProblem('forbidden', '无送货记录或关联资料操作权限')
  }
  function relations(record: Pick<DeliveryCentralRecord, 'projectId' | 'supplierId' | 'dataOrigin'>, session: BusinessSession, sessionId?: string | null) {
    authorize(session, 'project:list:read')
    if (record.supplierId)
      authorize(session, 'supplier:list:read')
    const facts = options.references(sessionId)
    const project = facts.projects.find(row => row.id === record.projectId && row.dataOrigin === record.dataOrigin)
    const supplier = record.supplierId ? facts.suppliers.find(row => row.id === record.supplierId && row.dataOrigin === record.dataOrigin) : null
    if (!project || (record.supplierId && !supplier))
      throw deliveryProblem('forbidden', '送货归属已失效或来源不匹配，请重新对账')
    return { projectName: project.name, supplierName: supplier?.name ?? '' }
  }
  function getRecord(state: DeliveryState, id: string, session: BusinessSession, sessionId?: string | null, includeDeleted = false) {
    authorize(session, DELIVERY_READ_CAPABILITY)
    const record = state.records.get(id)
    if (!record || (!includeDeleted && record.deletedAt))
      throw deliveryProblem('not-found', '送货记录不存在或已删除')
    return { ...structuredClone(record), ...relations(record, session, sessionId) }
  }
  function appendRevision(state: DeliveryState, before: DeliveryCentralRecord | null, record: DeliveryCentralRecord, action: DeliveryRevisionAction, reason: string, session: BusinessSession): DeliveryRevision {
    const ignored = new Set(['version', 'updatedAt', 'updatedBy', 'projectName', 'supplierName'])
    const changes = Object.keys(record).filter(field => !ignored.has(field) && JSON.stringify(before?.[field as keyof DeliveryCentralRecord]) !== JSON.stringify(record[field as keyof DeliveryCentralRecord])).map(field => ({ field, before: before?.[field as keyof DeliveryCentralRecord] ?? null, after: record[field as keyof DeliveryCentralRecord] }))
    const revision: DeliveryRevision = { id: createId(), recordId: record.id, version: record.version, action, reason, actorId: session.actorId, createdAt: record.updatedAt, before: structuredClone(before), after: structuredClone(record), changes }
    state.revisions.set(record.id, [...state.revisions.get(record.id) ?? [], revision])
    state.records.set(record.id, record)
    return revision
  }
  function saveAsset(state: DeliveryState, source: DeliverySourceUpload, uploadBatchId: string, session: BusinessSession, timestamp: string) {
    const verified = validateDeliverySource(source)
    const existing = [...state.assets.values()].find(asset => asset.uploadBatchId === uploadBatchId)
    if (existing) {
      if (existing.sha256 !== verified.sha256 || existing.mimeType !== source.mimeType)
        throw deliveryProblem('conflict', '同一上传批次原件冲突，请保留独立原件')
      return existing
    }
    const asset: DeliveryFileContent = { ...source, id: createId(), uploadBatchId, sha256: verified.sha256, createdAt: timestamp, createdBy: session.actorId }
    state.assets.set(asset.id, asset)
    return asset
  }
  function applyDraft(record: DeliveryCentralRecord, draft: DeliveryDraft, session: BusinessSession, sessionId?: string | null): DeliveryCentralRecord {
    const normalized = normalizeDeliveryDraft(draft)
    const names = relations({ ...normalized, dataOrigin: record.dataOrigin }, session, sessionId)
    const usedIds = new Set<string>()
    const lines = normalized.lines.map((line, sortOrder) => {
      const existingId = line.id && record.lines.some(current => current.id === line.id) ? line.id : null
      if (line.id && !existingId)
        throw deliveryProblem('validation-failed', '材料明细身份不属于当前送货记录')
      const id = existingId ?? createId()
      if (usedIds.has(id))
        throw deliveryProblem('validation-failed', '材料明细身份重复')
      usedIds.add(id)
      return { ...line, id, deliveryRecordId: record.id, sortOrder, amount: line.amount ?? null, amountSource: line.amountSource!, currentValueConfirmed: true }
    })
    return { ...record, ...normalized, ...names, rawSiteText: record.version === '0' ? normalized.rawSiteText : record.rawSiteText, ocrStatus: 'reviewed', reviewStatus: 'reviewed', currentValuesConfirmed: true, lines, totalAmount: Math.round((lines.reduce((sum, line) => sum + (line.amount ?? 0), 0) + Number.EPSILON) * 100) / 100 }
  }
  function assertNaturalKey(state: DeliveryState, record: DeliveryCentralRecord) {
    const key = deliveryNaturalKey(record)
    if (key && [...state.records.values()].some(other => other.id !== record.id && !other.deletedAt && other.dataOrigin === record.dataOrigin && deliveryNaturalKey(other) === key))
      throw deliveryProblem('conflict', '送货单自然键重复，不能重复归档')
  }

  const service = {
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[], sessionId?: string | null) {
      const session = resolveBusinessSession()
      assertRetainedMigrationReferences(removed, 'delivery_records', [...stateFor(session, sessionId).records.values()].map(row => ({ id: row.id, references: [{ type: 'projects', id: row.projectId }, { type: 'suppliers', id: row.supplierId }] })), message => deliveryProblem('conflict', message))
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const session = resolveBusinessSession()
      const prepared = prepareDeliveryMigration(stateFor(session, sessionId), snapshot)
      return () => {
        if (prepared.changed)
          states.set(keyFor(session, sessionId), prepared.state)
      }
    },
    reset(session: BusinessSession, sessionId?: string | null) { states.delete(keyFor(session, sessionId)) },
    context(session: BusinessSession, sessionId?: string | null): DeliveryContext {
      authorize(session, DELIVERY_READ_CAPABILITY)
      const facts = options.references(sessionId)
      return { workspaceId: session.workspaceId, actorId: session.actorId, capabilities: [...session.capabilities], projects: session.capabilities.includes('project:list:read') ? structuredClone(facts.projects) : [], suppliers: session.capabilities.includes('supplier:list:read') ? structuredClone(facts.suppliers) : [] }
    },
    list(session: BusinessSession, sessionId?: string | null, origin?: 'real' | 'demo'): DeliveryList {
      authorize(session, DELIVERY_READ_CAPABILITY)
      const state = stateFor(session, sessionId)
      const records = [...state.records.values()]
        .filter(record => !record.deletedAt && (!origin || record.dataOrigin === origin))
        .map(record => publicRecord(getRecord(state, record.id, session, sessionId)))
        .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || b.createdAt.localeCompare(a.createdAt))
      return { records, sourceVersion: `delivery-${state.version}`, capabilities: [...session.capabilities] }
    },
    detail(id: string, session: BusinessSession, sessionId?: string | null) { return publicRecord(getRecord(stateFor(session, sessionId), id, session, sessionId)) },
    history(id: string, session: BusinessSession, sessionId?: string | null): DeliveryRevision[] {
      const state = stateFor(session, sessionId)
      getRecord(state, id, session, sessionId)
      const revisions = state.revisions.get(id) ?? []
      for (const revision of revisions) {
        relations(revision.after, session, sessionId)
        if (revision.before)
          relations(revision.before, session, sessionId)
      }
      return revisions.map(publicRevision)
    },
    version(id: string, version: string, session: BusinessSession, sessionId?: string | null) {
      const revision = service.history(id, session, sessionId).find(revision => revision.version === version)
      if (!revision)
        throw deliveryProblem('not-found', '送货历史版本不存在')
      return revision.after
    },
    fileContent(id: string, assetId: string, session: BusinessSession, sessionId?: string | null): DeliveryFileContent {
      const state = stateFor(session, sessionId)
      getRecord(state, id, session, sessionId)
      const owningRevision = (state.revisions.get(id) ?? []).find(revision => revision.after.assetId === assetId)
      const asset = state.assets.get(assetId)
      if (!owningRevision || !asset)
        throw deliveryProblem('not-found', '该送货记录的原件不存在')
      relations(owningRevision.after, session, sessionId)
      return readDeliveryAsset(asset)
    },
    execute(command: DeliveryCommand, session: BusinessSession, sessionId?: string | null): DeliveryCommandResult {
      authorize(session, DELIVERY_WRITE_CAPABILITY)
      authorize(session, DELIVERY_READ_CAPABILITY)
      if (command.origin !== 'real' || command.workspaceId !== session.workspaceId || command.actorId !== session.actorId || command.requiredCapability !== DELIVERY_WRITE_CAPABILITY)
        throw deliveryProblem('forbidden', '送货命令的来源或会话身份无效')
      if (!command.commandId?.trim())
        throw deliveryProblem('validation-failed', '送货命令编号无效')
      const current = stateFor(session, sessionId)
      const fingerprint = createHash('sha256').update(canonical(command)).digest('hex')
      const previous = current.commands.get(command.commandId)
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw deliveryProblem('conflict', '同一命令编号不能提交不同内容')
        if (command.action === 'print') {
          for (const target of command.targets)
            getRecord(current, target.id, session, sessionId)
        }
        else {
          getRecord(current, previous.result.id, session, sessionId, true)
        }
        return structuredClone(previous.result)
      }
      const state = structuredClone(current)
      const timestamp = now()
      let result: DeliveryCommandResult | null = null
      const finish = (before: DeliveryCentralRecord | null, record: DeliveryCentralRecord, action: DeliveryRevisionAction, reason: string) => {
        const next = { ...record, version: String(Number(before?.version ?? 0) + 1), updatedAt: timestamp, updatedBy: session.actorId }
        const revision = appendRevision(state, before, next, action, reason, session)
        result = { id: next.id, version: next.version, commandId: command.commandId, revisionId: revision.id, updatedAt: timestamp }
      }
      if (command.action === 'archive') {
        if (command.baseVersion !== null)
          throw deliveryProblem('conflict', '新归档不能带旧版本')
        const id = createId()
        const uploadBatchId = command.uploadBatchId?.trim() || createId()
        const asset = command.source ? saveAsset(state, command.source, uploadBatchId, session, timestamp) : null
        const blank: DeliveryCentralRecord = { id, dataOrigin: 'real', version: '0', uploadBatchId, assetId: asset?.id ?? null, projectId: '', supplierId: null, projectName: '', supplierName: '', orderNo: '', deliveryDate: '', note: '', rawSiteText: '', reviewFlag: '', lines: [], fileName: asset?.fileName ?? '', filePath: '', hasSourceFile: !!asset, ocrStatus: 'reviewed', reviewStatus: 'reviewed', currentValuesConfirmed: true, naturalKeyDuplicate: false, archived: true, stored: true, printBatchId: uploadBatchId, printDisposition: 'pending', printedAt: '', printExcludedAt: '', totalAmount: 0, createdAt: timestamp, updatedAt: timestamp, createdBy: session.actorId, updatedBy: session.actorId, deletedAt: null, migrationBatchId: null, legacyAudit: null }
        const record = applyDraft(blank, command.draft, session, sessionId)
        assertNaturalKey(state, record)
        finish(null, record, 'archive', '人工确认归档')
      }
      else if (command.action === 'print') {
        if (!command.targets.length || !['printed', 'excluded'].includes(command.disposition))
          throw deliveryProblem('validation-failed', '打印处置无效')
        const seen = new Set<string>()
        for (const target of command.targets) {
          if (seen.has(target.id))
            throw deliveryProblem('validation-failed', '打印记录重复')
          seen.add(target.id)
          const record = getRecord(state, target.id, session, sessionId)
          if (record.version !== target.baseVersion)
            throw deliveryProblem('conflict', '送货记录已更新，请重新读取')
          if (record.printDisposition !== 'pending')
            throw deliveryProblem('conflict', '整批记录必须仍处于待打印状态，请重新读取')
          finish(record, { ...record, printDisposition: command.disposition, printedAt: command.disposition === 'printed' ? timestamp : '', printExcludedAt: command.disposition === 'excluded' ? timestamp : '' }, 'print', command.disposition === 'printed' ? '人工确认打印回执' : '人工排除待打印')
        }
      }
      else {
        const record = getRecord(state, command.id, session, sessionId, command.action === 'restore' || command.action === 'undo')
        if (record.version !== command.baseVersion)
          throw deliveryProblem('conflict', '送货记录已更新，请重新读取')
        if (!command.reason?.trim())
          throw deliveryProblem('validation-failed', '请填写本次修订原因')
        if (command.action === 'revise') {
          const next = applyDraft(record, command.draft, session, sessionId)
          assertNaturalKey(state, next)
          finish(record, next, 'revise', command.reason.trim())
        }
        else if (command.action === 'source') {
          const asset = saveAsset(state, command.source, createId(), session, timestamp)
          finish(record, { ...record, assetId: asset.id, fileName: asset.fileName, hasSourceFile: true, printBatchId: asset.uploadBatchId }, 'source', command.reason.trim())
        }
        else if (command.action === 'delete' || command.action === 'restore') {
          const next = { ...record, deletedAt: command.action === 'delete' ? timestamp : null }
          if (command.action === 'restore')
            assertNaturalKey(state, next)
          finish(record, next, command.action, command.reason.trim())
        }
        else if (command.action === 'undo') {
          const previous = (state.revisions.get(record.id) ?? []).find(revision => revision.id === command.revisionId)
          if (!previous?.before || previous.version !== record.version)
            throw deliveryProblem('conflict', '记录已发生其他修订，不能撤回旧操作')
          relations(previous.before, session, sessionId)
          assertNaturalKey(state, previous.before)
          finish(record, { ...previous.before }, 'undo', command.reason.trim())
        }
        else {
          throw deliveryProblem('validation-failed', '送货动作无效')
        }
      }
      if (!result)
        throw deliveryProblem('validation-failed', '送货动作没有可保存的记录')
      state.commands.set(command.commandId, { fingerprint, result })
      state.version++
      options.beforeCommit?.()
      states.set(keyFor(session, sessionId), state)
      return structuredClone(result)
    },
  }
  return service
}
