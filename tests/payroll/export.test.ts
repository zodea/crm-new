import type { WageStatement } from '~/lib/payroll/statements'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollWorkbookExport } from '~/lib/payroll/export'

function statement(overrides: Partial<WageStatement> = {}): WageStatement {
  return {
    id: 'statement-a',
    projectId: 'project-a',
    projectName: '项目甲',
    crewId: 'crew-a',
    crewName: '泥水班',
    leaderWorkerId: 'worker-a',
    leaderName: '张师傅',
    subjectConfigId: null,
    month: '2026-07',
    purpose: 'final',
    periodKind: 'settlement',
    formatFamily: 'A',
    quantitySource: 'field',
    status: 'released',
    needsRecheck: false,
    payRatio: 1,
    cumulativeAmount: 1840,
    previouslyPaid: 0,
    grossAmount: 1840,
    actualAmount: 1800,
    sourceVersion: 'field-v1',
    sourceUpdatedAt: '2026-07-28',
    checkedSourceVersion: 'field-v1',
    adjustmentReason: '',
    operatorName: '项目经理',
    submittedAt: '2026-07-29',
    checkedAt: '2026-07-28',
    releasedAt: '2026-07-29',
    note: '',
    members: [{
      workerId: 'worker-a',
      workerName: '张师傅',
      isLeader: true,
    }],
    memberWorkerIds: ['worker-a'],
    allocationRecorded: true,
    allocations: [{
      workerId: 'worker-a',
      workerName: '张师傅',
      isLeader: true,
      allocatedAmountFen: 180000,
      amount: 1800,
    }],
    lines: [{
      id: 'line-a',
      workerId: 'worker-a',
      itemId: 'item-a',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 92,
      unitPrice: 20,
      amount: 1840,
    }],
    dayworkRecords: [],
    ...overrides,
  }
}

function readWorkbook(data: string | Uint8Array | ArrayBuffer) {
  return XLSX.read(data, { type: 'array' })
}

describe('工资已发放快照导出', () => {
  it('exports summary, wage detail and allocation without recomputing amounts', () => {
    const result = createPayrollWorkbookExport(statement())
    const workbook = readWorkbook(result.data)

    expect(result.defaultName).toBe('项目甲_2026-07_张师傅_工资表.xlsx')
    expect(workbook.SheetNames).toEqual(['发放汇总', '工资明细', '组内分配'])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['发放汇总']!)).toEqual([
      expect.objectContaining({
        本次核算应发: 1840,
        本次实际发放: 1800,
      }),
    ])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['工资明细']!)).toEqual([
      expect.objectContaining({
        工人: '张师傅',
        工程量: 92,
        分项金额: 1840,
      }),
    ])
  })

  it('adds the signed daywork sheet for C2', () => {
    const result = createPayrollWorkbookExport(statement({
      formatFamily: 'C2',
      dayworkRecords: [{
        id: 'daywork-a',
        projectId: 'project-a',
        crewId: 'crew-a',
        workerId: 'worker-a',
        workerName: '张师傅',
        workDate: '2026-07-12',
        workContent: '临时修补',
        startTime: '08:00',
        endTime: '12:00',
        laborUnits: 0.5,
        witness: '李工',
        confirmedOn: '2026-07-12',
        status: 'confirmed',
        note: '',
        createdAt: '2026-07-12',
        updatedAt: '2026-07-12',
      }],
    }))
    const workbook = readWorkbook(result.data)

    expect(workbook.SheetNames).toContain('零星签工')
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['零星签工']!)).toEqual([
      expect.objectContaining({
        用工人: '张师傅',
        用工数: 0.5,
        证明人: '李工',
      }),
    ])
  })

  it('refuses mutable and unimplemented sources', () => {
    expect(() => createPayrollWorkbookExport(statement({ status: 'checked' })))
      .toThrow('完成实际发放后')
    expect(() => createPayrollWorkbookExport(statement({ formatFamily: 'B' })))
      .toThrow('B 类工资已退役')
  })
})
