import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollOfficialWorkbook, payrollOfficialFilename } from '~/lib/payroll/numbering-export'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'
import { createPayrollNumberingFixture, numberingCommand } from '../helpers/payroll-numbering-fixture'

it('正式单份Excel实际包含原号、原工资与冻结金额，重复输出不新增编号', async () => {
  const f = await createPayrollNumberingFixture()
  try {
    const initial = await f.read()
    expect(() => createPayrollOfficialWorkbook(initial)).toThrow()
    await f.initialize()
    await f.issue()
    const read = await f.read()
    const file = createPayrollOfficialWorkbook(read)
    const book = XLSX.read(file.data, { type: 'array' })
    const metadata = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['正式出具']!, { header: 1 })
    expect(metadata).toEqual(expect.arrayContaining([['正式工资编号', '128'], ['原工资身份', f.input.statementId], ['格式', 'C2'], ['原实际发放', 525], ['档位', '月度100%']]))
    expect(book.SheetNames).toContain('签工表')
    expect(book.SheetNames).not.toContain('考勤表')
    expect(XLSX.utils.sheet_to_json(book.Sheets['工资表']!, { header: 1 }).flat()).toContain(525)
    const second = createPayrollOfficialWorkbook(await f.read())
    expect(second.defaultName).toBe(file.defaultName)
    expect((await f.read()).settings?.nextNumber).toBe(129)
    expect(() => createPayrollOfficialWorkbook({ ...read, issue: { ...read.issue!, statementId: 'another-wage' } })).toThrow('正式')
    const long = { ...read, document: { ...read.document!, projectName: '很长的项目名称'.repeat(100), leaderName: '很长的负责人'.repeat(100) } }
    const name = payrollOfficialFilename(long)
    expect(name.length).toBeLessThan(180)
    expect(name).toContain(read.issue!.documentHash)
    expect(payrollOfficialFilename({ ...long, issue: { ...read.issue!, documentHash: 'b'.repeat(64) } })).not.toBe(name)
  }
  finally { await f.close() }
}, 30_000)

it('a正式文件保留原月度档位、累计口径、原分配和正式文字号', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const form = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    await f.service.execute(f.command(await form(), { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 1000 }] } }))
    const read = () => f.service.numbering({ origin: 'real' }, { projectId: f.draft.projectId, statementId: saved.statementId! })
    await f.service.executeNumbering(numberingCommand(await read(), 'a-start', { kind: 'initialize', nextNumber: 8, evidenceNote: '已核对纸质到7' }))
    await f.service.executeNumbering(numberingCommand(await read(), 'a-issue', { kind: 'issue' }))
    const file = createPayrollOfficialWorkbook(await read())
    const book = XLSX.read(file.data, { type: 'array' })
    expect(file.defaultName).toContain('一栋-墙砖-2026-08-月度')
    expect(file.defaultName.length).toBeLessThan(255)
    expect(book.SheetNames).toContain('原施工范围')
    expect(XLSX.utils.sheet_to_json(book.Sheets['正式出具']!, { header: 1 })).toEqual(expect.arrayContaining([['正式工资编号', '8'], ['格式', 'A'], ['档位', '月度请款'], ['原实际发放', 1000]]))
    expect(XLSX.utils.sheet_to_json(book.Sheets['发放汇总']!)).toEqual([expect.objectContaining({ 累计应付: 1000, 本次实际发放: 1000 })])
    expect(XLSX.utils.sheet_to_json(book.Sheets['组内分配']!)).toEqual([expect.objectContaining({ 实际收款金额: 1000 })])
  }
  finally { await f.close() }
}, 30_000)
