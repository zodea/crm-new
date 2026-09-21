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
    expect(files.map(file => file.name)).toEqual(['00-归档说明.md', '2026-08/真实项目-2026-08-完整工资工作簿-编号待定.xlsx', '2026-09/真实项目-2026-09-完整工资工作簿-编号待定.xlsx'])
    const august = XLSX.read(files[1]!.data, { type: 'array' })
    const september = XLSX.read(files[2]!.data, { type: 'array' })
    expect(august.SheetNames).toEqual(expect.arrayContaining(['01_C1_工资表', '01_C1_考勤表']))
    expect(september.SheetNames).toEqual(expect.arrayContaining(['01_C2_工资表', '01_C2_签工表']))
    expect(september.SheetNames.some(name => name.includes('考勤'))).toBe(false)
    expect(new TextDecoder().decode(files[0]!.data)).toContain('实名名册及证件原件')
  })
})
