import type { ExportFileOptions } from '../kit/export'
import type { ProjectArchiveZipFile } from '../project/archive'
import type { PayrollAFrozenDocument } from './central-a-contract'
import type { PayrollActualLedgerRead } from './central-actual-contract'
import type { PayrollC1FrozenDocument } from './central-c1-contract'
import type { PayrollC2FrozenDocument } from './central-c2-contract'
import type { PayrollStatementRow } from './central-contract'
import type { PayrollWorkbookArchive } from './central-workbook-contract'
import * as XLSX from 'xlsx'
import { createZip } from '../project/archive'
import { createPayrollAWorkbook } from './a-export'
import { createPayrollC1Workbook } from './c1-export'
import { createPayrollC2Workbook } from './c2-export'
import { payrollWorkbookBookLabel } from './workbook-subject'

export { payrollWorkbookSubjectKey, payrollWorkbookSubjectLabel } from './workbook-subject'

export type PayrollFrozenDocument = PayrollAFrozenDocument | PayrollC1FrozenDocument | PayrollC2FrozenDocument
export interface PayrollWorkbookEntry { row: PayrollStatementRow, document: PayrollFrozenDocument }
export interface PayrollWorkbookGroup { key: string, label: string, entries: PayrollWorkbookEntry[], actualLedger: PayrollActualLedgerRead }
export interface PayrollWorkbookGap { statementId: string, month: string, formatFamily: string, reason: string }
export type PayrollWorkbookPublication = Pick<PayrollWorkbookArchive, 'id' | 'version' | 'createdAt' | 'manifestHash' | 'issues' | 'rosterRef' | 'deliveryGaps'>

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ZIP_MIME = 'application/zip'
const numberStatus = '未正式出具（须在正式编号页面核对出具）'
const rosterStatus = '未选择独立有日期的名册归档版本'

function safeSegment(value: string): string {
  const printable = Array.from(value, character => character.charCodeAt(0) < 32 ? '-' : character).join('')
  return printable.trim().replace(/[<>:"/\\|?*]+/g, '-').replace(/[.\s]+$/g, '').slice(0, 120) || '未命名'
}

function bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function statementWorkbook(document: PayrollFrozenDocument): ArrayBuffer {
  const output = document.formatFamily === 'A'
    ? createPayrollAWorkbook(document)
    : document.formatFamily === 'C1'
      ? createPayrollC1Workbook(document)
      : createPayrollC2Workbook(document)
  if (typeof output.data === 'function' || typeof output.data === 'string')
    throw new TypeError('冻结工资工作簿必须同步生成二进制正文')
  return output.data instanceof Uint8Array
    ? output.data.buffer.slice(output.data.byteOffset, output.data.byteOffset + output.data.byteLength) as ArrayBuffer
    : output.data
}

function periodLabel(document: PayrollFrozenDocument): string {
  return document.periodKind === 'settlement' ? '结算' : document.periodKind === 'retention' ? '尾款' : '月度'
}

function uniqueSheetName(raw: string, used: Set<string>): string {
  const cleaned = raw.replace(/[[\]:*?/\\]+/g, '-').trim() || '原表'
  let sequence = 1
  let name = cleaned.slice(0, 31)
  while (used.has(name.toLocaleLowerCase())) {
    sequence += 1
    const suffix = `~${sequence}`
    name = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`
  }
  used.add(name.toLocaleLowerCase())
  return name
}

function sumAmounts(values: readonly (number | null)[]): number | null {
  let cents = 0
  for (const value of values) {
    if (value === null || !Number.isFinite(value))
      return null
    const next = Math.round(value * 100)
    if (!Number.isSafeInteger(next) || !Number.isSafeInteger(cents + next))
      return null
    cents += next
  }
  return cents / 100
}

function cycleFormulaDue(entries: PayrollWorkbookEntry[]): { value: number | null, basis: string } {
  if (!entries.length)
    return { value: null, basis: '没有可用冻结工资' }
  const aEntries = entries.filter((entry): entry is PayrollWorkbookEntry & { document: PayrollAFrozenDocument } => entry.document.formatFamily === 'A')
  if (aEntries.length === entries.length) {
    const latest = [...aEntries].sort((left, right) => `${left.document.month}:${left.document.releasedAt}`.localeCompare(`${right.document.month}:${right.document.releasedAt}`)).at(-1)!
    const reconciliation = latest.document.adjustmentReconciliation?.effectiveCumulative
    return reconciliation
      ? { value: reconciliation.state === 'known' ? sumAmounts([reconciliation.value]) : null, basis: `A 最新冻结累计口径；${reconciliation.state}` }
      : { value: sumAmounts([latest.document.cumulativeAmount]), basis: 'A 最新冻结累计应付，不逐月重复相加' }
  }
  return { value: sumAmounts(entries.map(entry => entry.document.grossAmount)), basis: 'C1/C2 各独立期间核算应发合计' }
}

function actualRows(ledger: PayrollActualLedgerRead) {
  return ledger.rows.map(row => ({
    实际事实身份: row.identity,
    类型: row.kind,
    发生日期: row.occurredOn,
    原工资身份: row.originalStatementIds.join('、'),
    金额状态: row.signedAmount.state,
    净额: row.signedAmount.value,
    已知部分: row.signedAmount.knownValue,
    资格: row.qualification,
    分配状态: row.allocationState,
    诊断: row.diagnostics.map(item => item.message).join('；'),
  }))
}

function createWorkbook(group: PayrollWorkbookGroup, gaps: PayrollWorkbookGap[], mode: 'cycle' | 'month', publication?: PayrollWorkbookPublication): ExportFileOptions {
  if (!group.entries.length)
    throw new RangeError('完整工资工作簿至少需要一份可用冻结工资')
  const book = XLSX.utils.book_new()
  const reconciliationSheet = mode === 'month' ? '月度对账' : '周期对账'
  const used = new Set<string>(['目录', reconciliationSheet, '实际收付', '缺口清单', '交付缺口', '保存目录'])
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[]]), '目录')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[]]), reconciliationSheet)
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(actualRows(group.actualLedger)), '实际收付')
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(gaps.map(gap => ({ 工资身份: gap.statementId, 月份: gap.month, 格式: gap.formatFamily, 缺口: gap.reason }))), '缺口清单')

  if (publication) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(publication.deliveryGaps.map(gap => ({ 类型: gap.kind, 工资身份: gap.statementId, 缺口: gap.reason }))), '交付缺口')
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 目录身份: publication.id, 版本: publication.version, 保存时点: publication.createdAt, 目录摘要: publication.manifestHash, 名册归档身份: publication.rosterRef?.id, 名册版本: publication.rosterRef?.version, 名册登记日期: publication.rosterRef?.registeredOn, 名册正文摘要: publication.rosterRef?.contentHash, 说明: '实际收付按目录保存时点固定；后来退款或资料补充进入新目录版本，保存成功不代表文件已下载。' }]), '保存目录')
  }
  const directory = group.entries.map((entry, index) => {
    const issue = publication?.issues.find(issue => issue.statementId === entry.document.id)
    const source = XLSX.read(statementWorkbook(entry.document), { type: 'array' })
    const sheetNames: string[] = []
    for (const sourceName of source.SheetNames) {
      const name = uniqueSheetName(`${String(index + 1).padStart(2, '0')}_${entry.document.formatFamily}_${sourceName}`, used)
      XLSX.utils.book_append_sheet(book, source.Sheets[sourceName]!, name)
      sheetNames.push(name)
    }
    return {
      顺序: index + 1,
      稳定工资身份: entry.document.id,
      正式编号: issue?.number ?? numberStatus,
      出具记录: issue?.id,
      原件摘要: issue?.documentHash,
      名册归档身份: publication?.rosterRef?.id,
      名册版本: publication?.rosterRef?.version,
      名册登记日期: publication?.rosterRef?.registeredOn,
      项目: entry.document.projectName,
      月份: entry.document.month,
      负责人: entry.document.leaderName,
      格式与请款簿: payrollWorkbookBookLabel(entry.row),
      档位: periodLabel(entry.document),
      本单核算应发: entry.document.grossAmount,
      冻结实际发放: entry.document.actualAmount,
      本单差额: sumAmounts([entry.document.grossAmount, -entry.document.actualAmount]),
      原表页签: sheetNames.join('、'),
    }
  })
  const complete = gaps.length === 0
  const delivered = complete && (!publication || publication.deliveryGaps.length === 0)
  const due = !complete
    ? { value: null, basis: '所选范围存在冻结工资缺口，公式合计不可判定' }
    : mode === 'month'
      ? { value: sumAmounts(group.entries.map(entry => entry.document.grossAmount)), basis: '本月各张原单本次核算合计；不代表周期新增债务' }
      : cycleFormulaDue(group.entries)
  const actual = group.actualLedger.netAmount.state === 'known' ? sumAmounts([group.actualLedger.netAmount.value]) : null
  const difference = due.value !== null && actual !== null ? sumAmounts([due.value, -actual]) : null
  book.Sheets['目录'] = XLSX.utils.json_to_sheet(directory)
  book.Sheets[reconciliationSheet] = XLSX.utils.json_to_sheet([{
    输出范围: group.label,
    输出完整性: !complete ? '部分（存在冻结工资缺口）' : delivered ? '完整' : '部分（存在交付缺口）',
    工资份数: group.entries.length,
    公式应付: due.value,
    公式口径: due.basis,
    净实际: actual,
    实际口径: '本册原工资范围的已确认收付净额，含可追溯后续补退',
    实际状态: group.actualLedger.netAmount.state,
    差额: difference,
    对账结论: difference !== null ? '可计算' : '不可判定',
    正式编号: publication ? group.entries.map(entry => publication.issues.find(issue => issue.statementId === entry.document.id)?.number ?? '未正式出具').join('、') : numberStatus,
    实名名册及照片: publication?.rosterRef ? `独立名册 ${publication.rosterRef.registeredOn} / 版本 ${publication.rosterRef.version}；照片按固定版本受权读取` : rosterStatus,
    保存时点: publication?.createdAt,
    缺口数量: gaps.length,
  }])
  const data = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const suffix = `-${delivered ? '完整' : '部分'}工资工作簿-${publication?.manifestHash ?? '未正式出具'}.xlsx`
  // ZIP paths cap each segment at 120 characters; reserve the stable hash and extension.
  return { data, defaultName: `${safeSegment(group.label).slice(0, 120 - suffix.length)}${suffix}`, mimeType: XLSX_MIME }
}

export function createPayrollCompleteWorkbook(group: PayrollWorkbookGroup, gaps: PayrollWorkbookGap[] = [], publication?: PayrollWorkbookPublication): ExportFileOptions {
  return createWorkbook(group, gaps, 'cycle', publication)
}

function archiveReadme(projectName: string, groups: PayrollWorkbookGroup[], gaps: PayrollWorkbookGap[], publication?: PayrollWorkbookPublication): string {
  const lines = [
    `# ${projectName} 工资归档说明`,
    '',
    `- 生成范围：${groups.map(group => `${group.label}（${group.entries.length} 份）`).join('；') || '无可用工资'}`,
    `- 正式编号：${publication ? publication.issues.map(issue => `${issue.statementId} → ${issue.number}`).join('；') || '未正式出具' : numberStatus}。`,
    `- 实名名册及证件原件：${publication?.rosterRef ? `${publication.rosterRef.id} / 版本 ${publication.rosterRef.version} / 登记日 ${publication.rosterRef.registeredOn}` : rosterStatus}。`,
    ...(publication ? [`- 目录身份：${publication.id} / 版本 ${publication.version}；保存时点 ${publication.createdAt}；摘要 ${publication.manifestHash}。`, '- 实际收付保持此目录保存时点；新退款须重新预览并另存目录版本。保存目录不代表下载成功。', ...publication.deliveryGaps.map(gap => `- 交付缺口：${gap.reason}`)] : []),
    '- 工资原表来自发放时冻结正文；A、C1、C2 分别保留原有工资/考勤/签工页签。',
    '- 月度对账合计各张原单本次核算，不代表周期新增债务；净实际只取这些原单范围的已确认收付，包含可追溯的后续补退。A 的跨月累计只在负责人全周期一册按最新冻结依据计算。',
    '- 未知金额保持未知；缺失输出不会生成零值替代表。有冻结缺口的月份只生成“部分工资工作簿”，公式合计与对账结论保持不可判定。',
    '',
    '## 缺口',
    '',
    ...(gaps.length ? gaps.map(gap => `- ${gap.month} / ${gap.formatFamily} / ${gap.statementId}：${gap.reason}`) : ['- 无冻结工资缺口；独立名册和交付缺口仍按上文保留。']),
    '',
  ]
  return lines.join('\n')
}

export function createPayrollMonthlyArchiveFiles(projectName: string, groups: PayrollWorkbookGroup[], gaps: PayrollWorkbookGap[], publication?: PayrollWorkbookPublication): ProjectArchiveZipFile[] {
  if (!groups.some(group => group.entries.length))
    throw new RangeError('按月工资归档至少需要一份可用冻结工资')
  const files: ProjectArchiveZipFile[] = [{ path: '00-归档说明.md', data: new TextEncoder().encode(archiveReadme(projectName, groups, gaps, publication)), mimeType: 'text/markdown;charset=utf-8' }]
  for (const group of groups) {
    const output = createWorkbook(group, gaps.filter(gap => gap.month === group.key), 'month', publication)
    if (typeof output.data === 'function' || typeof output.data === 'string')
      throw new TypeError('按月工作簿必须同步生成二进制正文')
    files.push({ path: `${safeSegment(group.key)}/${output.defaultName}`, data: bytes(output.data), mimeType: XLSX_MIME })
  }
  return files
}

export function createPayrollMonthlyArchive(projectName: string, groups: PayrollWorkbookGroup[], gaps: PayrollWorkbookGap[], publication?: PayrollWorkbookPublication): ExportFileOptions {
  return { data: createZip(createPayrollMonthlyArchiveFiles(projectName, groups, gaps, publication)), defaultName: `${safeSegment(projectName)}-按月工资归档-${publication?.manifestHash ?? '未正式出具'}.zip`, mimeType: ZIP_MIME }
}
