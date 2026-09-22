import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollAWorkbook } from '../../app/lib/payroll/a-export'
import { payrollAFrozenFileName, payrollALocationOutput } from '../../app/lib/payroll/a-location-output'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'
import { payrollUiDocument, payrollUiFact } from '../helpers/payroll-a-ui-fixture'

it('冻结位置按楼栋分项单位分组，断层楼层不补齐，原房间责任与金额不丢失', () => {
  const document = payrollUiDocument()
  const floors = Array.from({ length: 29 }, (_, index) => index + 3).filter(floor => ![15, 25].includes(floor))
  document.lines[0]!.facts = floors.map(floor => ({ ...payrollUiFact(String(floor)), floorName: `${floor}楼` }))
  document.lines[0]!.facts.push({ ...payrollUiFact('other-building'), floorName: '3楼', buildingId: 'other', buildingName: '二栋' })
  document.lines[0]!.facts.push({ ...payrollUiFact('partial'), floorId: 'floor-3', floorName: '3楼', unitName: '另一户', roomName: '卫生间', scopeKind: 'selected' })
  const before = structuredClone(document)
  const result = payrollALocationOutput(document)
  expect(result.groups).toHaveLength(2)
  expect(result.groups[0]).toMatchObject({ buildingName: '一栋', itemName: '墙砖', unit: '㎡', floors: '3–14、16–24、26–31楼' })
  expect(result.groups[0]!.records.some(row => row.unitName === '另一户' && row.roomName === '卫生间' && row.scopeKind === 'selected')).toBe(true)
  expect(result.groups[1]).toMatchObject({ buildingName: '二栋', floors: '3楼' })
  expect(result.lineNotes['line-a']).toContain('一栋 / 墙砖 / 3–14、16–24、26–31楼')
  expect(result.diagnostics.join(' ')).toContain('铺贴或整层收尾')
  expect(document).toEqual(before)
})

it('同名不同楼层身份和不明确楼层名保持原标签，不猜连续区间；未知不读当前事实', () => {
  const document = payrollUiDocument()
  document.lines[0]!.facts = [payrollUiFact('夹层'), { ...payrollUiFact('one'), floorName: '1楼' }, { ...payrollUiFact('another-one'), floorName: '1楼' }, { ...payrollUiFact('two'), floorName: null, completedAt: '', buildingName: null }]
  const result = payrollALocationOutput(document)
  expect(result.groups[0]!.floors).toContain('夹层层')
  expect(result.groups[0]!.floors).toContain('未记录楼层')
  expect(result.groups[0]!.floors).not.toContain('1–')
  expect(result.groups[0]!.records).toHaveLength(4)
  expect(result.diagnostics.join(' ')).toContain('日期')
  document.lines[0]!.facts = []
  expect(payrollALocationOutput(document).lineNotes['line-a']).toBe('原冻结位置缺失')
})

it('不同计量单位与分项保持独立，只附位置依据，不拆分或重复累计原工资金额', () => {
  const document = payrollUiDocument()
  document.lines[0]!.facts = [payrollUiFact('1')]
  document.lines.push({ ...document.lines[0]!, id: 'line-other', itemId: 'other-item', itemName: '踢脚线', unit: 'm', amount: 20, facts: [{ ...payrollUiFact('1'), itemId: 'other-item', itemName: '踢脚线', unit: 'm' }] })
  expect(payrollALocationOutput(document).groups.map(row => [row.itemName, row.unit])).toEqual([['墙砖', '㎡'], ['踢脚线', 'm']])
  const book = XLSX.read(createPayrollAWorkbook(document).data, { type: 'array' })
  const lines = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.工资明细!)
  expect(lines.map(row => row.金额)).toEqual([96, 20])
  expect(lines[0]!.冻结施工范围).toContain('一栋')
  const locations = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.原施工范围!)
  expect(locations).toHaveLength(2)
  expect(locations[0]).toMatchObject({ 原工资身份: document.id, 原工资行: 'line-a', 原责任身份: 'assignment-1', 原完成身份: 'completion-1', 房间: '客厅' })
})

it('文件名包含冻结项目、楼栋分项、期间负责人和稳定身份，长名非法字符不溢出或撞同名', () => {
  const document = payrollUiDocument()
  document.projectName = 'CON/<长项目>:'.repeat(50)
  document.leaderName = '同名负责人'
  document.lines[0]!.facts = [payrollUiFact('1')]
  const name = payrollAFrozenFileName(document)
  expect(name.length).toBeLessThanOrEqual(180)
  expect(name).not.toMatch(/[<>:"/\\|?*]/)
  expect(Array.from(name).every(character => character.charCodeAt(0) >= 32)).toBe(true)
  expect(name).toContain('一栋')
  expect(name).toContain('墙砖')
  expect(name).toContain('2026-09-月度')
  expect(name).toContain('同名负责人')
  expect(name).toBe(payrollAFrozenFileName(structuredClone(document)))
  expect(payrollAFrozenFileName({ ...document, id: `${document.id}-other` })).not.toBe(name)
  expect(payrollAFrozenFileName({ ...document, id: 'import:/'.repeat(200) })).toMatch(/\.xlsx$/)
  expect(payrollAFrozenFileName({ ...document, projectName: '🏗️'.repeat(100), leaderName: '工人😀'.repeat(80) }).length).toBeLessThanOrEqual(180)
})

it('真实普通工资与管理费沿冻结责任输出，当前房间楼层和现场量变化不改旧文件', async () => {
  const f = await createPayrollAFeesFixture()
  try {
    await f.prices()
    const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
    const ordinary = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
    await f.release(ordinary.statementId!, 1000)
    const management = await f.management()
    const managed = await management.start()
    await f.release(managed.statementId!, 300)
    const outputs = await Promise.all([ordinary, managed].map(row => f.service.aOutput({ origin: 'real' }, row.statementId!)))
    const originals = outputs.map((output) => {
      expect(output.state).toBe('available')
      const document = output.document!
      const workbook = XLSX.read(createPayrollAWorkbook(document).data, { type: 'array' })
      const locations = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.原施工范围!)
      expect(locations.length).toBeGreaterThan(0)
      expect(locations.every(row => row.楼栋 === '一栋' && row.楼层 === '一层' && row.房间 === '客厅')).toBe(true)
      expect(XLSX.utils.sheet_to_json(workbook.Sheets.发放汇总!)).toEqual([expect.objectContaining({ 本次实际发放: document.actualAmount })])
      return { document, locations, filename: payrollAFrozenFileName(document) }
    })
    expect(originals[0]!.filename).toMatch(/^工资-/)
    expect(originals[1]!.filename).toMatch(/^管理费进度款-/)
    expect(originals[1]!.locations.every(row => String(row.原工资行).startsWith('fee:'))).toBe(true)
    await f.db.execute('UPDATE floors SET name=\'现已改成九层\'')
    await f.db.execute('UPDATE rooms SET name=\'现已改房间\'')
    await f.db.execute('UPDATE house_type_template_items SET field_qty=999')
    for (const original of originals) {
      const reread = await f.service.aOutput({ origin: 'real' }, original.document.id)
      expect(reread.document).toEqual(original.document)
      const workbook = XLSX.read(createPayrollAWorkbook(reread.document!).data, { type: 'array' })
      expect(XLSX.utils.sheet_to_json(workbook.Sheets.原施工范围!)).toEqual(original.locations)
      expect(payrollAFrozenFileName(reread.document!)).toBe(original.filename)
    }
  }
  finally { await f.close() }
}, 30_000)
