import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CrewFormDraft, WorkerFormDraft } from '../../app/lib/master-data/forms'
import type { WorkerRosterArchive } from '../../app/lib/worker-roster/contract'
import type { BusinessSession } from './business-session'
import type { CrewWorkerStored } from './crew-worker-command-service'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { CREW_PAYROLL_FEE_FIELDS, crewPayrollFeeValues } from '../../app/lib/crew-worker/payroll-fee-defaults'
import { formDefaults } from '../../app/lib/master-data/page'
import { decodeRosterArchive } from '../../app/lib/worker-roster/codec'
import { parsePrivateValues, rosterId } from '../../app/lib/worker-roster/validation'
import { isISODateTimeDTO } from '../../app/types/read-model'
import { decodeProductionCrewWorkerRecord, productionCrewWorkerFailure as fail } from './production-crew-worker-record'
import { importedWorkerPhotoId } from './worker-roster-modern-migration'
import { WORKER_ROSTER_TABLES } from './worker-roster-storage'

type Row = Record<string, string | number | null>
export interface CrewWorkerSourceGraph {
  crews: Row[]
  workers: Row[]
  projects: Row[]
  files: Row[]
  profiles: Row[]
  assets: Row[]
  archives: Row[]
  receipts: Row[]
  audits: Row[]
  legacyMigrationEvidence: Row[]
  legacyMigrationReceipts: Row[]
}
export interface CrewWorkerSourceOriginal { row: Row, bytes: Uint8Array, sha256: string }
export const sourceDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const text = (value: unknown) => typeof value === 'string' ? value : ''
export function crewWorkerSourceTimestamp(value: unknown): string {
  value = text(value)
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value)) ? `${String(value).replace(' ', 'T')}.000Z` : value
  if (!isISODateTimeDTO(normalized))
    fail('validation-failed', '原工人或班组缺少可核验时间，请保留原库并核对来源。')
  return normalized
}
const timestamp = (row: Row) => crewWorkerSourceTimestamp(row.updated_at || row.created_at)
function stringArray(value: unknown): string[] {
  if (value === undefined || value === null)
    return []
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string'))
    fail('validation-failed', '原工人或班组能力字段损坏。')
  return parsed
}
export async function readCrewWorkerSourceGraph(tx: TransactionDb): Promise<{ graph: CrewWorkerSourceGraph, originals: CrewWorkerSourceOriginal[] }> {
  const present = new Set((await tx.select<{ name: string }>('SELECT name FROM sqlite_schema WHERE type=\'table\'')).map(row => row.name))
  if (!['crews', 'workers', 'projects', 'file_refs', 'file_payloads', 'operation_logs'].every(table => present.has(table)))
    fail('validation-failed', '完整 Native 工人来源表不齐全，不能采用任意 JSON 或不完整副本。')
  const modern = WORKER_ROSTER_TABLES.some(table => present.has(table))
  if (modern && !WORKER_ROSTER_TABLES.every(table => present.has(table)))
    fail('validation-failed', 'Native 现代实名图缺表，不能按空历史迁入。')
  const [crews, workers, projects, files, profiles, assets, archives, receipts, audits, legacyMigrationEvidence, legacyMigrationReceipts] = await Promise.all([
    tx.select<Row>('SELECT * FROM crews ORDER BY id'),
    tx.select<Row>('SELECT * FROM workers ORDER BY id'),
    tx.select<Row>('SELECT id,name FROM projects ORDER BY id'),
    tx.select<Row>('SELECT f.*,p.encoding AS payload_encoding,p.content AS payload_content FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.owner_type=\'worker\' ORDER BY f.id'),
    modern ? tx.select<Row>('SELECT * FROM worker_roster_profile_versions ORDER BY worker_id,revision') : [],
    modern ? tx.select<Row>('SELECT * FROM worker_roster_assets ORDER BY id') : [],
    modern ? tx.select<Row>('SELECT * FROM worker_roster_archives ORDER BY id') : [],
    modern ? tx.select<Row>('SELECT * FROM worker_roster_receipts ORDER BY workspace_id,actor_id,command_id') : [],
    tx.select<Row>('SELECT * FROM operation_logs WHERE table_name IN (\'crews\',\'workers\',\'worker_roster_profile_versions\',\'worker_roster_archives\') ORDER BY created_at,id'),
    present.has('worker_roster_migration_evidence') ? tx.select<Row>('SELECT * FROM worker_roster_migration_evidence ORDER BY worker_id') : [],
    present.has('worker_roster_migration_receipts') ? tx.select<Row>('SELECT * FROM worker_roster_migration_receipts ORDER BY workspace_id,actor_id,command_id') : [],
  ])
  for (const rows of [crews, workers, projects]) {
    if (rows.some(row => !rosterId(row.id) || typeof row.name !== 'string') || new Set(rows.map(row => row.id)).size !== rows.length)
      fail('validation-failed', 'Native 稳定身份或名称不完整，不能按同名猜测或丢弃原记录。')
  }
  const originals = files.map((row) => {
    if (!workers.some(worker => worker.id === row.owner_id) || !rosterId(row.id) || row.payload_encoding !== 'base64' || typeof row.payload_content !== 'string' || !Number.isSafeInteger(row.file_size) || Number(row.file_size) < 0)
      return fail('validation-failed', '工人原件缺正文或精确归属，保留原库和快照并补齐后再迁入。')
    const bytes = Buffer.from(row.payload_content, 'base64')
    if (bytes.toString('base64') !== row.payload_content || bytes.length !== row.file_size)
      fail('validation-failed', '工人原件正文与原大小不一致。')
    const { payload_content: _payload, payload_encoding: _encoding, ...metadata } = row
    crewWorkerSourceTimestamp(row.uploaded_at)
    return { row: metadata, bytes, sha256: sourceDigest(bytes) }
  })
  for (const asset of assets) {
    const file = originals.find(original => original.row.id === asset.file_ref_id && original.row.owner_id === asset.worker_id)
    if (!file || file.sha256 !== asset.sha256)
      fail('validation-failed', '现代工人照片登记与原件摘要不一致。')
  }
  for (const profile of profiles) {
    if (!workers.some(worker => worker.id === profile.worker_id) || !Number.isSafeInteger(profile.revision) || Number(profile.revision) < 1 || !isISODateTimeDTO(profile.created_at) || !rosterId(profile.actor_id))
      fail('validation-failed', '原工人冻结私密版本身份或时间不一致。')
    const values = parsePrivateValues(JSON.parse(text(profile.values_json)))
    if ([values.portraitId, values.bankCardId].some(id => id && !assets.some(asset => asset.id === id && asset.worker_id === profile.worker_id)))
      fail('validation-failed', '原工人私密版本引用了未登记或其他人的原件。')
  }
  for (const archive of archives) {
    const document = decodeRosterArchive(JSON.parse(text(archive.snapshot_json)), text(archive.project_id), text(archive.id))
    if (document.version !== archive.version || document.createdAt !== archive.created_at || document.members.some(member => !workers.some(worker => worker.id === member.workerId)))
      fail('validation-failed', '原名册头、成员或冻结快照不一致。')
    for (const member of document.members) {
      if (member.photos.some(photo => !assets.some(asset => asset.id === photo.id && asset.worker_id === member.workerId && asset.sha256 === photo.sha256)))
        fail('validation-failed', '原冻结名册照片与当前保存原件不一致。')
    }
  }
  for (const receipt of receipts) {
    if (!rosterId(receipt.command_id) || !rosterId(receipt.workspace_id) || !rosterId(receipt.actor_id))
      fail('validation-failed', 'Native 原回执缺少原授权身份或原命令编号。')
    if (receipt.fingerprint === 'cancelled' && receipt.result_json === 'null' && receipt.worker_id === null && receipt.archive_id === null)
      continue
    const result = JSON.parse(text(receipt.result_json))
    if (!/^[a-f0-9]{64}$/.test(text(receipt.fingerprint)) || !result || result.commandId !== receipt.command_id || result.workerId !== receipt.worker_id || result.archiveId !== receipt.archive_id || !Number.isSafeInteger(result.revision) || result.revision < 1
      || Boolean(receipt.worker_id) === Boolean(receipt.archive_id)
      || (receipt.worker_id && !profiles.some(row => row.worker_id === receipt.worker_id && row.revision === result.revision))
      || (receipt.archive_id && !archives.some(row => row.id === receipt.archive_id && row.version === result.revision))) {
      fail('validation-failed', 'Native 原回执与原冻结版本或归档不一致。')
    }
  }
  const graph = { crews, workers, projects, files: originals.map(original => ({ ...original.row, payload_sha256: original.sha256 })), profiles, assets, archives, receipts, audits, legacyMigrationEvidence, legacyMigrationReceipts }
  return { graph, originals }
}
const CREW_FIELDS = { trade: 'trade', contactName: 'contact_name', contactPhone: 'contact_phone', note: 'note', status: 'status' } as const
const WORKER_FIELDS = { gender: 'gender', idCard: 'id_card', phone: 'phone', hometown: 'hometown', emergencyContact: 'emergency_contact', emergencyPhone: 'emergency_phone', bankName: 'bank_name', bankAccount: 'bank_account', bankCode: 'bank_code', trade: 'trade', skillLevel: 'skill_level', projectStatus: 'project_status', entryDate: 'entry_date', exitDate: 'exit_date', note: 'note', status: 'status' } as const
export function crewWorkerAdoptedRecords(graph: CrewWorkerSourceGraph, mappings: ReadonlyMap<string, string>, sourceSha256: string, actor: BusinessSession) {
  const crews = graph.crews.map((row) => {
    const draft: CrewFormDraft = { ...formDefaults('crew'), id: text(row.id), name: text(row.name), capabilityTrades: stringArray(row.trade_capabilities), capabilityItems: stringArray(row.item_capabilities) }
    for (const [field, column] of Object.entries(CREW_FIELDS)) {
      if (row[column] != null)
        (draft as Record<string, unknown>)[field] = row[column]
    }
    if (Object.hasOwn(row, 'default_pay_ratio'))
      draft.defaultPayRatio = row.default_pay_ratio as number | null
    else
      delete draft.defaultPayRatio
    const fees = crewPayrollFeeValues(Object.fromEntries(CREW_PAYROLL_FEE_FIELDS.filter(field => Object.hasOwn(row, field.column)).map(field => [field.attribute, row[field.column]])))
    for (const field of CREW_PAYROLL_FEE_FIELDS) {
      const fact = fees[field.fact]
      if (fact.state === 'value')
        (draft as Record<string, unknown>)[field.attribute] = fact.value
      else if (field.kind === 'number')
        (draft as Record<string, unknown>)[field.attribute] = null
    }
    if (row.assignment_level === 'crew' || row.assignment_level === 'worker')
      draft.assignmentLevel = row.assignment_level
    const record: CrewWorkerStored<CrewFormDraft> = { id: text(row.id), draft, version: 1, updatedAt: timestamp(row), deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null, payrollFeeDefaults: fees, migrationBatchId: sourceSha256 }
    return decodeProductionCrewWorkerRecord<CrewFormDraft>('crew', record.id, JSON.stringify(record), actor)
  })
  const workers = graph.workers.map((row) => {
    const draft: WorkerFormDraft = { ...formDefaults('worker'), id: text(row.id), name: text(row.name), crewId: typeof row.crew_id === 'string' && row.crew_id ? row.crew_id : null, currentProjectId: typeof row.current_project_id === 'string' && row.current_project_id ? mappings.get(row.current_project_id) ?? null : null, familyGroupId: typeof row.family_group_id === 'string' ? row.family_group_id : null, capabilityTrades: stringArray(row.trade_capabilities), capabilityItems: stringArray(row.item_capabilities) }
    for (const [field, column] of Object.entries(WORKER_FIELDS)) {
      if (row[column] != null)
        (draft as Record<string, unknown>)[field] = row[column]
    }
    if (Object.hasOwn(row, 'daily_wage'))
      draft.dailyWage = row.daily_wage as number | null
    else
      delete draft.dailyWage
    if (row.safety_education != null && ![0, 1].includes(Number(row.safety_education)))
      fail('validation-failed', '工人原安全教育状态无效。')
    draft.safetyEducation = row.safety_education === 1
    if (draft.crewId && !crews.some(crew => crew.id === draft.crewId))
      fail('validation-failed', '原工人班组关系无法保全。')
    const record: CrewWorkerStored<WorkerFormDraft> = { id: text(row.id), draft, version: 1, updatedAt: timestamp(row), deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null, migrationBatchId: sourceSha256, linkedWorkerId: typeof row.linked_worker_id === 'string' && row.linked_worker_id ? row.linked_worker_id : null }
    return decodeProductionCrewWorkerRecord<WorkerFormDraft>('worker', record.id, JSON.stringify(record), actor)
  })
  return { crews, workers }
}
export function importedSourceAssetId(graph: CrewWorkerSourceGraph, workerId: string, fileId: string) {
  return text(graph.assets.find(asset => asset.worker_id === workerId && asset.file_ref_id === fileId)?.id) || importedWorkerPhotoId(workerId, fileId)
}

export function mappedCrewWorkerArchive(row: CrewWorkerSourceGraph['archives'][number], mappings: ReadonlyMap<string, string>): WorkerRosterArchive {
  const original = JSON.parse(String(row.snapshot_json)) as WorkerRosterArchive
  const projectId = mappings.get(String(row.project_id))
  if (!projectId)
    return fail('validation-failed', '冻结名册项目缺少明确的实际目标映射。')
  return { ...original, scope: { ...original.scope, projectId }, members: original.members.map(member => ({ ...member, profile: member.profile ? { ...member.profile, currentProjectId: member.profile.currentProjectId ? mappings.get(member.profile.currentProjectId) ?? null : null } : null })), migration: { originalId: original.id, originalContentHash: sourceDigest(String(row.snapshot_json)) } }
}
