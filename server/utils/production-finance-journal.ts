import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralFinanceKind } from '../../app/lib/finance/central-contract'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { CENTRAL_FINANCE_KINDS, financeFailure } from '../../app/lib/finance/central-contract'
import { FINANCE_OWNER_TYPE, FINANCE_TABLE_BY_KIND } from '../../app/lib/finance/domain'
import { validateFinanceExpenseReferenceGuards } from '../../app/lib/finance/expense-references'
import { validateFinanceExpensePartyGuards } from '../../app/lib/finance/party-references'
import { validateFinancePaymentAllocationGuards } from '../../app/lib/finance/payment-allocation-guards'
import { validateFinancePaymentPartyGuards } from '../../app/lib/finance/payment-party-upgrade'
import { validateExpenseClearanceJournal } from './production-finance-clearance'
import { validateDeclaredMissingClearanceOriginals } from './production-finance-clearance-originals'
import { validateFinanceContractHistory } from './production-finance-contract-history'
import { validateFinanceInvoiceAdoptions, validatePaymentInvoiceEvidence } from './production-finance-invoice-adoption'
import { financeCanonical, financeCommandFingerprint, financeId, parseFinanceCommand } from './production-finance-request'
import { validatePaymentSettlementEvidence } from './production-finance-settlement-evidence'
import { validatePaymentVerificationJournal } from './production-finance-verification'

export const FINANCE_RELATIONS: Partial<Record<CentralFinanceKind, readonly [string, string][]>> = {
  reimbursement: [['expense_reimbursement_lines', 'reimbursement_id']],
  payment_application: [['payment_application_settlement_allocations', 'payment_application_id'], ['payment_application_invoice_allocations', 'payment_application_id']],
  payment_record: [['payment_record_application_allocations', 'payment_record_id']],
}
type Row = Record<string, unknown>
const invalid = () => financeFailure('unavailable', '财务版本、原命令、冻结记录、原件或迁入证据损坏；停止使用并核对备份。')
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
function parse(value: unknown): Row {
  if (typeof value !== 'string')
    return invalid()
  try {
    const parsed: unknown = JSON.parse(value)
    if (!object(parsed))
      return invalid()
    return parsed
  }
  catch { return invalid() }
}

/** Exact persistent rows and shared-original references; no duplicate body library. */
export async function financeRecordSnapshot(tx: Pick<TransactionDb, 'select'>, kind: CentralFinanceKind, id: string) {
  const head = (await tx.select<Row>(`SELECT * FROM ${FINANCE_TABLE_BY_KIND[kind]} WHERE id=?`, [id]))[0]
  if (!head)
    return invalid()
  const relations: Record<string, Row[]> = {}
  for (const [table, owner] of FINANCE_RELATIONS[kind] ?? [])
    relations[table] = await tx.select<Row>(`SELECT * FROM ${table} WHERE ${owner}=? ORDER BY id`, [id])
  const files = await tx.select<Row>('SELECT f.*,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.owner_type=? AND f.owner_id=? ORDER BY f.id', [FINANCE_OWNER_TYPE[kind], id])
  return { head, relations, files }
}

/** 迁入引用只能来自与原迁入回执绑定的完整来源图。 */
export function validateFinanceImportSourceEvidence(evidence: Row, fingerprint: unknown) {
  if (!object(evidence.requestProof) || !object(evidence.sourceGraph) || !Array.isArray(evidence.retainedReferences)
    || !Array.isArray(evidence.sourceGraph.retained) || typeof fingerprint !== 'string'
    || financeCommandFingerprint(evidence.requestProof) !== fingerprint
    || evidence.requestProof.sourceGraphSha256 !== financeCommandFingerprint(evidence.sourceGraph)
    || financeCanonical(evidence.retainedReferences) !== financeCanonical(evidence.sourceGraph.retained)) {
    return invalid()
  }
}

/** Read-only: accepts the backup's protected transaction, never repairs or writes a journal. */
export async function validateFinanceJournal(db: Pick<TransactionDb, 'select'>, expectedIdentity: { workspaceId: string, actorId: string }): Promise<{ metadataOnlyFileIds: ReadonlySet<string> }> {
  const metadataOnlyFileIds = new Set<string>()
  await validateFinancePaymentPartyGuards(db)
  await validateFinanceExpensePartyGuards(db)
  await validateFinancePaymentAllocationGuards(db)
  await validateFinanceExpenseReferenceGuards(db)
  const stamps = await db.select<{ revision: number }>('SELECT * FROM finance_revision')
  if (stamps.length !== 1 || !Number.isSafeInteger(stamps[0]!.revision) || stamps[0]!.revision < 0)
    return invalid()
  const commands = await db.select<Row>('SELECT * FROM finance_commands')
  const histories = await db.select<Row>('SELECT * FROM finance_history ORDER BY kind,id,version')
  const contractHistory = await validateFinanceContractHistory(db, histories)
  const paymentCoverage = contractHistory.schemaVersion >= 31 ? await db.select<Row>('SELECT * FROM finance_payment_invoice_coverage') : []
  const usedCoverage = new Set<string>()
  const versions = await db.select<Row>('SELECT * FROM finance_versions')
  const imports = await db.select<Row>('SELECT * FROM finance_imports')
  const imported = new Map<string, Row>()
  for (const receipt of imports) {
    const evidence = parse(receipt.evidence_json)
    const result = parse(receipt.result_json)
    validateFinanceImportSourceEvidence(evidence, receipt.fingerprint)
    if (evidence.schemaVersion !== 'finance-import-v1' || evidence.workspaceId !== expectedIdentity.workspaceId || evidence.actorId !== expectedIdentity.actorId
      || evidence.commandId !== receipt.command_id || evidence.sourceBytesSha256 !== receipt.source_fingerprint
      || typeof evidence.sourceBytesSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sourceBytesSha256)
      || evidence.sourceOrigin !== 'native' || !object(evidence.sourceTables) || !object(evidence.sourceJournals) || !object(evidence.requestProof)
      || evidence.requestProof.sourceBytesSha256 !== evidence.sourceBytesSha256 || financeCommandFingerprint(evidence.requestProof) !== receipt.fingerprint
      || result.commandId !== receipt.command_id || result.sourceBytesSha256 !== receipt.source_fingerprint || result.importedAt !== receipt.imported_at
      || financeCanonical(result.records) !== financeCanonical(evidence.records)
      || !Array.isArray(evidence.records) || !Array.isArray(evidence.files) || !date(receipt.imported_at)) {
      return invalid()
    }
    for (const id of await validateDeclaredMissingClearanceOriginals(db, evidence)) metadataOnlyFileIds.add(id)
    const sourceLogs = evidence.sourceTables.operation_logs
    if (!Array.isArray(sourceLogs))
      return invalid()
    for (const log of sourceLogs) {
      if (!object(log) || typeof log.id !== 'string')
        return invalid()
      const actual = (await db.select<Row>('SELECT * FROM operation_logs WHERE id=?', [log.id]))[0]
      if (!actual || financeCanonical(actual) !== financeCanonical(log))
        return invalid()
    }
    for (const mapping of evidence.records) {
      if (!object(mapping) || !CENTRAL_FINANCE_KINDS.includes(mapping.kind as CentralFinanceKind) || typeof mapping.id !== 'string' || imported.has(`${mapping.kind}:${mapping.id}`))
        return invalid()
      imported.set(`${mapping.kind}:${mapping.id}`, { ...mapping, commandId: receipt.command_id })
    }
  }
  for (const command of commands) {
    const request = parseFinanceCommand(parse(command.request_json))
    if (command.workspace_id !== expectedIdentity.workspaceId || command.actor_id !== expectedIdentity.actorId || command.kind !== request.kind
      || command.command_id !== request.commandId || command.workspace_id !== request.workspaceId || command.actor_id !== request.actorId || command.fingerprint !== financeCommandFingerprint(request)) {
      return invalid()
    }
    if (command.result_json === null)
      continue
    const result = parse(command.result_json)
    const history = histories.find(row => row.kind === request.kind && row.id === result.id && String(row.version) === result.version)
    if (result.commandId !== request.commandId || !history || history.command_id !== request.commandId || history.actor_id !== request.actorId
      || history.occurred_at !== result.updatedAt || !Array.isArray(result.attachmentIds) || new Set(result.attachmentIds).size !== result.attachmentIds.length) {
      return invalid()
    }
    const snapshot = parse(history.snapshot_json)
    if (contractHistory.schemaVersion >= 31 && !contractHistory.isLegacyFinance(request.kind, result.id, Number(result.version))) {
      const verificationEdit = 'verificationEdit' in request.draft && !!request.draft.verificationEdit
      if (request.kind === 'payment_application' && request.action !== 'delete' && !verificationEdit
        && (!Object.hasOwn(snapshot, 'invoiceAdoptions') || !Object.hasOwn(snapshot, 'paymentSettlementEvidence'))) {
        return invalid()
      }
      if (request.kind === 'payment_record' && request.action === 'confirm') {
        if (!Object.hasOwn(snapshot, 'paymentInvoiceEvidence'))
          return invalid()
        const proof = paymentCoverage.find(row => row.record_id === result.id && row.version === Number(result.version) && row.command_id === request.commandId)
        if (!proof || typeof proof.coverage_json !== 'string' || proof.invoice_evidence_sha256 !== financeCommandFingerprint(snapshot.paymentInvoiceEvidence))
          return invalid()
        let coverage: unknown
        try {
          coverage = JSON.parse(proof.coverage_json)
        }
        catch { return invalid() }
        await validatePaymentInvoiceEvidence(db, snapshot, coverage)
        usedCoverage.add(String(proof.command_id))
      }
    }
    if (Object.hasOwn(snapshot, 'invoiceAdoptions') !== Object.hasOwn(result, 'invoiceAdoptionsSha256')
      || (Object.hasOwn(snapshot, 'invoiceAdoptions') && (request.kind !== 'payment_application' || financeCommandFingerprint(snapshot.invoiceAdoptions) !== result.invoiceAdoptionsSha256))) {
      return invalid()
    }
    if (Object.hasOwn(snapshot, 'paymentInvoiceEvidence') !== Object.hasOwn(result, 'paymentInvoiceEvidenceSha256')
      || (Object.hasOwn(snapshot, 'paymentInvoiceEvidence') && (request.kind !== 'payment_record' || request.action !== 'confirm' || financeCommandFingerprint(snapshot.paymentInvoiceEvidence) !== result.paymentInvoiceEvidenceSha256))) {
      return invalid()
    }
    if (Object.hasOwn(snapshot, 'paymentSettlementEvidence') !== Object.hasOwn(result, 'paymentSettlementEvidenceSha256')
      || (Object.hasOwn(snapshot, 'paymentSettlementEvidence') && (request.kind !== 'payment_application' || financeCommandFingerprint(snapshot.paymentSettlementEvidence) !== result.paymentSettlementEvidenceSha256))) {
      return invalid()
    }
    if (result.expenseLineIdentities !== undefined) {
      const submitted = 'lines' in request.draft ? request.draft.lines : undefined
      const frozen = object(snapshot.relations) ? snapshot.relations.expense_reimbursement_lines : undefined
      if (request.kind !== 'reimbursement' || !Array.isArray(result.expenseLineIdentities) || !Array.isArray(submitted) || !Array.isArray(frozen))
        return invalid()
      const expected = submitted.flatMap((line, inputIndex) => request.action === 'draft' && Number(line.amount) === 0 ? [] : [inputIndex])
      if (result.expenseLineIdentities.length !== expected.length || new Set(result.expenseLineIdentities.map(row => row.id)).size !== expected.length)
        return invalid()
      for (const [index, row] of result.expenseLineIdentities.entries()) {
        if (!object(row) || typeof row.inputIndex !== 'number' || row.inputIndex !== expected[index] || typeof row.id !== 'string' || !frozen.some(line => object(line) && line.id === row.id && line.reimbursement_id === result.id && line.sort_order === index)
          || (submitted[row.inputIndex]?.id && submitted[row.inputIndex]?.id !== row.id)) {
          return invalid()
        }
      }
    }
    if (result.constructionScopeLinks !== undefined) {
      if (request.kind !== 'reimbursement' || !Array.isArray(result.constructionScopeLinks))
        return invalid()
      const consumed = new Set<string>()
      for (const saved of result.constructionScopeLinks) {
        if (!object(saved) || typeof saved.commandId !== 'string' || !object(saved.relation) || saved.relation.domain !== 'original-expense' || consumed.has(saved.commandId))
          return invalid()
        consumed.add(saved.commandId)
        const intent = (await db.select<Row>('SELECT * FROM construction_scope_intents WHERE command_id=?', [saved.commandId]))[0]
        const receipt = (await db.select<Row>('SELECT * FROM construction_scope_receipts WHERE command_id=?', [saved.commandId]))[0]
        if (!intent || !receipt || intent.workspace_id !== request.workspaceId || intent.actor_id !== request.actorId || receipt.workspace_id !== request.workspaceId || receipt.actor_id !== request.actorId || !isDeepStrictEqual(parse(receipt.result_json), saved))
          return invalid()
        const child = parse(intent.request_json)
        if (!object(child.originalSourceCommand) || child.originalSourceCommand.family !== 'finance-reimbursement' || child.originalSourceCommand.commandId !== request.commandId || !object(child.source)
          || child.source.domain !== 'original-expense' || child.source.id !== saved.relation.sourceId || child.projectId !== saved.relation.projectId || child.mainId !== saved.relation.mainId) {
          return invalid()
        }
      }
    }
    const snapshotFiles = snapshot.files
    if (!object(snapshot.head) || snapshot.head.id !== result.id || !Array.isArray(snapshotFiles)
      || result.attachmentIds.some(id => !snapshotFiles.some((file: unknown) => object(file) && file.id === id && file.owner_id === result.id))) {
      return invalid()
    }
    let operation: Row | null = null
    if (result.logId !== null) {
      const logs = await db.select<Row>('SELECT * FROM operation_logs WHERE id=?', [result.logId])
      if (logs.length !== 1 || logs[0]!.table_name !== FINANCE_TABLE_BY_KIND[request.kind] || logs[0]!.record_id !== result.id || logs[0]!.operator !== request.actorId)
        return invalid()
      operation = logs[0]!
    }
    if (contractHistory.schemaVersion >= 31 && request.kind === 'payment_application' && !contractHistory.isLegacyFinance(request.kind, result.id, Number(result.version))) {
      const version = Number(result.version)
      if (!Number.isSafeInteger(version) || version < 1 || (request.id === undefined
        ? version !== 1 || request.baseVersion !== null
        : request.id !== result.id || version < 2 || request.baseVersion !== String(version - 1))) {
        return invalid()
      }
      const verificationEdit = 'verificationEdit' in request.draft && !!request.draft.verificationEdit
      if (request.action === 'delete') {
        if (!date(snapshot.head.deleted_at))
          return invalid()
        if (operation === null) {
          const prior = histories.find(row => row.kind === request.kind && row.id === result.id && row.version === version - 1)
          const priorSnapshot = prior ? parse(prior.snapshot_json) : null
          if (!priorSnapshot || !object(priorSnapshot.head) || priorSnapshot.head.deleted_at !== snapshot.head.deleted_at)
            return invalid()
        }
        else if (operation.action !== 'delete' || financeCanonical(parse(operation.after_data)) !== financeCanonical(snapshot.head)) {
          return invalid()
        }
      }
      else {
        if (snapshot.head.deleted_at !== null || !operation || operation.action !== (verificationEdit ? 'business-verification' : request.id === undefined ? 'create' : 'update'))
          return invalid()
        if (!verificationEdit && financeCanonical(parse(operation.after_data)) !== financeCanonical(snapshot.head))
          return invalid()
      }
    }
  }
  if (paymentCoverage.length !== usedCoverage.size)
    return invalid()
  for (const kind of CENTRAL_FINANCE_KINDS) {
    const heads = await db.select<Row>(`SELECT * FROM ${FINANCE_TABLE_BY_KIND[kind]}`)
    for (const head of heads) {
      const version = versions.find(row => row.kind === kind && row.id === head.id)
      const history = histories.filter(row => row.kind === kind && row.id === head.id)
      if (!version || !Number.isSafeInteger(version.version) || Number(version.version) < 1 || history.length !== version.version || !date(version.updated_at))
        return invalid()
      for (const [index, row] of history.entries()) {
        const migration = imported.get(`${kind}:${head.id}`)
        if (row.version !== index + 1 || !date(row.occurred_at) || typeof row.command_id !== 'string' || typeof row.actor_id !== 'string'
          || (!commands.some(command => command.command_id === row.command_id && command.result_json !== null) && !(index === 0 && migration?.commandId === row.command_id))) {
          return invalid()
        }
        const snapshot = parse(row.snapshot_json)
        if (!object(snapshot.head) || snapshot.head.id !== head.id || !object(snapshot.relations) || !Array.isArray(snapshot.files))
          return invalid()
        if (Object.hasOwn(snapshot, 'invoiceAdoptions')) {
          if (kind !== 'payment_application')
            return invalid()
          await validateFinanceInvoiceAdoptions(db, snapshot)
        }
        if (Object.hasOwn(snapshot, 'paymentInvoiceEvidence')) {
          if (kind !== 'payment_record')
            return invalid()
          await validatePaymentInvoiceEvidence(db, snapshot)
        }
        if (Object.hasOwn(snapshot, 'paymentSettlementEvidence')) {
          if (kind !== 'payment_application')
            return invalid()
          await validatePaymentSettlementEvidence(db, snapshot)
        }
        for (const file of snapshot.files) {
          if (!object(file) || file.owner_type !== FINANCE_OWNER_TYPE[kind] || file.owner_id !== head.id)
            return invalid()
          const current = (await db.select<Row>('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [file.id]))[0]
          if (!current || current.owner_type !== file.owner_type || current.owner_id !== file.owner_id || current.file_size !== file.file_size || current.file_name !== file.file_name || current.sha256 !== file.sha256)
            return invalid()
          if (current.content !== null && current.content !== undefined && (!(current.content instanceof Uint8Array) || current.content.length !== current.file_size || createHash('sha256').update(current.content).digest('hex') !== current.sha256))
            return invalid()
          if (current.content === null || current.content === undefined) {
            if (!metadataOnlyFileIds.has(String(current.id)) && !imports.some((receipt) => {
              const evidence = parse(receipt.evidence_json)
              return Array.isArray(evidence.files) && evidence.files.some((file) => {
                if (!object(file) || !object(file.row))
                  return false
                const original = file.row
                return file.id === current.id && file.bodyState === 'metadata-only' && file.sha256 === null
                  && original.id === current.id && !original.file_path && current.sha256 === null
                  && ['owner_type', 'owner_id', 'file_name', 'file_size', 'mime_type', 'uploader', 'uploaded_at'].every(key => original[key] === current[key])
              })
            })) {
              return invalid()
            }
            metadataOnlyFileIds.add(String(current.id))
          }
        }
      }
      const currentSnapshot = parse(history.at(-1)!.snapshot_json)
      delete currentSnapshot.invoiceAdoptions
      delete currentSnapshot.paymentInvoiceEvidence
      delete currentSnapshot.paymentSettlementEvidence
      const current = await financeRecordSnapshot(db, kind, String(head.id))
      if (contractHistory.schemaVersion >= 31 && kind === 'payment_application' && object(currentSnapshot.head) && !Object.hasOwn(currentSnapshot.head, 'contract_domain')) {
        if (current.head.contract_domain !== null || current.head.contract_version !== null || !contractHistory.isLegacy(head.id, version.version))
          return invalid()
        delete current.head.contract_domain
        delete current.head.contract_version
      }
      if (history.at(-1)!.occurred_at !== version.updated_at || financeCanonical(currentSnapshot) !== financeCanonical(current))
        return invalid()
    }
    if (versions.some(row => row.kind === kind && !heads.some(head => head.id === row.id)) || histories.some(row => row.kind === kind && !heads.some(head => head.id === row.id)))
      return invalid()
  }
  if (versions.some(row => !CENTRAL_FINANCE_KINDS.includes(row.kind as CentralFinanceKind)) || histories.some(row => !CENTRAL_FINANCE_KINDS.includes(row.kind as CentralFinanceKind)))
    return invalid()
  for (const resolution of await db.select<Row>('SELECT * FROM finance_resolutions')) {
    financeId(resolution.command_id)
    if (resolution.workspace_id !== expectedIdentity.workspaceId || resolution.actor_id !== expectedIdentity.actorId || !date(resolution.resolved_at)
      || !CENTRAL_FINANCE_KINDS.includes(resolution.kind as CentralFinanceKind) || commands.some(command => command.command_id === resolution.command_id && (command.result_json !== null || command.kind !== resolution.kind))) {
      return invalid()
    }
  }
  for (const resolution of await db.select<Row>('SELECT * FROM finance_import_resolutions')) {
    financeId(resolution.command_id)
    if (resolution.workspace_id !== expectedIdentity.workspaceId || resolution.actor_id !== expectedIdentity.actorId || !date(resolution.resolved_at) || imports.some(receipt => receipt.command_id === resolution.command_id))
      return invalid()
  }
  for (const log of await db.select<Row>('SELECT * FROM operation_logs')) {
    if (log.before_data !== null)
      parse(log.before_data)
    if (log.after_data !== null)
      parse(log.after_data)
  }
  await validatePaymentVerificationJournal(db, expectedIdentity)
  await validateExpenseClearanceJournal(db, expectedIdentity)
  return { metadataOnlyFileIds }
}
