import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralFinanceKind, FinanceCommandResult, FinanceFormData, FinanceLookupQuery, FinanceReadScope } from '../../app/lib/finance/central-contract'
import type { ExpenseReimbursementFormDraft } from '../../app/lib/finance/forms'
import type { FinanceMigrationResult } from '../../app/lib/finance/migration-contract'
import type { FinanceDomainTx } from '../../app/lib/finance/reference'
import type { FileRefChanges, FileRefRecord } from '../../app/lib/forms/file-refs'
import type { SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { ProductionFinanceReferenceOwners } from './production-finance-references'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { decodeConstructionMainSelection } from '../../app/lib/construction-scope/contract'
import { isConfirmedExpenditureSettlement } from '../../app/lib/contract/effective-status'
import { logCreate, restoreRecord, softDelete } from '../../app/lib/db/soft-delete'
import { financeFailure as fail, FINANCE_FAMILIES, FINANCE_READ_SCHEMA, FinanceRepositoryProblem, normalizeFinanceLookup } from '../../app/lib/finance/central-contract'
import { deleteFinanceFormInTransaction, expenseContractMatchesPaymentType, FINANCE_OWNER_TYPE, FINANCE_TABLE_BY_KIND, loadFinanceForm, saveFinanceFormInTransaction, unconfirmPaymentRecordInTransaction } from '../../app/lib/finance/domain'
import { FinanceAmountSourceError, hasVerifiedFinanceNumbers, verifiedFinanceSum } from '../../app/lib/finance/persistent-rows'
import { decimalNumber } from '../../app/lib/read-model/decimal'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { appendProductionConstructionScopeBinding } from './production-construction-scope-command'
import { readProductionConstructionMainOptions, readProductionConstructionScopeLink } from './production-construction-scope-record'
import { createExpenseClearanceVerification, expenseClearanceVerificationState, validateExpenseClearanceJournal } from './production-finance-clearance'
import { financeRecordSnapshot, validateFinanceJournal } from './production-finance-journal'
import { authorizeFinanceImport, importNativeFinance, previewNativeFinance, readNativeFinanceSource } from './production-finance-migration'
import { financePersistedDateTime, productionPaymentApplicationDetail } from './production-finance-payment-detail'
import { productionFinanceReferences } from './production-finance-references'
import { financeCommandFingerprint, financeId, parseFinanceCommand } from './production-finance-request'
import { createPaymentVerification, paymentVerificationCap, paymentVerificationState } from './production-finance-verification'
import { createReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
function fileRecord(row: Record<string, unknown>): FileRefRecord {
  return { id: String(row.id), ownerType: String(row.owner_type), ownerId: String(row.owner_id), fileName: String(row.file_name), filePath: String(row.file_path ?? ''), fileSize: Number(row.file_size), mimeType: String(row.mime_type), category: String(row.category ?? ''), uploader: String(row.uploader), uploadedAt: financePersistedDateTime(row.uploaded_at), deletedAt: row.deleted_at == null ? null : financePersistedDateTime(row.deleted_at) }
}
async function files(tx: TransactionDb, kind: CentralFinanceKind, id: string): Promise<Array<FileRefRecord & { sha256: string | null }>> {
  const rows = await tx.select<Record<string, unknown>>('SELECT * FROM file_refs WHERE owner_type=? AND owner_id=? ORDER BY uploaded_at,id', [FINANCE_OWNER_TYPE[kind], id])
  const verified = []
  for (const row of rows) {
    const stored = (await tx.select<{ content: Uint8Array, sha256: string }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [row.id]))[0]
    if (stored && (!(stored.content instanceof Uint8Array) || stored.content.length !== row.file_size || digest(stored.content) !== stored.sha256))
      fail('unavailable', '财务原件大小或摘要损坏，请核对备份，不能把它当成历史缺件。')
    verified.push({ ...fileRecord(row), sha256: stored?.sha256 ?? null })
  }
  return verified
}
async function applyFiles(tx: TransactionDb, kind: CentralFinanceKind, id: string, changes: FileRefChanges, actor: BusinessSession): Promise<string[]> {
  const owned = await files(tx, kind, id)
  const remove = [...new Set(changes.removeIds ?? [])]
  const restore = [...new Set(changes.restoreIds ?? [])]
  if (remove.some(file => restore.includes(file)))
    fail('validation-failed', '同一原件不能同时移除和恢复。')
  for (const file of [...remove, ...restore]) {
    if (!owned.some(row => row.id === file))
      fail('validation-failed', '原件不存在或不属于此财务记录。')
  }
  for (const file of remove) await softDelete(tx, 'file_refs', file, actor.actorId)
  for (const file of restore) await restoreRecord(tx, 'file_refs', file, actor.actorId)
  const ids: string[] = []
  for (const file of changes.add ?? []) {
    if (!file || typeof file.fileName !== 'string' || !file.fileName.trim() || typeof file.payloadBase64 !== 'string'
      || !Number.isSafeInteger(file.fileSize) || Number(file.fileSize) < 0 || Number(file.fileSize) > 10 * 1024 * 1024
      || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(file.payloadBase64)) {
      fail('validation-failed', '新财务原件必须包含完整正文、真实大小与有效名称。')
    }
    const bytes = Buffer.from(file.payloadBase64, 'base64')
    if (bytes.length !== file.fileSize || bytes.toString('base64') !== file.payloadBase64)
      fail('validation-failed', '财务原件正文与声明大小不一致。')
    const fileId = randomUUID()
    const now = new Date().toISOString()
    await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [fileId, FINANCE_OWNER_TYPE[kind], id, file.fileName.trim(), file.filePath ?? '', bytes.length, file.mimeType || 'application/octet-stream', file.category ?? '', actor.actorId, now])
    await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [fileId, bytes, digest(bytes)])
    await logCreate(tx, 'file_refs', fileId, actor.actorId)
    ids.push(fileId)
  }
  return ids
}
interface VersionRow { version: number, updated_at: string }
async function form<K extends CentralFinanceKind>(tx: FinanceDomainTx, kind: K, id: string, actor: BusinessSession): Promise<FinanceFormData<K>> {
  const raw = (await tx.select<Record<string, unknown>>(`SELECT * FROM ${FINANCE_TABLE_BY_KIND[kind]} WHERE id=?`, [id]))[0]
  if (raw) {
    if (!hasVerifiedFinanceNumbers(FINANCE_TABLE_BY_KIND[kind], raw))
      fail('unavailable', '财务持久金额损坏，不能把未知数值读取为零。')
    const relations: Partial<Record<CentralFinanceKind, [string, string, string][]>> = { reimbursement: [['expense_reimbursement_lines', 'reimbursement_id', 'amount']], payment_application: [['payment_application_settlement_allocations', 'payment_application_id', 'allocated_amount'], ['payment_application_invoice_allocations', 'payment_application_id', 'allocated_amount']], payment_record: [['payment_record_application_allocations', 'payment_record_id', 'allocated_amount']] }
    for (const [table, owner, money] of relations[kind] ?? []) {
      const lines = await tx.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${owner}=?`, [id])
      if (lines.some(line => !hasVerifiedFinanceNumbers(table, line) || typeof line[money] !== 'number' || !Number.isFinite(line[money])))
        fail('unavailable', '财务明细金额损坏，不能把未知数值读取为零。')
    }
  }
  const draft = await loadFinanceForm(kind, id, tx)
  const version = (await tx.select<VersionRow>('SELECT version,updated_at FROM finance_versions WHERE kind=? AND id=?', [kind, id]))[0]
  if (!draft)
    fail('not-found', '财务记录不存在或已删除，请从列表重新进入。')
  if (kind === 'reimbursement') {
    const expense = draft as ExpenseReimbursementFormDraft
    const mains = new Map<string, NonNullable<ExpenseReimbursementFormDraft['constructionMain']>>()
    for (const line of expense.lines ?? []) {
      if (!line.id || line.originalExpenseLineId)
        continue
      const relation = await readProductionConstructionScopeLink(tx, { domain: 'original-expense', id: line.id })
      if (relation?.mainId && relation.mainBasis) {
        line.constructionMain = { id: relation.mainId, projectId: relation.projectId, basis: relation.mainBasis }
        line.constructionScopeVersion = relation.version
        mains.set(relation.mainId, line.constructionMain)
      }
    }
    if (mains.size === 1) {
      expense.constructionMain = [...mains.values()][0]
    }
    else if (!(expense.lines ?? []).length && version) {
      // A zero-only draft has no original expense row to bind. Its explicit
      // engineering choice remains in the actual original source command.
      const original = (await tx.select<{ request_json: string, result_json: string, fingerprint: string }>(`SELECT c.request_json,c.result_json,c.fingerprint FROM finance_history h JOIN finance_commands c ON c.command_id=h.command_id
        WHERE h.kind='reimbursement' AND h.id=? AND h.version=? AND c.workspace_id=? AND c.actor_id=?`, [id, version.version, actor.workspaceId, actor.actorId]))[0]
      if (original) {
        const request = parseFinanceCommand(JSON.parse(original.request_json))
        const result = commandResult(original.result_json, request.commandId, 'reimbursement', id)
        if (request.kind !== 'reimbursement' || result.version !== String(version.version) || financeCommandFingerprint(request) !== original.fingerprint)
          fail('unavailable', '原费用工程选择与同次冻结提交不一致，请核对备份。')
        if ('constructionMain' in request.draft && request.draft.constructionMain) {
          const main = decodeConstructionMainSelection(request.draft.constructionMain)
          if (main.projectId !== expense.projectId)
            fail('unavailable', '原费用工程选择与冻结实际项目不一致。')
          expense.constructionMain = main
        }
      }
    }
  }
  if (!version || !Number.isSafeInteger(version.version) || version.version < 1 || !Number.isFinite(Date.parse(version.updated_at)))
    fail('unavailable', '财务稳定版本依据缺失，不能继续编辑。')
  if (kind === 'payment_application')
    Object.assign(draft, { paymentVerification: await paymentVerificationState(tx, actor, id) })
  if (kind === 'reimbursement')
    Object.assign(draft, { clearanceVerification: await expenseClearanceVerificationState(tx, actor, id) })
  return { draft, version: String(version.version), updatedAt: version.updated_at, attachments: await files(tx, kind, id) }
}
function commandResult(value: string, commandId: string, kind: CentralFinanceKind, target: string | undefined): FinanceCommandResult {
  try {
    const result = JSON.parse(value) as FinanceCommandResult
    if (result.commandId !== commandId || !result.id || (target && result.id !== target) || !/^[1-9]\d*$/.test(result.version)
      || !Number.isFinite(Date.parse(result.updatedAt)) || !Array.isArray(result.attachmentIds) || new Set(result.attachmentIds).size !== result.attachmentIds.length) {
      throw new Error('invalid receipt')
    }
    return result
  }
  catch { return fail('unavailable', `${FINANCE_FAMILIES[kind]} 原回执损坏，不能换号重写。`) }
}
interface CommandRow { workspace_id: string, actor_id: string, kind: CentralFinanceKind, fingerprint: string, request_json: string, result_json: string | null }

const referenceSources = [
  ['projects', 'project', 'project:list:read', 'project_revision'],
  ['customers', 'customer', 'customer:list:read', 'customer_revision'],
  ['suppliers', 'supplier', 'supplier:list:read', 'supplier_revision'],
  ['workers', 'crew-worker', 'worker:list:read', 'crew_worker_revision'],
  ['material-contracts', 'material-contracts', 'material-contract:read', 'material_contract_revision'],
  ['construction-contracts', 'construction-contracts', 'construction-contract:read', 'construction_contract_revision'],
  ['subcontract-contracts', 'subcontract-contracts', 'subcontract-contract:read', 'subcontract_contract_revision'],
  ['auxiliary-contracts', 'auxiliary-contract', 'auxiliary-contract:read', 'auxiliary_contract_revision'],
  ['expenditure-settlements', 'other-settlements', 'other-settlement:read', 'other_settlement_revision'],
  ['invoices', 'invoices', 'finance-invoice:read', 'invoice_revision'],
] as const
async function envelope<T extends object>(tx: TransactionDb, actor: BusinessSession, scope: FinanceReadScope, value: T) {
  const asOf = new Date().toISOString()
  const finance = (await tx.select<{ revision: number }>('SELECT revision FROM finance_revision WHERE singleton=1'))[0]
  if (!finance || !Number.isSafeInteger(finance.revision) || finance.revision < 0)
    fail('unavailable', '财务来源版本缺失。')
  const participants = await tx.select<{ domain: string, schema_version: number }>('SELECT * FROM production_participants')
  const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')
  const sources: SourceEvidenceDTO[] = [{ key: 'finance', state: 'readable', sourceVersion: `finance-${finance.revision}`, asOf }]
  for (const [key, domain, capability, table] of referenceSources) {
    let state: SourceEvidenceDTO['state'] = actor.capabilities.includes(capability) ? 'unavailable' : 'forbidden'
    let sourceVersion: string | null = null
    if (state !== 'forbidden' && participants.some(row => row.domain === domain && row.schema_version === 1) && tables.some(row => row.name === table)) {
      const revision = (await tx.select<{ revision: number }>(`SELECT revision FROM ${table} WHERE singleton=1`))[0]
      if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision < 0)
        fail('unavailable', '财务关联来源版本损坏，不能继续使用旧结果。')
      state = 'readable'
      sourceVersion = `${key}-${revision.revision}`
    }
    sources.push({ key, state, sourceVersion, asOf: state === 'readable' ? asOf : null })
  }
  const meta = createReadMeta({ session: actor, schemaVersion: FINANCE_READ_SCHEMA, operation: `finance:${scope.operation}`, dataOrigin: 'real', asOf, sources, coverage: 'complete', scope })
  return withReadMeta({ ...value, workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real' as const, scope }, meta)
}

export function createProductionFinanceService(storage: ProductionStorage, options: { references?: (tx: TransactionDb, actor: BusinessSession) => ProductionFinanceReferenceOwners } = {}) {
  function authorize(session: Session, kind: CentralFinanceKind, write: boolean) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId
      || !actor.capabilities.includes(`${FINANCE_FAMILIES[kind]}:read`) || (write && !actor.capabilities.includes(`${FINANCE_FAMILIES[kind]}:write`))) {
      fail('forbidden', '当前身份无此工作区财务操作权限。')
    }
    return actor
  }
  async function run<T>(kind: CentralFinanceKind, session: Session, write: boolean, work: (tx: FinanceDomainTx, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session, kind, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (base) => {
      authorize(session, kind, write)
      const tx: FinanceDomainTx = { ...base, references: productionFinanceReferences(base, actor, options.references?.(base, actor)) }
      tx.paymentVerification = { confirmationCap: id => paymentVerificationCap(tx, actor, id) }
      let result: T
      try {
        result = await work(tx, actor)
      }
      catch (cause) {
        if (cause instanceof FinanceAmountSourceError)
          fail('unavailable', cause.message)
        throw cause
      }
      if (!isDeepStrictEqual(authorize(session, kind, write), actor))
        fail('forbidden', '财务操作期间身份或权限改变，整个事务已撤回。')
      return result
    })
  }
  async function execute(body: unknown, session: Session) {
    const request = parseFinanceCommand(body)
    const completed = await run(request.kind, session, true, async (tx, actor) => {
      if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
        fail('forbidden', '财务命令不能覆盖当前已认证身份。')
      const fingerprint = financeCommandFingerprint(request)
      const sealed = (await tx.select<{ command_id: string }>('SELECT command_id FROM finance_resolutions WHERE command_id=?', [request.commandId]))[0]
      if (sealed)
        fail('conflict', '原财务提交已核对为未保存并封存，迟到请求不能重新写入。')
      const prior = (await tx.select<CommandRow>('SELECT * FROM finance_commands WHERE command_id=?', [request.commandId]))[0]
      if (prior && (prior.fingerprint !== fingerprint || prior.workspace_id !== actor.workspaceId || prior.actor_id !== actor.actorId || prior.kind !== request.kind))
        fail('conflict', '同一财务原命令编号不能改换正文、目标或身份。')
      if (prior?.result_json)
        return { result: commandResult(prior.result_json, request.commandId, request.kind, request.id) }
      if (!prior)
        await tx.execute('INSERT INTO finance_commands VALUES(?,?,?,?,?,?,NULL)', [request.commandId, actor.workspaceId, actor.actorId, request.kind, fingerprint, JSON.stringify(request)])
      await tx.execute('SAVEPOINT finance_operation')
      try {
        const version = request.id ? (await tx.select<VersionRow>('SELECT * FROM finance_versions WHERE kind=? AND id=?', [request.kind, request.id]))[0] : null
        if ((request.id && (!version || request.baseVersion !== String(version.version))) || (!request.id && request.baseVersion !== null))
          fail('conflict', '财务记录已更新或编辑版本缺失，请保留输入并读取最新版本。')
        const beforeLog = (await tx.select<{ sequence: number }>('SELECT COALESCE(MAX(rowid),0) AS sequence FROM operation_logs'))[0]!.sequence
        let saved: { id: string, logId: string | null, expenseLineIds?: Array<string | null> }
        const reimbursement = request.kind === 'reimbursement' && !('clearanceVerificationEdit' in request.draft) && !('clearanceAttachmentsOnly' in request.draft) ? request.draft as ExpenseReimbursementFormDraft : null
        const newOriginalLines = (reimbursement?.lines ?? []).flatMap((line, index) => !line.id && !line.originalExpenseLineId ? [{ line, index, main: line.constructionMain ?? reimbursement?.constructionMain }] : [])
        if (newOriginalLines.length && newOriginalLines.some(row => !row.main))
          fail('validation-failed', '新建原费用明细必须搜索并选择实际工程对应的施工主合同。')
        if (newOriginalLines.some(row => row.main?.projectId !== reimbursement?.projectId))
          fail('validation-failed', '本单费用明细必须属于同一实际工程；跨工程费用请分单记录。')
        const verificationEdit = 'verificationEdit' in request.draft ? request.draft.verificationEdit : undefined
        const clearanceEdit = 'clearanceVerificationEdit' in request.draft ? request.draft.clearanceVerificationEdit : undefined
        const clearanceAttachmentsOnly = 'clearanceAttachmentsOnly' in request.draft && request.draft.clearanceAttachmentsOnly === true
        if (clearanceEdit || clearanceAttachmentsOnly) {
          saved = { id: request.id!, logId: randomUUID() }
          await tx.execute('INSERT INTO operation_logs(id,table_name,record_id,action,operator) VALUES(?,\'expense_reimbursements\',?,?,?)', [saved.logId, saved.id, clearanceEdit ? 'clearance-verification' : 'original-addition', actor.actorId])
        }
        else if (verificationEdit) {
          saved = { id: request.id!, logId: randomUUID() }
          await tx.execute('INSERT INTO operation_logs(id,table_name,record_id,action,operator) VALUES(?,\'payment_applications\',?,\'business-verification\',?)', [saved.logId, saved.id, actor.actorId])
        }
        else if (request.action === 'unconfirm') {
          await unconfirmPaymentRecordInTransaction(request.id!, tx)
          saved = { id: request.id!, logId: null }
        }
        else if (request.action === 'delete') {
          saved = { id: request.id!, logId: await deleteFinanceFormInTransaction(request.kind, request.id!, tx, actor.actorId) }
        }
        else {
          saved = await saveFinanceFormInTransaction(request.kind, request.draft, request.action, tx)
        }
        const attachmentIds = await applyFiles(tx, request.kind, saved.id, request.attachments, actor)
        const updatedAt = new Date().toISOString()
        const next = (version?.version ?? 0) + 1
        const paymentVerification = verificationEdit
          ? await createPaymentVerification(tx, actor, { id: saved.id, version: String(next), commandId: request.commandId, occurredAt: updatedAt, edit: verificationEdit })
          : null
        const clearanceVerification = clearanceEdit ? await createExpenseClearanceVerification(tx, actor, { headerId: saved.id, version: String(next), commandId: request.commandId, occurredAt: updatedAt, edit: clearanceEdit }) : null
        await tx.execute('INSERT INTO finance_versions VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at', [request.kind, saved.id, next, updatedAt])
        await tx.execute('UPDATE operation_logs SET operator=? WHERE rowid>?', [actor.actorId, beforeLog])
        await tx.execute('UPDATE finance_revision SET revision=revision+1 WHERE singleton=1')
        await tx.execute('INSERT INTO finance_history VALUES(?,?,?,?,?,?,?)', [request.kind, saved.id, next, request.commandId, actor.actorId, updatedAt, JSON.stringify(await financeRecordSnapshot(tx, request.kind, saved.id))])
        const constructionScopeLinks = []
        for (const row of newOriginalLines) {
          const id = saved.expenseLineIds?.[row.index]
          // The original draft owner deliberately omits zero-valued rows. They
          // have no stable expense identity and must not create a second fact.
          if (!id && request.action === 'draft' && Number(row.line.amount) === 0)
            continue
          if (!id || !row.main)
            fail('unavailable', '原费用命令没有返回本行真实稳定编号，工程归属与费用整批撤回。')
          constructionScopeLinks.push(await appendProductionConstructionScopeBinding(tx, actor, { source: { domain: 'original-expense', id }, main: row.main, original: { family: 'finance-reimbursement', commandId: request.commandId } }))
        }
        const { expenseLineIds: _expenseLineIds, ...sourceResult } = saved
        const expenseLineIdentities = saved.expenseLineIds?.flatMap((id, inputIndex) => id ? [{ inputIndex, id }] : [])
        const result: FinanceCommandResult = { ...sourceResult, commandId: request.commandId, version: String(next), updatedAt, attachmentIds, ...(expenseLineIdentities ? { expenseLineIdentities } : {}), ...(constructionScopeLinks.length ? { constructionScopeLinks } : {}), ...(paymentVerification ? { paymentVerificationSha256: financeCommandFingerprint(paymentVerification) } : {}), ...(clearanceVerification ? { clearanceVerificationSha256: financeCommandFingerprint(clearanceVerification), clearanceVerificationId: clearanceVerification.id } : {}) }
        await tx.execute('UPDATE finance_commands SET result_json=? WHERE command_id=?', [JSON.stringify(result), request.commandId])
        await validateExpenseClearanceJournal(tx, actor)
        await tx.execute('RELEASE finance_operation')
        return { result }
      }
      catch (cause) {
        await tx.execute('ROLLBACK TO finance_operation')
        await tx.execute('RELEASE finance_operation')
        if (cause instanceof FinanceAmountSourceError)
          throw new FinanceRepositoryProblem({ code: 'unavailable', message: cause.message })
        if (cause instanceof FinanceRepositoryProblem) {
          if (['validation-failed', 'conflict', 'not-found'].includes(cause.problem.code))
            return { rejected: cause }
          throw cause
        }
        if (cause instanceof Error && !Reflect.get(cause, 'code'))
          return { rejected: new FinanceRepositoryProblem({ code: 'validation-failed', message: cause.message }) }
        throw cause
      }
    })
    if (completed.rejected)
      throw completed.rejected
    return completed.result!
  }
  return {
    execute,
    paymentDetail: (id: string, session: Session) => run('payment_application', session, false, async (tx, actor) => {
      const target = financeId(id)
      return envelope(tx, actor, { kind: 'payment_application', operation: 'detail', id: target }, { detail: await productionPaymentApplicationDetail(tx, actor, await form(tx, 'payment_application', target, actor)) })
    }),
    migrationState: (session: Session) => run('current', session, false, async (tx, actor) => {
      authorizeFinanceImport(actor)
      await validateFinanceJournal(tx, actor)
      const receipts = (await tx.select<{ result_json: string }>('SELECT result_json FROM finance_imports ORDER BY imported_at,id')).map(row => JSON.parse(row.result_json) as FinanceMigrationResult)
      return envelope(tx, actor, { kind: 'current', operation: 'migration' }, { receipts })
    }),
    preflightSnapshot: async (value: unknown, session: Session) => {
      const actor = authorize(session, 'current', false)
      authorizeFinanceImport(actor)
      if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('validation-failed', '财务预检来源无效。')
      const body = value as Record<string, unknown>
      if (Object.keys(body).sort().join(',') !== 'actorId,source,workspaceId' || body.workspaceId !== actor.workspaceId || body.actorId !== actor.actorId)
        fail('validation-failed', '财务预检身份与当前工作区不一致。')
      return withVerifiedMigrationSnapshot(body.source as Parameters<typeof withVerifiedMigrationSnapshot>[0], async (native, evidence) => {
        const source = await readNativeFinanceSource(native, evidence)
        return run('current', session, false, async (tx, current) => {
          if (!isDeepStrictEqual(current, actor))
            fail('forbidden', '财务预检期间身份或权限已变化，请保留输入并重新核验。')
          return envelope(tx, current, { kind: 'current', operation: 'preflight' }, await previewNativeFinance(tx, current, source))
        })
      })
    },
    resolveImport: (value: unknown, session: Session) => run('current', session, true, async (tx, actor) => {
      authorizeFinanceImport(actor)
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'commandId')
        fail('validation-failed', '财务迁入核对只能使用原提交编号。')
      const commandId = financeId((value as { commandId: unknown }).commandId)
      const prior = (await tx.select<{ evidence_json: string, result_json: string }>('SELECT evidence_json,result_json FROM finance_imports WHERE command_id=?', [commandId]))[0]
      if (prior) {
        const evidence = JSON.parse(prior.evidence_json)
        if (evidence.workspaceId !== actor.workspaceId || evidence.actorId !== actor.actorId)
          fail('forbidden', '原财务迁入不属于当前工作区身份。')
        await validateFinanceJournal(tx, actor)
        return { outcome: 'applied' as const, result: JSON.parse(prior.result_json) as FinanceMigrationResult }
      }
      const sealed = (await tx.select<{ workspace_id: string, actor_id: string }>('SELECT * FROM finance_import_resolutions WHERE command_id=?', [commandId]))[0]
      if (sealed && (sealed.workspace_id !== actor.workspaceId || sealed.actor_id !== actor.actorId))
        fail('forbidden', '原财务迁入核对不属于当前身份。')
      if (!sealed)
        await tx.execute('INSERT INTO finance_import_resolutions VALUES(?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
      return { outcome: 'not-applied' as const, commandId }
    }),
    importSnapshot: async (value: unknown, session: Session) => {
      const actor = authorize(session, 'current', true)
      if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('validation-failed', '财务迁入原提交无效。')
      const body = value as Record<string, unknown>
      if (Object.keys(body).some(key => !['workspaceId', 'actorId', 'commandId', 'source', 'mappings', 'originals', 'declaredMissingOriginals'].includes(key)) || body.workspaceId !== actor.workspaceId || body.actorId !== actor.actorId
        || !body.source || !Array.isArray(body.mappings) || (body.originals !== undefined && !Array.isArray(body.originals)) || (body.declaredMissingOriginals !== undefined && !Array.isArray(body.declaredMissingOriginals))) {
        fail('validation-failed', '财务迁入身份或完整源证据无效。')
      }
      if (!actor.capabilities.includes('core:migration:write'))
        fail('forbidden', '当前身份无完整财务迁入权限。')
      return withVerifiedMigrationSnapshot(body.source as Parameters<typeof withVerifiedMigrationSnapshot>[0], async (native, evidence) => {
        const source = await readNativeFinanceSource(native, evidence)
        return run('current', session, true, async (tx, current) => {
          if (!isDeepStrictEqual(current, actor))
            fail('forbidden', '完整财务来源读取期间身份或权限已变化。')
          return importNativeFinance(tx, current, source, { commandId: financeId(body.commandId), mappings: body.mappings as Parameters<typeof importNativeFinance>[3]['mappings'], originals: body.originals as Parameters<typeof importNativeFinance>[3]['originals'], declaredMissingOriginals: body.declaredMissingOriginals as Parameters<typeof importNativeFinance>[3]['declaredMissingOriginals'] })
        })
      })
    },
    form: <K extends CentralFinanceKind>(kind: K, id: string, session: Session) => run(kind, session, false, async (tx, actor) => envelope(tx, actor, { kind, operation: 'form', id: financeId(id) }, await form(tx, kind, id, actor))),
    context: (kind: CentralFinanceKind, session: Session) => run(kind, session, false, (tx, actor) => envelope(tx, actor, { kind, operation: 'context' }, {})),
    list: (kind: CentralFinanceKind, session: Session) => run(kind, session, false, async (tx, actor) => {
      const rows = await tx.select<{ id: string }>(`SELECT id FROM ${FINANCE_TABLE_BY_KIND[kind]} WHERE deleted_at IS NULL ORDER BY created_at DESC,id`)
      const result = []
      for (const row of rows) {
        const read = await form(tx, kind, row.id, actor)
        const draft = read.draft
        const project = draft.projectId && actor.capabilities.includes('project:list:read') ? await tx.references!.read<{ name: string }>('projects', draft.projectId) : null
        const amount = 'applyAmount' in draft ? draft.applyAmount : 'totalAmount' in draft ? draft.totalAmount : 'amount' in draft ? draft.amount : 0
        if (typeof amount !== 'number' || !Number.isFinite(amount))
          fail('unavailable', '财务列表存在未知或损坏金额，不能显示为零。')
        const name = 'name' in draft ? draft.name : 'applicantNameSnapshot' in draft ? draft.applicantNameSnapshot || draft.applicant : 'counterpartyNameSnapshot' in draft ? draft.counterpartyNameSnapshot || draft.counterparty : 'payeeName' in draft ? draft.payeeName : ''
        const date = 'applyDate' in draft ? draft.applyDate : 'reimbursementDate' in draft ? draft.reimbursementDate : 'transactionDate' in draft ? draft.transactionDate : 'applicationDate' in draft ? draft.applicationDate : 'paymentDate' in draft ? draft.paymentDate : ''
        const status = 'confirmationStatus' in draft ? draft.confirmationStatus : 'status' in draft ? draft.status : ''
        const partyName = 'payeeNameSnapshot' in draft ? draft.payeeNameSnapshot ?? '' : 'applicantNameSnapshot' in draft ? draft.applicantNameSnapshot ?? draft.applicant : 'counterpartyNameSnapshot' in draft ? draft.counterpartyNameSnapshot ?? draft.counterparty : ''
        result.push({ id: row.id, no: draft.no ?? '', name: name ?? '', projectName: project?.name ?? (draft.projectId ? '项目资料待核实' : '公司开支'), partyName, amount: decimalNumber(amount), date: date ?? '', status: status ?? '', customerId: 'customerId' in draft ? draft.customerId ?? null : null, dataOrigin: 'real' as const })
      }
      return envelope(tx, actor, { kind, operation: 'list' }, { items: result })
    }),
    customer: (kind: CentralFinanceKind, id: string, session: Session) => run(kind, session, false, async (tx, actor) => {
      const row = await tx.references!.read<{ name: string, tax_no: string }>('customers', financeId(id))
      return envelope(tx, actor, { kind, operation: 'customer', id }, { items: row ? [{ name: row.name, taxNo: row.tax_no ?? '' }] : [] })
    }),
    lookup: (kind: CentralFinanceKind, input: FinanceLookupQuery, session: Session) => run(kind, session, false, async (tx, actor) => {
      const query = normalizeFinanceLookup(input)
      const pattern = (value: unknown) => String(value ?? '').toLocaleLowerCase().includes(query.keyword.trim().toLocaleLowerCase())
      const owners = options.references?.(tx, actor) ?? {}
      let rows: Array<{ id: string, label: string, hint?: string }>
      if (['projects', 'customers', 'suppliers'].includes(query.kind)) {
        const cap = query.kind === 'projects' ? 'project:list:read' : query.kind === 'customers' ? 'customer:list:read' : 'supplier:list:read'
        if (!actor.capabilities.includes(cap))
          fail('forbidden', '当前身份无此资料候选的读取权限。')
        rows = query.kind === 'suppliers'
          ? (await tx.select<{ id: string, draft_json: string }>('SELECT id,draft_json FROM suppliers ORDER BY id')).flatMap((row) => {
              const draft = JSON.parse(row.draft_json)
              return draft.deletedAt ? [] : [{ id: row.id, label: String(draft.name), hint: row.id }]
            })
          : (await tx.select<{ id: string, name: string }>(`SELECT id,name FROM ${query.kind} WHERE deleted_at IS NULL ORDER BY name,id`)).map(row => ({ id: row.id, label: row.name, hint: row.id }))
      }
      else if (query.kind === 'workers') {
        if (!actor.capabilities.includes('worker:list:read'))
          fail('forbidden', '当前身份无全局工人清单读取权限。')
        if (!owners.workerCandidates)
          fail('unavailable', '全局工人正式清单尚无可核实来源。')
        rows = (await owners.workerCandidates()).map(row => ({ id: row.id, label: row.name, hint: row.id }))
      }
      else if (query.kind === 'original-expenses') {
        if (!actor.capabilities.includes('finance-reimbursement:read'))
          fail('forbidden', '当前身份无原费用读取权限。')
        const source = await tx.select<{ id: string, item: string, amount: number, applicant: string }>(`SELECT line.id,line.expense_item AS item,line.amount,COALESCE(head.applicant_name_snapshot,head.applicant) AS applicant FROM expense_reimbursement_lines line JOIN expense_reimbursements head ON head.id=line.reimbursement_id WHERE line.deleted_at IS NULL AND head.deleted_at IS NULL AND head.status='confirmed' AND line.original_expense_line_id IS NULL AND head.project_id IS ? AND head.id<>? ORDER BY line.created_at,line.id`, [query.projectId ?? null, query.excludeId ?? ''])
        rows = source.map(row => ({ id: row.id, label: row.item, hint: `${row.applicant} · ¥${verifiedFinanceSum([row.amount]).toFixed(2)} · 原费用` }))
      }
      else if (query.kind === 'payment-applications') {
        if (!actor.capabilities.includes('finance-payment-application:read'))
          fail('forbidden', '当前身份无付款申请读取权限。')
        const source = await tx.select<{ id: string, name: string, no: string, apply_amount: unknown }>(`SELECT app.id,app.name,app.no,app.apply_amount FROM payment_applications app WHERE app.deleted_at IS NULL AND app.project_id IS ? AND app.supplier_id IS ? AND app.worker_id IS ? ORDER BY app.created_at,app.id`, [query.projectId ?? null, query.supplierId ?? null, query.workerId ?? null])
        rows = []
        for (const row of source) {
          const allocations = await tx.select<{ allocated_amount: unknown, amount: unknown }>(`SELECT line.allocated_amount,cash.amount FROM payment_record_application_allocations line JOIN payment_records cash ON cash.id=line.payment_record_id WHERE line.payment_application_id=? AND line.deleted_at IS NULL AND cash.deleted_at IS NULL AND cash.confirmation_status='confirmed'`, [row.id])
          allocations.forEach(cash => verifiedFinanceSum([cash.amount]))
          const paid = verifiedFinanceSum(allocations.map(line => line.allocated_amount))
          rows.push({ id: row.id, label: row.name, hint: `${row.no || '未编号'} · 申请 ¥${verifiedFinanceSum([row.apply_amount]).toFixed(2)} · 已付 ¥${paid.toFixed(2)}` })
        }
      }
      else if (query.kind === 'contracts') {
        if (!query.projectId)
          return envelope(tx, actor, { kind, operation: 'lookup', query }, { items: [] })
        const material = actor.capabilities.includes('material-contract:read')
          ? (await tx.select<{ id: string, record_json: string }>('SELECT * FROM material_contract_records WHERE parent_id IS NULL')).map((row) => {
              const record = JSON.parse(row.record_json)
              return { id: row.id, project_id: record.draft.projectId, supplier_id: record.draft.supplierId ?? null, kind: '材采', sub_kind: null, name: record.draft.name, no: record.draft.no, deleted_at: record.deletedAt }
            })
          : []
        const source = [...material, ...(owners.contractCandidates ? await owners.contractCandidates() : [])].filter(row => row.project_id === query.projectId && !row.deleted_at && (!query.supplierId || row.supplier_id === query.supplierId) && (!query.contractKinds?.length || query.contractKinds.includes(String(row.kind))) && (!query.paymentBizType || expenseContractMatchesPaymentType(query.paymentBizType, { kind: String(row.kind), sub_kind: typeof row.sub_kind === 'string' ? row.sub_kind : null })))
        if (!source.length && query.contractKinds?.some(value => value !== '材采') && !owners.contractCandidates)
          fail('unavailable', '所需正式合同候选来源尚未接通。')
        rows = source.map(row => ({ id: String(row.id), label: String(row.name ?? ''), hint: String(row.no ?? row.id) }))
      }
      else if (query.kind === 'construction-mains') {
        rows = (await readProductionConstructionMainOptions(tx, actor)).filter(main => !query.projectId || main.projectId === query.projectId).map(main => ({ id: main.id, label: `${main.projectName} · ${main.name}${main.no ? ` / ${main.no}` : ''}`, hint: main.no, constructionMain: { id: main.id, projectId: main.projectId, basis: main.basis } }))
      }
      else if (query.kind === 'settlements') {
        if (!actor.capabilities.includes('other-settlement:read'))
          fail('forbidden', '当前身份无结算读取权限。')
        if (!owners.settlementCandidates)
          fail('unavailable', '正式支出结算来源尚未接通。')
        const source = (await owners.settlementCandidates()).filter(row => row.project_id === (query.projectId ?? null) && row.contract_id === (query.contractId ?? null) && (!query.supplierId || row.supplier_id === query.supplierId) && (!query.workerId || row.worker_id === query.workerId) && isConfirmedExpenditureSettlement(String(row.status)) && !row.deleted_at)
        if (source.some(row => typeof row.total_amount !== 'number' || !Number.isFinite(row.total_amount)))
          fail('unavailable', '结算净额尚未核实，不能显示为零或采用旧总额。')
        rows = source.filter(row => Number(row.total_amount) > 0).map(row => ({ id: String(row.id), label: String(row.name), hint: `${row.no || '未编号'} · 净额 ¥${Number(row.total_amount).toFixed(2)}` }))
      }
      else if (query.kind === 'invoices') {
        if (!actor.capabilities.includes('finance-invoice:read'))
          fail('forbidden', '当前身份无实际发票读取权限。')
        if (!owners.invoiceCandidates)
          fail('unavailable', '实际发票正式来源尚未接通，开票申请不代替发票事实。')
        rows = (await owners.invoiceCandidates()).filter(row => (!query.projectId || row.project_id === query.projectId) && (!query.supplierId || row.supplier_id === query.supplierId) && !row.deleted_at).map(row => ({ id: String(row.id), label: String(row.invoice_number), hint: `含税 ¥${verifiedFinanceSum([row.total_amount]).toFixed(2)}` }))
      }
      else {
        fail('validation-failed', '财务候选类型无效。')
      }
      return envelope(tx, actor, { kind, operation: 'lookup', query }, { items: rows.filter(row => pattern(row.label) || pattern(row.hint) || pattern(row.id)) })
    }),
    resolve: (kind: CentralFinanceKind, commandId: string, session: Session) => run(kind, session, true, async (tx, actor) => {
      financeId(commandId)
      const prior = (await tx.select<CommandRow>('SELECT * FROM finance_commands WHERE command_id=?', [commandId]))[0]
      if (prior && (prior.workspace_id !== actor.workspaceId || prior.actor_id !== actor.actorId || prior.kind !== kind))
        fail('forbidden', '原财务提交不属于当前身份或表单类型。')
      if (prior?.result_json)
        return { outcome: 'applied' as const, result: commandResult(prior.result_json, commandId, kind, undefined) }
      const sealed = (await tx.select<{ workspace_id: string, actor_id: string, kind: string }>('SELECT * FROM finance_resolutions WHERE command_id=?', [commandId]))[0]
      if (sealed && (sealed.workspace_id !== actor.workspaceId || sealed.actor_id !== actor.actorId || sealed.kind !== kind))
        fail('forbidden', '原财务核对不属于当前身份。')
      if (!sealed)
        await tx.execute('INSERT INTO finance_resolutions VALUES(?,?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, kind, new Date().toISOString()])
      return { outcome: 'not-applied' as const, commandId }
    }),
    original: (kind: CentralFinanceKind, id: string, fileId: string, session: Session) => run(kind, session, false, async (tx, actor) => {
      await form(tx, kind, financeId(id), actor)
      const metadata = (await files(tx, kind, id)).find(row => row.id === fileId && !row.deletedAt)
      if (!metadata)
        fail('not-found', '此财务原件不存在或已移除。')
      const payload = (await tx.select<{ content: Uint8Array, sha256: string }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [financeId(fileId)]))[0]
      if (!payload)
        fail('not-found', '历史财务附件只有元数据，尚无可下载正文。')
      if (!(payload.content instanceof Uint8Array) || payload.content.length !== metadata.fileSize || digest(payload.content) !== payload.sha256)
        fail('unavailable', '财务原件正文损坏，请核对备份。')
      return { bytes: payload.content, mimeType: metadata.mimeType, fileName: metadata.fileName, sha256: payload.sha256 }
    }),
  }
}
