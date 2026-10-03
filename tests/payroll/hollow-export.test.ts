import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollC1Workbook } from '~/lib/payroll/c1-export'
import { createPayrollC2Workbook } from '~/lib/payroll/c2-export'
import { createPayrollCHollowFixture } from '../helpers/payroll-c-hollow-fixture'

it.each([{ format: 'C1', sourceSheet: '考勤表' }, { format: 'C2', sourceSheet: '签工表' }] as const)('$format 工作簿分列请款、空鼓与现金，保原来源 $sourceSheet', async ({ format, sourceSheet }) => {
  const f = await createPayrollCHollowFixture(format)
  try {
    const release = { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] }
    let file
    if (format === 'C1') {
      const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'c1-output', draft: f.draft })
      const saved = await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))
      const statementId = saved.statementId!
      let read = await f.service.c1Form({ origin: 'real' }, { statementId })
      await f.service.executeHollow(f.startCommand(read.hollow!))
      read = await f.service.c1Form({ origin: 'real' }, { statementId })
      await f.service.executeC1(f.c1Command(read, { kind: 'check-c1' }))
      read = await f.service.c1Form({ origin: 'real' }, { statementId })
      await f.service.executeC1(f.c1Command(read, { kind: 'release-c1', release }))
      const output = await f.service.c1Output({ origin: 'real' }, statementId)
      if (output.state !== 'available')
        throw new Error('C1 原冻结输出不可用')
      file = createPayrollC1Workbook(output.document)
    }
    else {
      const initial = await f.service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'c2-output', draft: f.draft })
      const saved = await f.service.executeC2(f.c2Command(initial, { kind: 'save-c2-draft', draft: f.draft }))
      const statementId = saved.statementId!
      let read = await f.service.c2Form({ origin: 'real' }, { statementId })
      await f.service.executeHollow(f.startCommand(read.hollow!))
      read = await f.service.c2Form({ origin: 'real' }, { statementId })
      await f.service.executeC2(f.c2Command(read, { kind: 'check-c2' }))
      read = await f.service.c2Form({ origin: 'real' }, { statementId })
      await f.service.executeC2(f.c2Command(read, { kind: 'release-c2', release }))
      const output = await f.service.c2Output({ origin: 'real' }, statementId)
      if (output.state !== 'available')
        throw new Error('C2 原冻结输出不可用')
      file = createPayrollC2Workbook(output.document)
    }
    const workbook = XLSX.read(file.data, { type: 'array' })
    expect(workbook.SheetNames).toEqual(['工资表', sourceSheet, '空鼓扣款汇总', '空鼓采用来源'])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.空鼓扣款汇总!)).toEqual([expect.objectContaining({ 本次请款合计: 1000, 本单空鼓扣款: 450, 扣款后核算应发: 550 })])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.空鼓采用来源!)).toEqual([expect.objectContaining({ 原记录身份: f.recordId, 检查总处数: 19, 已整改处数: 4, 当时未整改处数: 15, 本单扣款金额: 450 })])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.工资表!, { header: 1 })).toContainEqual(['核算应发', 550, '实际发放', 550])
  }
  finally { await f.close() }
}, 30_000)
