import type { SQLOutputValue } from 'node:sqlite'
import type { MaterialContractOwnerSnapshot, StoredMaterialContract } from './material-contract-command-test-instance'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { toNamespacedPath } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FINANCE_OWNER_TYPE, FINANCE_TABLE_BY_KIND } from '../../app/lib/finance/domain'
import { validateQuotationImportEvidence } from '../../app/lib/material-quotation/graph'
import { validateMaterialQuotationSchema } from '../../app/lib/material-quotation/schema-upgrade'
import { validateQuotationJournal } from '../../app/lib/material-quotation/sqlite-owner'
import { isNotificationStoredReceipt } from '../../app/lib/notifications/contract'
import { validateOtherSettlementJournal } from '../../app/lib/other-settlement/storage'
import { isISODateTimeDTO } from '../../app/types/read-model'
import { validateMaterialContractIdentities } from './contract-identity-evidence'
import { createMaterialContractCommandTestInstance } from './material-contract-command-test-instance'
import { readOurSignatories, validateOurSignatoryJournal } from './our-signatory-owner'
import { validateProductionCrewWorkerJournal } from './production-crew-worker-validation'
import { validateFinanceJournal } from './production-finance-journal'
import { notificationCommandFingerprint } from './production-notification-service'
import { validateOtherSettlementImportEvidence } from './production-other-settlement-migration'
import { ProductionStorageProblem, verifyProductionStorageSchema } from './production-storage'
import { productionStorageManifest } from './production-storage-schema'
import { validateProductionSupplierScopeMetadata } from './production-supplier-record'

export interface ProductionBackupInventory {
  schemaVersion: number
  workspaceId: string
  ownerId: string
  purpose: 'verification' | 'production'
  participants: Record<string, { schemaVersion: number, tables: readonly string[] }>
  tables: Record<string, { rows: number, sha256: string }>
  originals: { files: number, bytes: number, metadataOnlyFileIds?: string[] }
  databaseSha256: string
  databaseBytes: number
}
export function backupInvalid(message: string): never {
  throw new ProductionStorageProblem(message)
}
export const backupDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`

export async function backupFileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function canonicalRow(row: Record<string, SQLOutputValue>): string {
  return JSON.stringify(Object.keys(row).sort().map((key) => {
    const value = row[key]
    if (typeof value === 'bigint')
      return [key, 'integer', value.toString()]
    if (value instanceof Uint8Array)
      return [key, 'blob', value.length, backupDigest(value)]
    if (typeof value === 'number' && !Number.isFinite(value))
      backupInvalid('备份含不可表示的数字，无法核对清单。')
    return [key, value]
  }))
}

function readOnlyDomainTransaction(db: DatabaseSync) {
  return {
    async execute() { return backupInvalid('备份核验不能修改事实。') },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params as never[]).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
        if (typeof value !== 'bigint')
          return [key, value]
        const number = Number(value)
        if (!Number.isSafeInteger(number))
          backupInvalid('领域证据超出可核验范围。')
        return [key, number]
      }))) as T[]
    },
  }
}

function verifyOriginalOwner(db: DatabaseSync, row: Record<string, SQLOutputValue>, verifiedMetadataOnlyFileIds: ReadonlySet<string>) {
  for (const kind of Object.keys(FINANCE_OWNER_TYPE) as Array<keyof typeof FINANCE_OWNER_TYPE>) {
    if (row.owner_type === FINANCE_OWNER_TYPE[kind]) {
      if (!db.prepare(`SELECT id FROM ${FINANCE_TABLE_BY_KIND[kind]} WHERE id=?`).get(row.owner_id!))
        backupInvalid('财务原件缺少其实际业务头归属，不能作为有效原件发布。')
      return
    }
  }
  if (row.owner_type === 'expenditure_settlement') {
    if (verifiedMetadataOnlyFileIds.has(String(row.id))) {
      if (!db.prepare('SELECT id FROM expenditure_settlements WHERE id=?').get(row.owner_id!))
        backupInvalid('历史缺件仍须属于实际结算，不能脱离原图归属。')
      return
    }
    const owner = db.prepare(`SELECT f.settlement_id,f.sha256 FROM other_settlement_files f
      JOIN expenditure_settlements s ON s.id=f.settlement_id WHERE f.file_ref_id=? AND f.settlement_id=?`).get(row.id!, row.owner_id!)
    if (!owner || owner.sha256 !== row.sha256)
      backupInvalid('其他支出结算原件与真实结算、稳定文件身份或正文摘要不一致。')
    return
  }
  if (row.owner_type === 'customer') {
    if (!db.prepare('SELECT id FROM customers WHERE id=?').get(row.owner_id!))
      backupInvalid('客户原件归属不完整。')
    return
  }
  if (row.owner_type === 'project') {
    if (!db.prepare('SELECT id FROM projects WHERE id=?').get(row.owner_id!))
      backupInvalid('项目原件归属不完整。')
    return
  }
  if (row.owner_type === 'supplier_credential') {
    const owner = db.prepare(`SELECT c.id FROM supplier_credentials c
      JOIN suppliers s ON s.id=c.supplier_id
      JOIN supplier_credential_files f ON f.file_ref_id=c.file_ref_id AND f.credential_id=c.id AND f.supplier_id=s.id
      WHERE c.id=? AND c.file_ref_id=?`).get(row.owner_id!, row.id!)
    if (!owner)
      backupInvalid('证照原件与分供方双层归属不完整。')
    return
  }
  if (row.owner_type === 'material_quotation') {
    const owner = db.prepare(`SELECT f.quotation_id,f.sha256 FROM material_quotation_files f
      JOIN material_quotations q ON q.id=f.quotation_id
      WHERE f.file_ref_id=? AND f.quotation_id=?`).get(row.id!, row.owner_id!)
    if (!owner || owner.sha256 !== row.sha256)
      backupInvalid('报价原件与报价头、文件身份或正文摘要不一致。')
    return
  }
  if (row.owner_type === 'worker') {
    const asset = db.prepare(`SELECT a.worker_id,a.sha256 FROM worker_roster_assets a
      JOIN workers w ON w.id=a.worker_id WHERE a.file_ref_id=? AND a.worker_id=?`).get(row.id!, row.owner_id!)
    if (!asset || asset.sha256 !== row.sha256)
      backupInvalid('工人原件与全局目录、实名资产及实际正文摘要不一致。')
    return
  }
  if (row.owner_type === 'contract' || row.owner_type === 'contract_supplement') {
    const record = db.prepare('SELECT record_json FROM material_contract_records WHERE id=?').get(row.owner_id!)
    let owner: StoredMaterialContract | undefined
    try {
      owner = record ? JSON.parse(String(record.record_json)) : undefined
    }
    catch { backupInvalid('材采原件的 owner 记录损坏。') }
    const file = owner?.attachments.find(file => file.id === row.id)
    if (!owner || !file || Boolean(owner.draft.isSupplement) !== (row.owner_type === 'contract_supplement')
      || file.ownerType !== row.owner_type || file.ownerId !== row.owner_id || file.fileName !== row.file_name
      || BigInt(file.fileSize) !== row.file_size || file.mimeType !== row.mime_type || file.uploadedAt !== row.uploaded_at
      || file.deletedAt !== row.deleted_at || file.sha256 !== row.sha256) {
      backupInvalid('材采原件与主合同或协议的精确归属及版本证据不一致。')
    }
    return
  }
  backupInvalid('备份出现未登记的原件归属；不能忽略该领域。')
}

function verifyMaterialOwner(db: DatabaseSync, workspaceId: string, actorId: string) {
  try {
    const records = db.prepare('SELECT * FROM material_contract_records').all()
    const contracts = records.map((record) => {
      const owner = JSON.parse(String(record.record_json)) as StoredMaterialContract
      if (owner.id !== record.id || (owner.draft.isSupplement ? owner.draft.originalContractId : null) !== record.parent_id
        || (owner.draft.projectId ?? null) !== record.project_id || (owner.draft.supplierId ?? null) !== record.supplier_id) {
        backupInvalid('材采备份关系列与完整记录证据不一致。')
      }
      return owner
    })
    const commands = db.prepare('SELECT * FROM material_contract_commands').all()
    const resolutions = db.prepare('SELECT * FROM material_contract_resolutions').all()
    for (const row of [...commands, ...resolutions]) {
      const key = JSON.parse(String(row.scoped_id)) as unknown
      if (!Array.isArray(key) || key.length !== 4 || key[0] !== workspaceId || key[1] !== actorId || key[2] !== 'material-contract' || key[3] !== row.command_id
        || row.workspace_id !== workspaceId || row.actor_id !== actorId) {
        backupInvalid('材采备份原命令或墓碑不属于此完整工作区。')
      }
    }
    const stamp = db.prepare('SELECT revision FROM material_contract_revision WHERE singleton=1').all()
    if (stamp.length !== 1)
      backupInvalid('材采备份版本依据不完整。')
    const snapshot: MaterialContractOwnerSnapshot = {
      schemaVersion: 1,
      sourceVersion: Number(stamp[0]!.revision),
      contracts,
      commands: commands.flatMap(row => row.result_json === null ? [] : [[String(row.scoped_id), JSON.parse(String(row.result_json))]]),
      commandFingerprints: commands.map(row => [String(row.scoped_id), String(row.fingerprint)]),
      requestEvidence: commands.map(row => [String(row.scoped_id), JSON.parse(String(row.request_json))]),
      sealedCommands: resolutions.map(row => String(row.scoped_id)),
    }
    createMaterialContractCommandTestInstance().importState(snapshot)
    for (const command of commands) {
      const result = command.result_json === null ? null : JSON.parse(String(command.result_json))
      if ((result?.id ?? null) !== command.contract_id)
        backupInvalid('材采备份原回执归属列与回执不一致。')
    }
    for (const owner of contracts) {
      for (const file of owner.attachments) {
        if (file.sha256 && !db.prepare('SELECT id FROM file_refs WHERE id=? AND owner_id=? AND owner_type=?').get(file.id, owner.id, file.ownerType))
          backupInvalid('材采备份已存原件缺少文件身份或正文归属。')
      }
    }
  }
  catch { backupInvalid('材采备份完整记录、历史冻结、原命令指纹或回执校验失败。') }
}

/** Read a completed isolated snapshot, never an activity-time mixture from the live connection. */
export async function inspectProductionBackup(path: string): Promise<ProductionBackupInventory> {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink())
    backupInvalid('备份必须为普通文件。')
  const db = new DatabaseSync(toNamespacedPath(path), { readOnly: true, enableForeignKeyConstraints: true, defensive: true, readBigInts: true })
  let inventory: Omit<ProductionBackupInventory, 'databaseSha256' | 'databaseBytes'>
  try {
    if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok') || db.prepare('PRAGMA foreign_key_check').all().length)
      backupInvalid('备份数据库完整性或关系校验失败。')
    const meta = db.prepare('SELECT * FROM production_metadata WHERE singleton=1').get()
    const schemaVersion = Number(meta?.schema_version)
    const manifest = productionStorageManifest(schemaVersion)
    if (!meta || typeof meta.workspace_id !== 'string' || typeof meta.owner_id !== 'string' || !['verification', 'production'].includes(String(meta.purpose)))
      backupInvalid('备份身份与用途元数据无效。')
    const participants = db.prepare('SELECT domain,schema_version FROM production_participants ORDER BY domain').all()
    const verifiedMetadataOnlyFileIds = new Set<string>()
    if (participants.length !== Object.keys(manifest.participants).length || participants.some(row => typeof row.domain !== 'string' || Number(row.schema_version) !== manifest.participants[row.domain]?.schemaVersion))
      backupInvalid('备份参与者清单不完整或包含未知领域。')
    const expected = new Set([...manifest.coreTables, ...Object.values(manifest.participants).flatMap(item => item.tables)])
    const actual = db.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'').all().map(row => String(row.name))
    if (actual.length !== expected.size || actual.some(table => !expected.has(table)))
      backupInvalid('备份实表与完整清单不一致。')
    verifyProductionStorageSchema(db, schemaVersion)
    if (manifest.participants['material-contracts'])
      verifyMaterialOwner(db, meta.workspace_id, meta.owner_id)
    if (manifest.participants['material-quotations']) {
      try {
        await validateMaterialQuotationSchema(readOnlyDomainTransaction(db))
        await validateQuotationJournal(readOnlyDomainTransaction(db))
        const importedKeys = await validateQuotationImportEvidence(readOnlyDomainTransaction(db), { workspaceId: String(meta.workspace_id), actorId: String(meta.owner_id) })
        for (const table of ['material_quotation_commands', 'material_quotation_resolutions']) {
          if (db.prepare(`SELECT scoped_id,workspace_id,actor_id FROM ${identifier(table)}`).all().some(row => (row.workspace_id !== meta.workspace_id || row.actor_id !== meta.owner_id) && !importedKeys.has(String(row.scoped_id))))
            backupInvalid('报价原命令或封存编号不属于此工作区的持久身份。')
        }
      }
      catch { backupInvalid('报价原明细、冻结历史、采用原件或原回执证据不完整。') }
    }
    if (manifest.participants['crew-worker']) {
      try {
        await validateProductionCrewWorkerJournal(readOnlyDomainTransaction(db), { workspaceId: meta.workspace_id, actorId: meta.owner_id })
      }
      catch { backupInvalid('全局班组工人目录、实名原件、冻结历史或原回执证据不完整。') }
    }
    if (manifest.participants.finance) {
      try {
        const financeEvidence = await validateFinanceJournal(readOnlyDomainTransaction(db), { workspaceId: meta.workspace_id, actorId: meta.owner_id })
        for (const fileId of financeEvidence.metadataOnlyFileIds)
          verifiedMetadataOnlyFileIds.add(fileId)
      }
      catch { backupInvalid('财务事实、原件、原命令、冻结历史或迁入依据不完整。') }
    }
    if (manifest.participants['other-settlements']) {
      try {
        await validateOtherSettlementJournal(readOnlyDomainTransaction(db), { workspaceId: meta.workspace_id, actorId: meta.owner_id })
        const otherSettlementMissingOriginals = await validateOtherSettlementImportEvidence(readOnlyDomainTransaction(db), { workspaceId: meta.workspace_id, actorId: meta.owner_id })
        for (const fileId of otherSettlementMissingOriginals)
          verifiedMetadataOnlyFileIds.add(fileId)
      }
      catch { backupInvalid('其他支出结算、原费用采用、冻结历史或原回执依据不完整。') }
    }
    if (manifest.participants['our-signatories'] || manifest.participants['contract-number-registry']) {
      if (!manifest.participants['our-signatories'] || !manifest.participants['contract-number-registry'])
        backupInvalid('主体目录与编号参与者缺少共同完整清单。')
      const tx = readOnlyDomainTransaction(db)
      try {
        await readOurSignatories(tx)
        await validateOurSignatoryJournal(tx, { workspaceId: meta.workspace_id, actorId: meta.owner_id, capabilities: [] })
        const records = await tx.select<{ record_json: string }>('SELECT record_json FROM material_contract_records')
        await validateMaterialContractIdentities(tx, records.map(row => JSON.parse(row.record_json)))
      }
      catch { backupInvalid('我方主体核实历史、原提交或合同编号证据不完整。') }
    }
    if (manifest.participants.supplier) {
      for (const row of db.prepare('SELECT * FROM supplier_credential_scopes').iterate()) {
        try {
          const scope = validateProductionSupplierScopeMetadata(String(row.metadata_json))
          if (scope.supplierId !== row.supplier_id || BigInt(scope.version) !== row.version)
            backupInvalid('备份资料历史与当前身份或版本不一致。')
        }
        catch { backupInvalid('备份资料核验历史或问题元数据损坏。') }
      }
    }
    if (manifest.participants.notifications) {
      const stamps = db.prepare('SELECT * FROM notification_revision').all()
      const stamp = stamps[0]
      const supplierRevision = Number(db.prepare('SELECT revision FROM supplier_revision WHERE singleton=1').get()?.revision)
      if (stamps.length !== 1 || !stamp || Number(stamp.singleton) !== 1 || !Number.isSafeInteger(Number(stamp.revision)) || Number(stamp.revision) < 0
        || (stamp.evaluated_at !== null && !isISODateTimeDTO(stamp.evaluated_at))
        || ((stamp.evaluated_at === null) !== (stamp.supplier_source_version === null))
        || (stamp.supplier_source_version !== null && (!Number.isSafeInteger(Number(stamp.supplier_source_version)) || Number(stamp.supplier_source_version) < 0 || Number(stamp.supplier_source_version) > supplierRevision))) {
        backupInvalid('备份消息评估版本或来源依据不完整。')
      }
      for (const row of db.prepare('SELECT * FROM notification_events').iterate()) {
        const scopeRow = db.prepare('SELECT metadata_json FROM supplier_credential_scopes WHERE supplier_id=?').get(row.supplier_id!)
        const scope = scopeRow ? validateProductionSupplierScopeMetadata(String(scopeRow.metadata_json)) : null
        const problem = scope?.expiryProblems?.find(problem => problem.id === row.problem_id)
        if (!problem || problem.supplierId !== row.supplier_id || row.owner_domain !== 'supplier' || row.event_id !== `credential-warning-${backupDigest(problem.id)}` || row.occurred_at !== problem.firstSeenAt
          || !db.prepare('SELECT id FROM supplier_credentials WHERE id=? AND supplier_id=?').get(problem.credentialId, problem.supplierId)) {
          backupInvalid('备份通知与原资料问题归属不完整。')
        }
      }
      for (const row of db.prepare('SELECT * FROM notification_reads').iterate()) {
        const event = db.prepare('SELECT occurred_at FROM notification_events WHERE event_id=?').get(row.event_id!)
        if (row.actor_id !== meta.owner_id || !isISODateTimeDTO(row.read_at) || !event || !isISODateTimeDTO(event.occurred_at) || Date.parse(row.read_at) < Date.parse(event.occurred_at))
          backupInvalid('备份消息已读操作者或发生时间不一致。')
      }
      for (const row of db.prepare('SELECT * FROM notification_commands').iterate()) {
        let result: unknown
        try {
          result = JSON.parse(String(row.result_json))
        }
        catch { return backupInvalid('备份消息原回执损坏。') }
        if (!isNotificationStoredReceipt(result)
          || row.actor_id !== meta.owner_id || row.workspace_id !== meta.workspace_id || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)
          || result.commandId !== row.command_id || !isISODateTimeDTO(row.created_at) || Date.parse(result.readAt) > Date.parse(row.created_at)
          || result.eventIds.some((id) => {
            const read = db.prepare('SELECT read_at FROM notification_reads WHERE event_id=? AND actor_id=?').get(id, meta.owner_id!)
            return !read || !isISODateTimeDTO(read.read_at) || Date.parse(read.read_at) > Date.parse(result.readAt)
          })) {
          backupInvalid('备份消息原回执与事件或操作者不一致。')
        }
        const command = { commandId: result.commandId, workspaceId: String(row.workspace_id), actorId: String(row.actor_id), action: result.eventId === null ? 'mark-all-read' as const : 'open' as const, eventId: result.eventId }
        if (notificationCommandFingerprint(command) !== row.fingerprint)
          backupInvalid('备份消息原命令指纹与动作或采用事件不一致。')
      }
    }
    const tables: ProductionBackupInventory['tables'] = {}
    for (const table of [...expected].sort()) {
      const keys = db.prepare(`PRAGMA table_info(${identifier(table)})`).all().filter(row => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(row => identifier(String(row.name)))
      if (!keys.length)
        backupInvalid('备份表缺少稳定主键，无法核对清单。')
      const hash = createHash('sha256')
      let rows = 0
      for (const row of db.prepare(`SELECT * FROM ${identifier(table)} ORDER BY ${keys.join(',')}`).iterate()) {
        hash.update(`${canonicalRow(row)}\n`)
        rows++
      }
      tables[table] = { rows, sha256: hash.digest('hex') }
    }
    let files = 0
    let bytes = 0
    for (const row of db.prepare('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id ORDER BY f.id').iterate()) {
      verifyOriginalOwner(db, row, verifiedMetadataOnlyFileIds)
      // Only verified immutable source evidence can establish a pre-existing missing body.
      if (row.content === null && row.sha256 === null && verifiedMetadataOnlyFileIds.has(String(row.id)))
        continue
      if (row.content === null && row.sha256 === null)
        backupInvalid('备份原件缺少正文；不能把丢失的文件当成历史缺口或空原件。')
      if (!(row.content instanceof Uint8Array) || BigInt(row.content.length) !== row.file_size || backupDigest(Buffer.from(row.content)) !== row.sha256)
        backupInvalid('备份原件字节、大小或摘要不一致。')
      files++
      bytes += row.content.length
      if (!Number.isSafeInteger(bytes))
        backupInvalid('备份原件总量超出可校验范围。')
    }
    inventory = { schemaVersion, workspaceId: meta.workspace_id, ownerId: meta.owner_id, purpose: meta.purpose as ProductionBackupInventory['purpose'], participants: manifest.participants, tables, originals: { files, bytes, ...(verifiedMetadataOnlyFileIds.size ? { metadataOnlyFileIds: [...verifiedMetadataOnlyFileIds].sort() } : {}) } }
  }
  finally { db.close() }
  const databaseSha256 = await backupFileDigest(path)
  const after = await lstat(path)
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    backupInvalid('备份文件在校验期间发生变化，不能发布。')
  return { ...inventory, databaseSha256, databaseBytes: after.size }
}
