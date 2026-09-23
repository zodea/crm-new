import type { ExportFileOptions } from '../kit/export'
import type { ProjectArchiveZipFile } from '../project/archive'
import type { WorkerRosterArchive, WorkerRosterRepository } from '../worker-roster/contract'
import type { PayrollWorkbookArchive } from './central-workbook-contract'
import * as XLSX from 'xlsx'
import { createZip } from '../project/archive'
import { decodeRosterArchive } from '../worker-roster/codec'
import { WORKER_PRIVATE_READ } from '../worker-roster/contract'
import { createWorkerRosterArchiveFiles, createWorkerRosterWorkbook, workerRosterPhotoPath } from '../worker-roster/export'
import { rosterCanonical } from '../worker-roster/validation'
import { createPayrollCompleteWorkbook, createPayrollMonthlyArchiveFiles } from './complete-workbook'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
interface WorkbookExportReaders {
  archive: () => Promise<PayrollWorkbookArchive>
  roster: Pick<WorkerRosterRepository, 'archive' | 'file'>
}

function permitted(archive: PayrollWorkbookArchive) {
  if (archive.context.origin !== 'real' || !archive.context.capabilities.includes('payroll:read'))
    throw new Error('工资目录读取权限已失效，请重新读取')
}

export function assertPayrollWorkbookRead(fresh: PayrollWorkbookArchive, original: PayrollWorkbookArchive, includePrivate: boolean): void {
  permitted(fresh)
  if (fresh.id !== original.id || fresh.version !== original.version || fresh.manifestHash !== original.manifestHash || fresh.input.projectId !== original.input.projectId || fresh.context.workspaceId !== original.context.workspaceId || fresh.context.actorId !== original.context.actorId)
    throw new Error('保存目录或当前身份已变化，下载已停止')
  if (includePrivate && !fresh.context.capabilities.includes(WORKER_PRIVATE_READ))
    throw new Error('工人私密资料读取权限已失效，下载已停止')
}

export async function assertPayrollWorkbookRoster(archive: PayrollWorkbookArchive, roster: WorkerRosterArchive): Promise<void> {
  permitted(archive)
  const reference = archive.rosterRef
  const { context, ...body } = roster
  if (!reference || context.origin !== 'real' || !context.capabilities.includes(WORKER_PRIVATE_READ)
    || context.workspaceId !== archive.context.workspaceId || context.actorId !== archive.context.actorId
    || roster.scope.projectId !== archive.input.projectId || roster.id !== reference.id || roster.version !== reference.version
    || roster.sourceVersion !== reference.sourceVersion || roster.scope.registeredOn !== reference.registeredOn
    || rosterCanonical([...roster.scope.statementIds].sort()) !== rosterCanonical([...archive.input.statementIds].sort())) {
    throw new Error('名册权限、固定版本或原工资范围不一致，下载已停止')
  }
  decodeRosterArchive(roster, archive.input.projectId, reference.id)
  const bytes = new TextEncoder().encode(rosterCanonical(body))
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  // Migration evidence is attached by the owner only after validating the original graph.
  if (hash !== reference.contentHash && roster.migration?.originalContentHash !== reference.contentHash)
    throw new Error('名册正文摘要与保存目录不一致，下载已停止')
}

function publication(archive: PayrollWorkbookArchive, includePrivate: boolean) {
  return includePrivate
    ? archive
    : {
        ...archive,
        deliveryGaps: [...archive.deliveryGaps, { kind: 'roster' as const, statementId: null, reason: '本次文件仅含工资资料，未包含实名名册及照片原件；完整附件须经工人私密资料权限读取。' }],
      }
}

/** Public payroll export never reads or embeds a private roster. */
export function createPayrollSavedWorkbook(archive: PayrollWorkbookArchive): ExportFileOptions {
  permitted(archive)
  if (archive.input.mode !== 'leader-cycle' || archive.groups.length !== 1)
    throw new Error('负责人全周期 XLSX 需要一份固定请款簿目录')
  return createPayrollCompleteWorkbook(archive.groups[0]!, archive.gaps, publication(archive, false))
}

function addRosterSheets(file: ProjectArchiveZipFile, roster: WorkerRosterArchive): ProjectArchiveZipFile {
  const book = XLSX.read(file.data, { type: 'array' })
  const privateBook = XLSX.read(createWorkerRosterWorkbook(roster).data, { type: 'array' })
  const prefix = '../'.repeat(file.path.split('/').length - 1)
  for (const sheetName of privateBook.SheetNames) {
    const sheet = privateBook.Sheets[sheetName]!
    for (const [key, cell] of Object.entries(sheet)) {
      if (!key.startsWith('!') && cell && typeof cell === 'object' && typeof cell.v === 'string' && cell.v.startsWith('photos/'))
        cell.v = `${prefix}${cell.v}`
    }
    XLSX.utils.book_append_sheet(book, sheet, sheetName === '归档说明' ? '名册归档说明' : sheetName)
  }
  return { ...file, data: new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })) }
}

function payrollFiles(archive: PayrollWorkbookArchive, includePrivate: boolean): ProjectArchiveZipFile[] {
  const metadata = publication(archive, includePrivate)
  if (archive.input.mode === 'project-month')
    return createPayrollMonthlyArchiveFiles(archive.projectName, archive.groups, archive.gaps, metadata)
  if (archive.groups.length !== 1)
    throw new Error('全周期目录不能合并不同负责人或请款簿')
  const output = createPayrollCompleteWorkbook(archive.groups[0]!, archive.gaps, metadata)
  return [{ path: output.defaultName, data: new Uint8Array(output.data as ArrayBuffer), mimeType: XLSX_MIME }]
}

/** Re-read authorization after the last byte, before returning any downloadable file. */
export async function createPayrollSavedArchiveFiles(archive: PayrollWorkbookArchive, includePrivate: boolean, readers: WorkbookExportReaders): Promise<ProjectArchiveZipFile[]> {
  permitted(archive)
  let files = payrollFiles(archive, includePrivate)
  if (includePrivate) {
    if (!archive.rosterRef)
      throw new Error('此目录未保存名册版本，不能生成实名附件')
    const roster = await readers.roster.archive(archive.input.projectId, archive.rosterRef.id)
    await assertPayrollWorkbookRoster(archive, roster)
    const attachments = await createWorkerRosterArchiveFiles(roster, readers.roster.file)
    files = files.map(file => file.path.endsWith('.xlsx') ? addRosterSheets(file, roster) : file)
    files.push(...attachments.map((file, index) => ({ ...file, path: index === 0 ? '01-实名名册.xlsx' : file.path === '归档说明.md' ? '01-名册归档说明.md' : file.path })))
    files.push({ path: '01-私密附件目录.json', data: new TextEncoder().encode(JSON.stringify({
      roster: archive.rosterRef,
      photos: roster.members.flatMap(member => member.photos.map(photo => ({ workerId: member.workerId, assetId: photo.id, purpose: photo.purpose, state: photo.state, sha256: photo.sha256, path: photo.state === 'available' ? workerRosterPhotoPath(roster, member.workerId, photo.id, photo.mimeType) : null }))),
    }, null, 2)) })
    await assertPayrollWorkbookRoster(archive, await readers.roster.archive(archive.input.projectId, archive.rosterRef.id))
  }
  const fresh = await readers.archive()
  assertPayrollWorkbookRead(fresh, archive, includePrivate)
  const { context: _context, ...manifest } = archive
  files.unshift({ path: '00-保存目录.json', data: new TextEncoder().encode(JSON.stringify({ ...manifest, includedPrivateAttachments: includePrivate, ...(archive.migration ? { migrationNotice: '本目录经受控迁入。manifestHash 与迁入名册引用的原摘要标识原始归档；本代身份已映射，不能把这些摘要解释为当前映射 JSON 的摘要。' } : {}) }, null, 2)) })
  return files
}

export async function createPayrollSavedArchive(archive: PayrollWorkbookArchive, includePrivate: boolean, readers: WorkbookExportReaders): Promise<ExportFileOptions> {
  const files = await createPayrollSavedArchiveFiles(archive, includePrivate, readers)
  return { data: createZip(files), defaultName: `工资归档-${archive.input.mode === 'leader-cycle' ? '全周期' : '按月'}-版本${archive.version}-${archive.manifestHash}.zip`, mimeType: 'application/zip' }
}
