import type { ExportFileOptions } from '../kit/export'
import type { ProjectArchiveZipFile } from '../project/archive'
import type { WorkerRosterArchive, WorkerRosterFile, WorkerRosterRepository } from './contract'
import * as XLSX from 'xlsx'
import { createZip } from '../project/archive'
import { decodeRosterArchive } from './codec'

const STATUS = { 'present': '在场', 'left': '已退场', 'not-entered': '未进场', 'unknown': '未知' }
export function workerRosterFilename(document: WorkerRosterArchive): string {
  return `工人名册_${document.scope.registeredOn}_v${document.version}_${document.id}`
}
export function workerRosterPhotoPath(document: WorkerRosterArchive, workerId: string, assetId: string, mimeType: string): string {
  const memberIndex = document.members.findIndex(member => member.workerId === workerId)
  const photoIndex = document.members[memberIndex]?.photos.findIndex(photo => photo.id === assetId) ?? -1
  if (memberIndex < 0 || photoIndex < 0)
    throw new Error('照片不属于这份冻结名册')
  // Frozen ordinals keep Windows paths short and safe; full identities remain in the workbook/manifest.
  return `photos/member-${memberIndex + 1}/photo-${photoIndex + 1}.${mimeType === 'image/png' ? 'png' : 'jpg'}`
}
export function createWorkerRosterWorkbook(document: WorkerRosterArchive): ExportFileOptions {
  decodeRosterArchive(document, document.scope.projectId, document.id)
  const book = XLSX.utils.book_new()
  const headers = ['工人身份', '姓名（登记时）', '姓名（原工资）', '负责人', '性别', '籍贯', '身份证号', '联系电话', '开户行', '银行账号', '联行号', '进场日期', '退场日期', '登记日在场情况', '劳动合同签订情况', '签订日期', '证件照路径', '银行卡照路径', '工人资料版本', '工资身份', '资料缺口']
  const rows = document.members.map((member) => {
    const photo = (purpose: string) => {
      const item = member.photos.find(photo => photo.purpose === purpose)
      return item?.state === 'available' ? workerRosterPhotoPath(document, member.workerId, item.id, item.mimeType) : '缺正文或未关联'
    }
    const signed = member.values.laborContractSigned === null ? '未记录' : member.values.laborContractSigned ? '已签订' : '未签订'
    return [member.workerId, member.profile?.name ?? '资料不可用', member.payrollNames.join(' / '), member.isLeader ? '是' : '否', member.profile?.gender ?? '', member.profile?.hometown ?? '', member.profile?.idCard ?? '', member.profile?.phone ?? '', member.profile?.bankName ?? '', member.profile?.bankAccount ?? '', member.profile?.bankCode ?? '', member.profile?.entryDate ?? '', member.profile?.exitDate ?? '', STATUS[member.siteStatus], signed, member.values.laborContractSignedOn ?? '', photo('portrait'), photo('bank-card'), member.revision, member.statementIds.join(' / '), member.diagnostics.join('；')]
  })
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = headers.map((_label, index) => ({ wch: [0, 6, 9, 16, 17, 19, 20].includes(index) ? 34 : 18 }))
  XLSX.utils.book_append_sheet(book, sheet, '实名名册')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['项目', document.projectName],
    ['项目身份', document.scope.projectId],
    ['归档身份', document.id],
    ['版本', document.version],
    ['资料登记日期', document.scope.registeredOn],
    ['实际归档时间', document.createdAt],
    ['性质', '独立有日期的资料补充；不证明原工资发放时已有这些资料'],
    ['所选工资', document.scope.statementIds.join(' / ')],
    ['在场', document.counts.present],
    ['已退场', document.counts.left],
    ['未进场', document.counts.notEntered],
    ['状态未知', document.counts.unknown],
    ...document.diagnostics.map(message => ['说明', message]),
  ]), '归档说明')
  return { data: XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, defaultName: `${workerRosterFilename(document)}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
export async function workerRosterFileBytes(file: WorkerRosterFile): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(file.payloadBase64), character => character.charCodeAt(0))
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  if (file.asset.state !== 'available' || bytes.length !== file.asset.fileSize || digest !== file.asset.sha256)
    throw new Error('归档照片原件长度或摘要不一致，下载已停止')
  return bytes
}
/** Only frozen archive members and photo identities are passed to the authorized reader. */
export async function createWorkerRosterArchiveFiles(document: WorkerRosterArchive, read: WorkerRosterRepository['file']): Promise<ProjectArchiveZipFile[]> {
  const workbook = createWorkerRosterWorkbook(document)
  const files: ProjectArchiveZipFile[] = [{ path: workbook.defaultName, data: new Uint8Array(workbook.data as ArrayBuffer) }]
  const seen = new Set<string>()
  for (const member of document.members) {
    for (const photo of member.photos.filter(photo => photo.state === 'available')) {
      const path = workerRosterPhotoPath(document, member.workerId, photo.id, photo.mimeType)
      if (seen.has(path))
        continue
      const original = await read({ projectId: document.scope.projectId, archiveId: document.id, workerId: member.workerId, assetId: photo.id })
      if (original.asset.id !== photo.id || original.asset.workerId !== member.workerId || original.asset.sha256 !== photo.sha256)
        throw new Error('归档照片身份与冻结版本不符')
      files.push({ path, data: await workerRosterFileBytes(original) })
      seen.add(path)
    }
  }
  files.push({ path: '归档说明.md', data: new TextEncoder().encode(`# 工人名册归档\n\n归档身份：${document.id}\n\n项目：${document.projectName}\n\n资料登记日期：${document.scope.registeredOn}；实际归档：${document.createdAt}；版本：${document.version}\n\n本包是独立日期的资料补充，不证明原工资发放时已保存这些资料。名册中的缺口不作齐全证明。照片路径按工人和原件身份区分，同名人员不合并。\n\n${document.members.flatMap(member => member.photos.map(photo => `- ${member.workerId} / ${photo.purpose} / ${photo.id}：${photo.state}；SHA-256 ${photo.sha256 ?? '缺失'}`)).join('\n')}\n`) })
  return files
}
export async function createWorkerRosterArchiveZip(document: WorkerRosterArchive, read: WorkerRosterRepository['file']): Promise<Uint8Array> {
  return createZip(await createWorkerRosterArchiveFiles(document, read))
}
