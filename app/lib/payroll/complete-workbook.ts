import type { ExportFileOptions } from '../kit/export'
import type { ProjectArchiveZipFile } from '../project/archive'
import type { PayrollAFrozenDocument } from './central-a-contract'
import type { PayrollActualLedgerRead } from './central-actual-contract'
import type { PayrollC1FrozenDocument } from './central-c1-contract'
import type { PayrollC2FrozenDocument } from './central-c2-contract'
import type { PayrollStatementRow } from './central-contract'
import * as XLSX from 'xlsx'
import { createZip } from '../project/archive'
import { createPayrollAWorkbook } from './a-export'
import { createPayrollC1Workbook } from './c1-export'
import { createPayrollC2Workbook } from './c2-export'

export type PayrollFrozenDocument = PayrollAFrozenDocument | PayrollC1FrozenDocument | PayrollC2FrozenDocument
export interface PayrollWorkbookEntry { row: PayrollStatementRow, document: PayrollFrozenDocument }
export interface PayrollWorkbookGroup { key: string, label: string, entries: PayrollWorkbookEntry[], actualLedger: PayrollActualLedgerRead }
export interface PayrollWorkbookGap { statementId: string, month: string, formatFamily: string, reason: string }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ZIP_MIME = 'application/zip'
const numberStatus = '未分配（正式发号时点与旧号接续待业务裁定）'
const rosterStatus = '未归档（完整字段与两类照片的归档时点、最小授权待业务裁定）'

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

function bookLabel(row: PayrollStatementRow): string {
  if (row.formatFamily !== 'A')
    return row.formatFamily
  return row.book?.bookPurpose === 'management' ? `A·管理费簿·${row.book.managementBookId}` : row.book?.bookPurpose === 'ordinary' ? 'A·普通施工簿' : 'A·旧簿用途缺失'
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

function cycleFormulaDue(entries: PayrollWorkbookEntry[]): { value: number | null, basis: string } {
  if (!entries.length)
    return { value: null, basis: '没有可用冻结工资' }
  const aEntries = entries.filter((entry): entry is PayrollWorkbookEntry & { document: PayrollAFrozenDocument } => entry.document.formatFamily === 'A')
  if (aEntries.length === entries.length) {
    const latest = [...aEntries].sort((left, right) => `${left.document.month}:${left.document.releasedAt}`.localeCompare(`${right.document.month}:${right.document.releasedAt}`)).at(-1)!
    const reconciliation = latest.document.adjustmentReconciliation?.effectiveCumulative
    return reconciliation
      ? { value: reconciliation.state === 'known' ? reconciliation.value : null, basis: `A 最新冻结累计口径；${reconciliation.state}` }
      : { value: latest.document.cumulativeAmount, basis: 'A 最新冻结累计应付，不逐月重复相加' }
  }
  return { value: entries.reduce((sum, entry) => sum + entry.document.grossAmount, 0), basis: 'C1/C2 各独立期间核算应发合计' }
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

export function createPayrollCompleteWorkbook(group: PayrollWorkbookGroup, gaps: PayrollWorkbookGap[] = []): ExportFileOptions {
  if (!group.entries.length)
    throw new RangeError('完整工资工作簿至少需要一份可用冻结工资')
  const book = XLSX.utils.book_new()
  const used = new Set<string>(['目录', '周期对账', '实际收付', '缺口清单'])
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[]]), '目录')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[]]), '周期对账')
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(actualRows(group.actualLedger)), '实际收付')
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(gaps.map(gap => ({ 工资身份: gap.statementId, 月份: gap.month, 格式: gap.formatFamily, 缺口: gap.reason }))), '缺口清单')

  const directory = group.entries.map((entry, index) => {
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
      正式编号: numberStatus,
      项目: entry.document.projectName,
      月份: entry.document.month,
      负责人: entry.document.leaderName,
      格式与请款簿: bookLabel(entry.row),
      档位: periodLabel(entry.document),
      本单核算应发: entry.document.grossAmount,
      冻结实际发放: entry.document.actualAmount,
      本单差额: entry.document.grossAmount - entry.document.actualAmount,
      原表页签: sheetNames.join('、'),
    }
  })
  const due = cycleFormulaDue(group.entries)
  const actual = group.actualLedger.netAmount.state === 'known' ? group.actualLedger.netAmount.value : null
  book.Sheets['目录'] = XLSX.utils.json_to_sheet(directory)
  book.Sheets['周期对账'] = XLSX.utils.json_to_sheet([{
    输出范围: group.label,
    工资份数: group.entries.length,
    公式应付: due.value,
    公式口径: due.basis,
    净实际: actual,
    实际状态: group.actualLedger.netAmount.state,
    差额: due.value !== null && actual !== null ? due.value - actual : null,
    正式编号: numberStatus,
    实名名册及照片: rosterStatus,
    缺口数量: gaps.length,
  }])
  const data = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return { data, defaultName: `${safeSegment(group.label)}-完整工资工作簿-编号待定.xlsx`, mimeType: XLSX_MIME }
}

function archiveReadme(projectName: string, groups: PayrollWorkbookGroup[], gaps: PayrollWorkbookGap[]): string {
  const lines = [
    `# ${projectName} 工资归档说明`,
    '',
    `- 生成范围：${groups.map(group => `${group.label}（${group.entries.length} 份）`).join('；') || '无可用工资'}`,
    `- 正式编号：${numberStatus}。当前文件名使用稳定工资身份消歧，不冒充官方编号。`,
    `- 实名名册及证件原件：${rosterStatus}。`,
    '- 工资原表来自发放时冻结正文；A、C1、C2 分别保留原有工资/考勤/签工页签。',
    '- 未知金额保持未知；缺失输出不会生成零值替代表。',
    '',
    '## 缺口',
    '',
    ...(gaps.length ? gaps.map(gap => `- ${gap.month} / ${gap.formatFamily} / ${gap.statementId}：${gap.reason}`) : ['- 无冻结工资缺口；编号和实名名册边界仍按上文保留。']),
    '',
  ]
  return lines.join('\n')
}

export function createPayrollMonthlyArchive(projectName: string, groups: PayrollWorkbookGroup[], gaps: PayrollWorkbookGap[]): ExportFileOptions {
  if (!groups.some(group => group.entries.length))
    throw new RangeError('按月工资归档至少需要一份可用冻结工资')
  const files: ProjectArchiveZipFile[] = [{ path: '00-归档说明.md', data: new TextEncoder().encode(archiveReadme(projectName, groups, gaps)), mimeType: 'text/markdown;charset=utf-8' }]
  for (const group of groups) {
    const output = createPayrollCompleteWorkbook(group, gaps.filter(gap => gap.month === group.key))
    if (typeof output.data === 'function' || typeof output.data === 'string')
      throw new TypeError('按月工作簿必须同步生成二进制正文')
    files.push({ path: `${safeSegment(group.key)}/${safeSegment(group.label)}-完整工资工作簿-编号待定.xlsx`, data: bytes(output.data), mimeType: XLSX_MIME })
  }
  return { data: createZip(files), defaultName: `${safeSegment(projectName)}-按月工资归档-编号待定.zip`, mimeType: ZIP_MIME }
}

export function payrollWorkbookSubjectKey(row: PayrollStatementRow): string {
  const book = row.formatFamily === 'A' ? `${row.book?.bookPurpose ?? 'unknown'}:${row.book?.managementBookId ?? ''}` : row.formatFamily
  return [row.projectId, row.leaderWorkerId, row.formatFamily, book].join(':')
}

export function payrollWorkbookSubjectLabel(row: PayrollStatementRow): string {
  return `${row.projectName || row.projectId}-${row.leaderName || row.leaderWorkerId}-${bookLabel(row)}`
}
