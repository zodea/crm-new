import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { InvoiceLegacyMappings } from './production-invoice-migration-mapping'
import type { ProductionStorage } from './production-storage'
import { createHash, randomUUID } from 'node:crypto'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { financeCanonical } from './production-finance-request'
import { validateLegacyInvoiceMappings } from './production-invoice-migration-mapping'
import { verifyLegacyInvoiceOriginal } from './production-invoice-migration-original'
import { prepareLegacyInvoicePlan, validateLegacyInvoiceEntry } from './production-invoice-migration-plan'
import { readLegacyInvoiceSource } from './production-invoice-migration-source'
import { readProductionInvoiceFact, validateProductionInvoiceJournal } from './production-invoice-service'
import { createReadMeta, withReadMeta } from './read-meta'

type Row = Record<string, unknown>
type Session = () => BusinessSession
interface PublishRequest { commandId: string, workspaceId: string, actorId: string, source: { sha256: string, payloadBase64: string }, mappings: InvoiceLegacyMappings, confirmed: true }
export interface LegacyInvoiceBatchResult { commandId: string, batchId: string, sourceSha256: string, invoiceIds: string[], createdAt: string, retired?: true }
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const digest = (value: unknown) => createHash('sha256').update(financeCanonical(value)).digest('hex')
function fail(message: string): never {
  throw new CentralInvoiceProblem('validation-failed', `旧发票迁入：${message}；完整原库保持不变。`)
}
function conflict(message: string): never {
  throw new CentralInvoiceProblem('conflict', message)
}
const sessionKey = (actor: BusinessSession) => JSON.stringify({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities].sort() })

function parseRequest(value: unknown): PublishRequest {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'actorId,commandId,confirmed,mappings,source,workspaceId'
    || !['actorId', 'commandId', 'workspaceId'].every(key => typeof value[key] === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(String(value[key])))
    || value.confirmed !== true || !object(value.source) || !object(value.mappings)) {
    return fail('命令身份、完整来源、映射或确认无效')
  }
  return value as unknown as PublishRequest
}
/** 仅接受同一事务已核验的实际 PDF/PNG/JPEG 原件；全部旧原始字段仍保存在不可变证据中。 */
async function installOriginal(tx: TransactionDb, invoiceId: string, files: ReturnType<typeof prepareLegacyInvoicePlan>['entries'][number]['sourceFiles'], actor: BusinessSession, now: string): Promise<string | null> {
  const file = await verifyLegacyInvoiceOriginal(tx, files)
  if (!file)
    return null
  await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,\'invoice\',?,?,?,?,\'invoice-original\',?,?)', [file.id, invoiceId, file.name, file.bytes.length, file.mime, actor.actorId, now])
  await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [file.id, file.bytes, file.sha256])
  return file.id
}

export function createProductionInvoiceMigration(storage: ProductionStorage) {
  function authorize(session: Session) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('finance-invoice:read') || !actor.capabilities.includes('finance-invoice:write') || !actor.capabilities.includes('finance-invoice:import'))
      throw new CentralInvoiceProblem('forbidden', '当前身份无发票迁入权限。')
    return actor
  }
  async function state(session: Session) {
    const initial = authorize(session)
    return storage.withTransaction(async (tx) => {
      const actor = authorize(session)
      if (sessionKey(actor) !== sessionKey(initial))
        throw new CentralInvoiceProblem('forbidden', '读取迁入批次期间身份或权限已变化。')
      await validateProductionInvoiceJournal(tx, storage.identity)
      const [revision] = await tx.select<{ revision: number }>('SELECT revision FROM invoice_revision WHERE singleton=1')
      if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision < 0)
        throw new CentralInvoiceProblem('unavailable', '发票来源版本无法核实。')
      const rows = await tx.select<{ result_json: string, retired_at: string | null }>(`SELECT b.result_json,r.retired_at FROM invoice_legacy_batches b LEFT JOIN invoice_legacy_retirements r ON r.batch_id=b.id ORDER BY b.created_at,b.id`)
      const batches = rows.map(row => ({ ...JSON.parse(row.result_json) as LegacyInvoiceBatchResult, retiredAt: row.retired_at }))
      if (sessionKey(authorize(session)) !== sessionKey(initial))
        throw new CentralInvoiceProblem('forbidden', '读取迁入批次期间身份或权限已变化。')
      const asOf = new Date().toISOString()
      const meta = createReadMeta({ session: actor, schemaVersion: 'invoice-read-v1', operation: 'invoice:legacy-migration-state', dataOrigin: 'real', asOf, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${revision.revision}`, asOf }], coverage: 'complete', scope: {} })
      return withReadMeta({ dataOrigin: 'real' as const, batches }, meta)
    })
  }
  async function publish(value: unknown, session: Session): Promise<LegacyInvoiceBatchResult> {
    const request = parseRequest(value)
    const initial = authorize(session)
    if (request.workspaceId !== initial.workspaceId || request.actorId !== initial.actorId)
      throw new CentralInvoiceProblem('forbidden', '迁入命令与当前身份不一致。')
    storage.assertBusinessWrite()
    return withVerifiedMigrationSnapshot(request.source, async (native, evidence) => {
      const source = await readLegacyInvoiceSource(native, evidence, { inspectCompany: true })
      return storage.withTransaction(async (tx) => {
        const actor = authorize(session)
        if (sessionKey(actor) !== sessionKey(initial))
          throw new CentralInvoiceProblem('forbidden', '迁入期间身份或权限已变化。')
        await validateProductionInvoiceJournal(tx, storage.identity)
        const fingerprint = digest({ ...request, source: { sha256: source.sha256 } })
        const [old] = await tx.select<{ workspace_id: string, actor_id: string, action: string, fingerprint: string, result_json: string }>('SELECT workspace_id,actor_id,action,fingerprint,result_json FROM invoice_legacy_commands WHERE command_id=?', [request.commandId])
        if (old) {
          if (old.workspace_id !== actor.workspaceId || old.actor_id !== actor.actorId)
            throw new CentralInvoiceProblem('forbidden', '原迁入回执不属于当前身份。')
          if (old.action !== 'publish' || old.fingerprint !== fingerprint)
            return conflict('旧发票原命令编号不能改用其他来源或映射。')
          if (sessionKey(authorize(session)) !== sessionKey(initial))
            throw new CentralInvoiceProblem('forbidden', '迁入核对期间身份或权限已变化。')
          return JSON.parse(old.result_json) as LegacyInvoiceBatchResult
        }
        if ((await tx.select('SELECT command_id FROM invoice_legacy_resolutions WHERE command_id=?', [request.commandId])).length)
          return conflict('原迁入编号已封存，迟到请求不能写入。')
        if ((await tx.select('SELECT id FROM invoice_legacy_batches WHERE source_sha256=?', [source.sha256])).length)
          return conflict('此旧库已经迁入，不能再次覆盖或改变映射。')
        const mapping = await validateLegacyInvoiceMappings(tx, actor, source, request.mappings)
        const plan = prepareLegacyInvoicePlan(source, mapping)
        if (!plan.entries.length)
          return fail('旧库没有可迁入的发票')
        const now = new Date().toISOString()
        const batchId = randomUUID()
        const result: LegacyInvoiceBatchResult = { commandId: request.commandId, batchId, sourceSha256: source.sha256, invoiceIds: plan.entries.map(entry => entry.id), createdAt: now }
        const batchEvidence = { sourceSha256: plan.sourceSha256, sourceSchemaVersion: plan.sourceSchemaVersion, sourceSchema: plan.sourceSchema, sourceReferences: plan.sourceReferences, sourceApplications: plan.sourceApplications, orphanLogs: plan.orphanLogs, mappings: request.mappings, invoiceIds: result.invoiceIds }
        await tx.execute('INSERT INTO invoice_legacy_batches VALUES(?,?,?,?,?,?,?,?,?)', [batchId, source.sha256, actor.workspaceId, actor.actorId, fingerprint, JSON.stringify(batchEvidence), digest(batchEvidence), JSON.stringify(result), now])
        for (const entry of plan.entries) {
          const head = entry.sourceHead
          const { item, fields, ownerKind, archivedAt, deletedAt } = validateLegacyInvoiceEntry(entry)
          const originalId = await installOriginal(tx, entry.id, entry.sourceFiles, actor, now)
          await tx.execute(`INSERT INTO invoices(id,source_kind,invoice_number,invoice_date,invoice_type,buyer,buyer_tax_no,seller,seller_tax_no,amount,tax_amount,total_amount,tax_rate,remark,items_json,ocr_status,completion_method,review_status,account_status,dup_status,print_count,print_rotation,owner_kind,project_id,supplier_id,archived_at,contract_domain,contract_id,contract_version,legacy_source,legacy_original_state,legacy_ambiguous_json,legacy_items_ambiguous,original_file_id,version,created_at,updated_at,deleted_at)
            VALUES(?,'legacy',?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`, [entry.id, fields.invoiceNumber, fields.invoiceDate, fields.invoiceType, fields.buyer, fields.buyerTaxNo, fields.seller, fields.sellerTaxNo, fields.amount, fields.taxAmount, fields.totalAmount, fields.taxRate, fields.remark, JSON.stringify(item.values), head.review_status === 'reviewed' ? 'legacy' : null, head.review_status, head.account_status, head.dup_status, head.print_count, head.print_rotation, ownerKind, entry.projectId, entry.supplierId, archivedAt, entry.contract?.domain ?? null, entry.contract?.id ?? null, entry.contract?.version ?? null, head.source, entry.originalState, JSON.stringify(entry.ambiguousZeroFields), item.ambiguous ? 1 : 0, originalId, now, now, deletedAt])
          const genesis = randomUUID()
          const receipt = { invoiceId: entry.id, commandId: genesis, version: '1', updatedAt: now, originalId }
          const memberEvidence = { batchId, sourceSha256: source.sha256, entry, genesisCommandId: genesis }
          const memberDigest = digest(memberEvidence)
          await tx.execute('INSERT INTO invoice_command_receipts VALUES(?,?,?,?,?,?,?,?)', [genesis, actor.workspaceId, actor.actorId, entry.id, 'legacy-adopt', memberDigest, JSON.stringify(receipt), now])
          const after = await readProductionInvoiceFact(tx, entry.id)
          await tx.execute('INSERT INTO invoice_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), entry.id, genesis, actor.actorId, 'legacy-adopt', null, JSON.stringify(after), now])
          await tx.execute('INSERT INTO invoice_legacy_members VALUES(?,?,?,?,?)', [batchId, entry.id, genesis, JSON.stringify(memberEvidence), memberDigest])
          await tx.execute('UPDATE invoice_revision SET revision=revision+1 WHERE singleton=1')
        }
        await tx.execute('INSERT INTO invoice_legacy_commands VALUES(?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, 'publish', fingerprint, JSON.stringify(result), now])
        await validateProductionInvoiceJournal(tx, storage.identity)
        if (sessionKey(authorize(session)) !== sessionKey(initial))
          throw new CentralInvoiceProblem('forbidden', '迁入期间身份或权限已变化，整批已撤回。')
        return result
      })
    })
  }
  async function resolve(value: unknown, session: Session) {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'actorId,commandId,workspaceId'
      || !['actorId', 'commandId', 'workspaceId'].every(key => typeof value[key] === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(String(value[key])))) {
      return fail('原迁入核对身份或编号无效')
    }
    const initial = authorize(session)
    if (value.workspaceId !== initial.workspaceId || value.actorId !== initial.actorId)
      throw new CentralInvoiceProblem('forbidden', '原迁入核对与当前身份不一致。')
    storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      if (sessionKey(authorize(session)) !== sessionKey(initial))
        throw new CentralInvoiceProblem('forbidden', '原迁入核对期间身份或权限已变化。')
      await validateProductionInvoiceJournal(tx, storage.identity)
      const [prior] = await tx.select<{ workspace_id: string, actor_id: string, result_json: string }>('SELECT workspace_id,actor_id,result_json FROM invoice_legacy_commands WHERE command_id=?', [value.commandId])
      if (prior) {
        if (prior.workspace_id !== initial.workspaceId || prior.actor_id !== initial.actorId)
          throw new CentralInvoiceProblem('forbidden', '原迁入回执不属于当前身份。')
        if (sessionKey(authorize(session)) !== sessionKey(initial))
          throw new CentralInvoiceProblem('forbidden', '原迁入核对期间身份或权限已变化。')
        return { outcome: 'applied' as const, result: JSON.parse(prior.result_json) as LegacyInvoiceBatchResult }
      }
      const [sealed] = await tx.select<{ workspace_id: string, actor_id: string }>('SELECT workspace_id,actor_id FROM invoice_legacy_resolutions WHERE command_id=?', [value.commandId])
      if (sealed && (sealed.workspace_id !== initial.workspaceId || sealed.actor_id !== initial.actorId))
        throw new CentralInvoiceProblem('forbidden', '原迁入核对不属于当前身份。')
      if (!sealed)
        await tx.execute('INSERT INTO invoice_legacy_resolutions VALUES(?,?,?,?)', [value.commandId, initial.workspaceId, initial.actorId, new Date().toISOString()])
      if (sessionKey(authorize(session)) !== sessionKey(initial))
        throw new CentralInvoiceProblem('forbidden', '原迁入核对期间身份或权限已变化。')
      return { outcome: 'not-applied' as const, commandId: value.commandId }
    })
  }
  async function retire(value: unknown, session: Session): Promise<LegacyInvoiceBatchResult> {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'actorId,batchId,commandId,confirmed,workspaceId' || value.confirmed !== true
      || !['actorId', 'batchId', 'commandId', 'workspaceId'].every(key => typeof value[key] === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(String(value[key])))) {
      return fail('恢复批次身份、编号或确认无效')
    }
    const initial = authorize(session)
    if (value.workspaceId !== initial.workspaceId || value.actorId !== initial.actorId)
      throw new CentralInvoiceProblem('forbidden', '恢复批次与当前身份不一致。')
    storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const actor = authorize(session)
      if (sessionKey(actor) !== sessionKey(initial))
        throw new CentralInvoiceProblem('forbidden', '恢复期间身份或权限已变化。')
      const fingerprint = digest(value)
      const [old] = await tx.select<Row>('SELECT * FROM invoice_legacy_commands WHERE command_id=?', [value.commandId])
      if (old) {
        if (old.workspace_id !== actor.workspaceId || old.actor_id !== actor.actorId)
          throw new CentralInvoiceProblem('forbidden', '原恢复回执不属于当前身份。')
        if (old.action !== 'retire' || old.fingerprint !== fingerprint)
          return conflict('恢复原命令编号不能用于其他内容。')
        if (sessionKey(authorize(session)) !== sessionKey(initial))
          throw new CentralInvoiceProblem('forbidden', '恢复核对期间身份或权限已变化。')
        return JSON.parse(String(old.result_json)) as LegacyInvoiceBatchResult
      }
      if ((await tx.select('SELECT command_id FROM invoice_legacy_resolutions WHERE command_id=?', [value.commandId])).length)
        return conflict('原恢复编号已封存，迟到请求不能写入。')
      await validateProductionInvoiceJournal(tx, storage.identity)
      const [batch] = await tx.select<Row>('SELECT * FROM invoice_legacy_batches WHERE id=?', [value.batchId])
      if (!batch || (await tx.select('SELECT batch_id FROM invoice_legacy_retirements WHERE batch_id=?', [value.batchId])).length)
        return conflict('旧发票迁入批次不存在或已经恢复。')
      const members = await tx.select<{ invoice_id: string, genesis_command_id: string }>('SELECT invoice_id,genesis_command_id FROM invoice_legacy_members WHERE batch_id=? ORDER BY invoice_id', [value.batchId])
      for (const member of members) {
        const record = await readProductionInvoiceFact(tx, member.invoice_id)
        const receipts = await tx.select<{ command_id: string }>('SELECT command_id FROM invoice_command_receipts WHERE invoice_id=?', [member.invoice_id])
        if (record.version !== '1' || receipts.length !== 1 || receipts[0]?.command_id !== member.genesis_command_id
          || (await tx.select('SELECT invoice_id FROM invoice_print_lines WHERE invoice_id=?', [member.invoice_id])).length
          || (await tx.select('SELECT id FROM payment_application_invoice_allocations WHERE invoice_id=?', [member.invoice_id])).length) {
          return conflict('迁入后发票已变更、打印或存在票款历史，危险恢复整批拒绝。')
        }
      }
      const now = new Date().toISOString()
      const result: LegacyInvoiceBatchResult = { commandId: String(value.commandId), batchId: String(value.batchId), sourceSha256: String(batch.source_sha256), invoiceIds: members.map(member => member.invoice_id), createdAt: now, retired: true }
      await tx.execute('INSERT INTO invoice_legacy_commands VALUES(?,?,?,?,?,?,?)', [value.commandId, actor.workspaceId, actor.actorId, 'retire', fingerprint, JSON.stringify(result), now])
      await tx.execute('INSERT INTO invoice_legacy_retirements VALUES(?,?,?)', [value.batchId, value.commandId, now])
      for (const member of members) {
        const before = await readProductionInvoiceFact(tx, member.invoice_id)
        const commandId = randomUUID()
        await tx.execute('UPDATE invoices SET deleted_at=COALESCE(deleted_at,?),version=version+1,updated_at=? WHERE id=?', [now, now, member.invoice_id])
        const after = await readProductionInvoiceFact(tx, member.invoice_id)
        const receipt = { invoiceId: member.invoice_id, commandId, version: after.version, updatedAt: now, originalId: after.original?.id ?? null }
        await tx.execute('INSERT INTO invoice_command_receipts VALUES(?,?,?,?,?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, member.invoice_id, 'legacy-retire', digest({ batchId: value.batchId, invoiceId: member.invoice_id, commandId, retirementCommandId: value.commandId }), JSON.stringify(receipt), now])
        await tx.execute('INSERT INTO invoice_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), member.invoice_id, commandId, actor.actorId, 'legacy-retire', JSON.stringify(before), JSON.stringify(after), now])
        await tx.execute('UPDATE invoice_revision SET revision=revision+1 WHERE singleton=1')
      }
      await validateProductionInvoiceJournal(tx, storage.identity)
      if (sessionKey(authorize(session)) !== sessionKey(initial))
        throw new CentralInvoiceProblem('forbidden', '恢复期间身份或权限已变化，整批已撤回。')
      return result
    })
  }
  return { state, publish, resolve, retire }
}
