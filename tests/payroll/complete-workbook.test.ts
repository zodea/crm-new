import type { PayrollActualLedgerRead } from '~/lib/payroll/central-actual-contract'
import type { PayrollStatementRow } from '~/lib/payroll/central-contract'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollCompleteWorkbook, createPayrollMonthlyArchive } from '~/lib/payroll/complete-workbook'
import { payrollUiDocument } from '../helpers/payroll-a-ui-fixture'
import { c1Frozen } from '../helpers/payroll-c1-ui'
import { c2Frozen } from '../helpers/payroll-c2-ui'

function row(document: ReturnType<typeof payrollUiDocument> | ReturnType<typeof c1Frozen> | ReturnType<typeof c2Frozen>, patch: Partial<PayrollStatementRow> = {}): PayrollStatementRow {
  return {
    id: document.id,
    recordKind: 'central',
    legacyId: null,
    projectId: document.projectId,
    projectName: document.projectName,
    crewId: 'crewId' in document ? document.crewId : null,
    crewName: document.crewName,
    leaderWorkerId: 'leader',
    leaderName: document.leaderName,
    subjectConfigId: null,
    month: document.month,
    formatFamily: document.formatFamily,
    periodKind: document.periodKind,
    purpose: '',
    quantitySource: '',
    status: 'released',
    needsRecheck: false,
    payRatio: document.payRatio,
    cumulativeAmount: document.formatFamily === 'A' ? document.cumulativeAmount : null,
    previouslyPaid: document.formatFamily === 'A' ? document.previouslyPaid : null,
    grossAmount: document.grossAmount,
    actualAmount: document.actualAmount,
    checkedAt: null,
    releasedAt: document.releasedAt,
    submittedAt: null,
    updatedAt: null,
    deletedAt: null,
    hidden: false,
    sourceVersion: 'row-v1',
    note: null,
    snapshot: { state: 'complete', raw: '{}', originalRaw: null, data: {}, issues: [] },
    ...patch,
  }
}

function ledger(statementIds: string[], value: number): PayrollActualLedgerRead {
  return {
    context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'actual-v1', capabilities: ['payroll:read'], readonly: false },
    scope: { projectId: 'project', originalStatementIds: statementIds },
    sourceVersion: 'actual-v1',
    status: 'complete',
    rows: [],
    netAmount: { value, knownValue: value, state: 'known', reasons: [] },
    diagnostics: [],
  }
}

function zipEntries(data: Uint8Array): { name: string, data: Uint8Array }[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  const entries: { name: string, data: Uint8Array }[] = []
  let offset = 0
  while (offset + 30 <= data.length && view.getUint32(offset, true) === 0x04034B50) {
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const start = offset + 30 + nameLength + extraLength
    entries.push({ name: decoder.decode(data.subarray(offset + 30, offset + 30 + nameLength)), data: data.slice(start, start + size) })
    offset = start + size
  }
  return entries
}

describe('完整工资工作簿与按月归档', () => {
  it('按月合计各张 A 单本次核算，不拿全月最后一张累计代替多名负责人与管理簿', () => {
    const documents = [
      { ...payrollUiDocument(), id: 'ordinary-one', leaderName: '同名负责人', cumulativeAmount: 1600, previouslyPaid: 800, grossAmount: 800, actualAmount: 700 },
      { ...payrollUiDocument(), id: 'ordinary-two', leaderName: '同名负责人', cumulativeAmount: 900, previouslyPaid: 600, grossAmount: 300, actualAmount: 250 },
      { ...payrollUiDocument(), id: 'management-one', leaderName: '同名负责人', cumulativeAmount: 550, previouslyPaid: 350, grossAmount: 200, actualAmount: 180 },
    ]
    const entries = documents.map((document, index) => ({ row: row(document, { leaderWorkerId: index === 1 ? 'leader-two' : 'leader-one', book: index === 2 ? { bookPurpose: 'management' as const, managementBookId: 'management-one' } : { bookPurpose: 'ordinary' as const, managementBookId: null } }), document }))
    const output = createPayrollMonthlyArchive('真实项目', [{ key: '2026-09', label: '真实项目-2026-09', entries, actualLedger: ledger(documents.map(document => document.id), 1130) }], [])
    const files = zipEntries(output.data as Uint8Array)
    const book = XLSX.read(files[1]!.data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json((book.Sheets.月度对账 ?? book.Sheets.周期对账)!)).toEqual([expect.objectContaining({ 公式应付: 1300, 净实际: 1130, 差额: 170, 公式口径: expect.stringContaining('各张原单本次核算') })])
    expect(XLSX.utils.sheet_to_json(book.Sheets.目录!).map(item => (item as { 稳定工资身份: string }).稳定工资身份)).toEqual(['ordinary-one', 'ordinary-two', 'management-one'])
    expect(book.SheetNames.filter(name => name.includes('发放汇总'))).toHaveLength(3)
    expect(book.SheetNames).not.toContain('周期对账')
  })

  it('同一 A 的月核算与周期累计分别对账，混入 C1/C2 不改变 A 的月口径', () => {
    const first = { ...payrollUiDocument(), id: 'a-first', month: '2026-08', cumulativeAmount: 1000, grossAmount: 1000, actualAmount: 800 }
    const second = { ...payrollUiDocument(), id: 'a-second', month: '2026-09', cumulativeAmount: 1600, previouslyPaid: 800, grossAmount: 800, actualAmount: 700 }
    const c1 = { ...c1Frozen(), id: 'c1-mixed', month: '2026-09', grossAmount: 0.1, actualAmount: 0.1 }
    const c2 = { ...c2Frozen(), id: 'c2-mixed', month: '2026-09', grossAmount: 0.2, actualAmount: 0.2 }
    const documents = [second, c1, c2]
    const output = createPayrollMonthlyArchive('真实项目', [
      { key: '2026-08', label: '真实项目-2026-08', entries: [{ row: row(first), document: first }], actualLedger: ledger(['a-first'], 800) },
      { key: '2026-09', label: '真实项目-2026-09', entries: documents.map(document => ({ row: row(document), document })), actualLedger: ledger(documents.map(document => document.id), 700.3) },
    ], [])
    const files = zipEntries(output.data as Uint8Array)
    const august = XLSX.read(files[1]!.data, { type: 'array' })
    const september = XLSX.read(files[2]!.data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(august.Sheets.月度对账!)).toEqual([expect.objectContaining({ 公式应付: 1000, 净实际: 800, 差额: 200 })])
    expect(XLSX.utils.sheet_to_json(september.Sheets.月度对账!)).toEqual([expect.objectContaining({ 公式应付: 800.3, 净实际: 700.3, 差额: 100 })])
    expect(new TextDecoder().decode(files[0]!.data)).toContain('不代表周期新增债务')
  })

  it('已知小数金额按分相加和相减，未知实际保持空值而非零', () => {
    const first = { ...c1Frozen(), id: 'c1-first', grossAmount: 0.1, actualAmount: 0.1 }
    const second = { ...c1Frozen(), id: 'c1-second', grossAmount: 0.2, actualAmount: 0.1 }
    const group = { key: 'leader-c1', label: '负责人-C1', entries: [first, second].map(document => ({ row: row(document), document })), actualLedger: ledger(['c1-first', 'c1-second'], 0.2) }
    const book = XLSX.read(createPayrollCompleteWorkbook(group).data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(book.Sheets.周期对账!)).toEqual([expect.objectContaining({ 公式应付: 0.3, 净实际: 0.2, 差额: 0.1 })])
    group.actualLedger.netAmount = { state: 'partial', value: null, knownValue: 0.1, reasons: ['一笔原实际金额待核'] }
    const unknown = XLSX.read(createPayrollCompleteWorkbook(group).data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(unknown.Sheets.周期对账!, { defval: null })).toEqual([expect.objectContaining({ 公式应付: 0.3, 净实际: null, 差额: null, 对账结论: '不可判定' })])
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('不把不可用的历史公式金额 %s 算成零或可计算结论', (grossAmount) => {
    const document = { ...c1Frozen(), grossAmount }
    const output = createPayrollMonthlyArchive('真实项目', [{ key: document.month, label: '历史缺损月份', entries: [{ row: row(document), document }], actualLedger: ledger([document.id], document.actualAmount) }], [])
    const file = zipEntries(output.data as Uint8Array)[1]!
    const book = XLSX.read(file.data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(book.Sheets.月度对账!, { defval: null })).toEqual([expect.objectContaining({ 公式应付: null, 差额: null, 对账结论: '不可判定' })])
  })

  it('公式与实际各自可表示但差额超出安全分值时，不宣称可计算', () => {
    const amount = 50_000_000_000_000
    const document = { ...c1Frozen(), grossAmount: amount }
    const output = createPayrollCompleteWorkbook({ key: 'overflow', label: '差额超过安全分值', entries: [{ row: row(document), document }], actualLedger: ledger([document.id], -amount) })
    const book = XLSX.read(output.data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(book.Sheets.周期对账!, { defval: null })).toEqual([expect.objectContaining({ 公式应付: amount, 净实际: -amount, 差额: null, 对账结论: '不可判定' })])
  })

  it('a 全周期用最新累计应付对账，不把 1000 与 1600 重复相加', () => {
    const first = { ...payrollUiDocument(), id: 'a-first', month: '2026-08', cumulativeAmount: 1000, grossAmount: 1000, actualAmount: 800 }
    const second = { ...payrollUiDocument(), id: 'a-second', month: '2026-09', cumulativeAmount: 1600, previouslyPaid: 800, grossAmount: 800, actualAmount: 700 }
    const output = createPayrollCompleteWorkbook({ key: 'leader', label: '项目-负责人-A普通簿', entries: [{ row: row(first, { book: { bookPurpose: 'ordinary', managementBookId: null } }), document: first }, { row: row(second, { book: { bookPurpose: 'ordinary', managementBookId: null } }), document: second }], actualLedger: ledger(['a-first', 'a-second'], 1500) })
    const book = XLSX.read(output.data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(book.Sheets.周期对账!)).toEqual([expect.objectContaining({ 公式应付: 1600, 净实际: 1500, 差额: 100, 正式编号: expect.stringContaining('待业务裁定') })])
    expect(XLSX.utils.sheet_to_json(book.Sheets.目录!)).toHaveLength(2)
    expect(book.SheetNames.filter(name => name.includes('发放汇总'))).toHaveLength(2)
  })

  it('按月 ZIP 真正创建月份目录；C1 保工资+考勤，C2 保工资+签工且没有考勤', () => {
    const c1 = { ...c1Frozen(), id: 'c1', projectId: 'project', projectName: '真实项目', month: '2026-08' }
    const c2 = { ...c2Frozen(), id: 'c2', projectId: 'project', projectName: '真实项目', month: '2026-09' }
    const output = createPayrollMonthlyArchive('真实项目', [
      { key: '2026-08', label: '真实项目-2026-08', entries: [{ row: row(c1), document: c1 }], actualLedger: ledger(['c1'], c1.actualAmount) },
      { key: '2026-09', label: '真实项目-2026-09', entries: [{ row: row(c2), document: c2 }], actualLedger: ledger(['c2'], c2.actualAmount) },
    ], [{ statementId: 'missing', month: '2026-09', formatFamily: 'A', reason: '旧工资缺冻结正文' }])
    const files = zipEntries(output.data as Uint8Array)
    expect(files.map(file => file.name)).toEqual(['00-归档说明.md', '2026-08/真实项目-2026-08-完整工资工作簿-编号待定.xlsx', '2026-09/真实项目-2026-09-部分工资工作簿-编号待定.xlsx'])
    const august = XLSX.read(files[1]!.data, { type: 'array' })
    const september = XLSX.read(files[2]!.data, { type: 'array' })
    expect(august.SheetNames).toEqual(expect.arrayContaining(['01_C1_工资表', '01_C1_考勤表']))
    expect(september.SheetNames).toEqual(expect.arrayContaining(['01_C2_工资表', '01_C2_签工表']))
    expect(september.SheetNames.some(name => name.includes('考勤'))).toBe(false)
    expect(XLSX.utils.sheet_to_json(september.Sheets.月度对账!)).toEqual([expect.objectContaining({ 输出完整性: '部分（存在冻结工资缺口）', 公式口径: '所选范围存在冻结工资缺口，公式合计不可判定', 对账结论: '不可判定' })])
    expect(new TextDecoder().decode(files[0]!.data)).toContain('实名名册及证件原件')
  })
})
