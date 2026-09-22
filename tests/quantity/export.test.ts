import type { QuantityConstructionRecord } from '~/lib/quantity/derived'
import type { QuantityMeasureTotal } from '~/lib/quantity/totals'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  createQuantityCategoryExport,
  createQuantityLedgerExport,
  quantityMonthlyRows,
  quantityProgressRows,
  quantityRecordRows,
} from '~/lib/quantity/export'

function total(value: number): QuantityMeasureTotal {
  return { value, knownValue: value, missingCount: 0, sourceCount: 1, unitMissing: false, completeness: 'complete' }
}

function record(overrides: Partial<QuantityConstructionRecord> = {}): QuantityConstructionRecord {
  return {
    completionId: 'c1',
    unitId: 'u1',
    unitName: '101户',
    floorName: '1层',
    buildingName: '1栋',
    stageId: 's-wall',
    stageName: '墙砖铺贴',
    trade: '泥水工',
    stageSortOrder: 20,
    status: 'completed',
    completedAt: '2026-07-01',
    note: '',
    executionAssigneeName: '泥水一班',
    currentAssigneeName: null,
    photoCount: 2,
    ...overrides,
  }
}

describe('quantity export：派生查询到 ADR 0004 两路导出', () => {
  it('施工记录行用中文表头并翻译状态，空责任显示空串', () => {
    const rows = quantityRecordRows([record()])
    expect(rows).toEqual([{
      楼栋: '1栋',
      楼层: '1层',
      户: '101户',
      工种: '泥水工',
      工序阶段: '墙砖铺贴',
      状态: '已完成',
      完成日期: '2026-07-01',
      完成时执行责任: '泥水一班',
      当前责任: '',
      验收照片数: 2,
      备注: '',
    }])
  })

  it('进度与月度行按派生口径投影，应做为 0 时完成率显示占位', () => {
    expect(quantityProgressRows([{
      stageId: 's1',
      stageName: '墙砖铺贴',
      trade: '泥水工',
      sortOrder: 20,
      applicableUnits: 8,
      completedUnits: 7,
      draftUnits: 1,
      completionRate: 7 / 8,
    }, {
      stageId: 's2',
      stageName: '吊顶封板',
      trade: '木工',
      sortOrder: 30,
      applicableUnits: 0,
      completedUnits: 0,
      draftUnits: 0,
      completionRate: 0,
    }])).toEqual([
      { 工种: '泥水工', 工序阶段: '墙砖铺贴', 应做户数: 8, 已完成户数: 7, 草稿户数: 1, 完成率: '88%' },
      { 工种: '木工', 工序阶段: '吊顶封板', 应做户数: 0, 已完成户数: 0, 草稿户数: 0, 完成率: '—' },
    ])

    expect(quantityMonthlyRows([{
      month: '2026-07',
      trade: '泥水工',
      stageId: 's1',
      stageName: '墙砖铺贴',
      stageSortOrder: 20,
      completedUnits: 1,
      unit: '㎡',
      contractQty: total(21),
      provisionalQty: total(22),
      fieldQty: total(20),
    }])).toEqual([
      {
        月份: '2026-07',
        工种: '泥水工',
        工序阶段: '墙砖铺贴',
        单位: '㎡',
        完成户数: 1,
        合同量: 21,
        合同量完整度: '完整',
        合同量已知部分: '',
        暂估量: 22,
        暂估量完整度: '完整',
        暂估量已知部分: '',
        现场量: 20,
        现场量完整度: '完整',
        现场量已知部分: '',
      },
    ])
  })

  it('台账导出编译为带项目名与日期的单文件请求', () => {
    const options = createQuantityLedgerExport({
      projectName: '合和新城',
      records: [record()],
      progress: [],
      monthly: [],
    }, new Date(2026, 6, 20))
    expect(options.defaultName).toBe('合和新城_工程量台账_2026-07-20.xlsx')
    expect(options.data.byteLength).toBeGreaterThan(0)
  })

  it('真实 XLSX 保留缺失数值为空、明确零为数字，并带出单位和已知部分', () => {
    const file = createQuantityLedgerExport({
      projectName: '空值核验',
      records: [],
      progress: [],
      monthly: [{
        month: '2026-09',
        trade: '泥水工',
        stageId: 'stage-null',
        stageName: '含缺量阶段',
        stageSortOrder: 1,
        unit: '㎡',
        completedUnits: 1,
        contractQty: total(0),
        provisionalQty: total(30),
        fieldQty: { value: null, knownValue: 12, missingCount: 1, sourceCount: 2, unitMissing: false, completeness: 'partial' },
      }],
    })
    const book = XLSX.read(file.data, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json(book.Sheets['月度完成量']!, { defval: '' })
    expect(rows).toEqual([{
      月份: '2026-09',
      工种: '泥水工',
      工序阶段: '含缺量阶段',
      单位: '㎡',
      完成户数: 1,
      合同量: 0,
      合同量完整度: '完整',
      合同量已知部分: '',
      暂估量: 30,
      暂估量完整度: '完整',
      暂估量已知部分: '',
      现场量: '',
      现场量完整度: '缺 1 项',
      现场量已知部分: 12,
    }])
  })

  it('分类导出按楼栋→工种目录、户×工种一文件分组', () => {
    const plan = createQuantityCategoryExport([
      record(),
      record({ completionId: 'c2', stageId: 's-floor', stageName: '地砖铺贴' }),
      record({ completionId: 'c3', unitId: 'u2', unitName: '201户', floorName: '2层', trade: '油工', stageName: '一遍腻子' }),
    ])
    expect(plan.requiresDirectoryStructure).toBe(true)
    expect(plan.structure.levels.map(level => level.field)).toEqual(['buildingName', 'trade'])
    expect(plan.naming.parts.map(part => part.field)).toEqual(['floorName', 'unitName'])
    // u1×泥水工的两条记录并成一个文件，u2×油工独立成文件。
    expect(plan.source.files).toHaveLength(2)
    expect(plan.source.files.map(file => file.row)).toEqual([
      { buildingName: '1栋', trade: '泥水工', floorName: '1层', unitName: '101户' },
      { buildingName: '1栋', trade: '油工', floorName: '2层', unitName: '201户' },
    ])
  })
})
