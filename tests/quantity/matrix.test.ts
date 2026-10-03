import type { QuantityProjectSnapshot } from '~/lib/quantity/read-model'
import { describe, expect, it } from 'vitest'
import {
  ALL_QUANTITY_FILTER,
  buildQuantityMatrix,
  moveQuantityFocus,
  quantityAssigneeOptions,
  quantityMonthOptions,
  quantityTradeOptions,
} from '~/lib/quantity/matrix'

const snapshot: QuantityProjectSnapshot = {
  projectId: 'p1',
  buildings: [
    { id: 'b1', projectId: 'p1', code: '1', name: '1栋', sortOrder: 0 },
  ],
  floors: [
    { id: 'f2', buildingId: 'b1', code: '2', name: '2层', sortOrder: 0 },
    { id: 'f1', buildingId: 'b1', code: '1', name: '1层', sortOrder: 1 },
  ],
  units: [
    { id: 'u201', floorId: 'f2', templateId: 't1', code: '01', name: '201户', sortOrder: 0 },
    { id: 'u202', floorId: 'f2', templateId: 't2', code: '02', name: '202户', sortOrder: 1 },
    { id: 'u101', floorId: 'f1', templateId: 't1', code: '01', name: '101户', sortOrder: 0 },
    { id: 'u102', floorId: 'f1', templateId: 't2', code: '02', name: '102户', sortOrder: 1 },
  ],
  stages: [
    { id: 's-wall', projectId: 'p1', code: 'wall', name: '墙砖铺贴', trade: '泥水工', sortOrder: 0 },
    { id: 's-floor', projectId: 'p1', code: 'floor', name: '地砖铺贴', trade: '泥水工', sortOrder: 1 },
    { id: 's-water', projectId: 'p1', code: 'water', name: '防水一遍', trade: '防水工', sortOrder: 2 },
  ],
  assignments: [
    { id: 'a1', unitId: 'u201', trade: '泥水工', assigneeKind: 'crew', assigneeId: 'c1', assigneeName: '泥水A班', note: '' },
    { id: 'a2', unitId: 'u202', trade: '泥水工', assigneeKind: 'crew', assigneeId: 'c2', assigneeName: '泥水B班', note: '' },
    { id: 'a3', unitId: 'u101', trade: '泥水工', assigneeKind: 'worker', assigneeId: 'w1', assigneeName: '张建国', note: '' },
  ],
  completions: [
    {
      id: 'c-wall',
      unitId: 'u201',
      stageId: 's-wall',
      stageName: '墙砖铺贴',
      stageTrade: '泥水工',
      stageSortOrder: 0,
      assignmentId: 'a1',
      assigneeKind: 'crew',
      assigneeId: 'c1',
      assigneeName: '泥水A班',
      status: 'completed',
      completedAt: '2026-05-18T08:00:00.000Z',
      note: '',
    },
    {
      id: 'c-floor',
      unitId: 'u201',
      stageId: 's-floor',
      stageName: '地砖铺贴',
      stageTrade: '泥水工',
      stageSortOrder: 1,
      assignmentId: 'a1',
      assigneeKind: 'crew',
      assigneeId: 'c1',
      assigneeName: '泥水A班',
      status: 'completed',
      completedAt: '2026-06-03T08:00:00.000Z',
      note: '',
    },
  ],
}

function matrix(overrides: Partial<Parameters<typeof buildQuantityMatrix>[1]> = {}) {
  return buildQuantityMatrix(snapshot, {
    buildingId: 'b1',
    month: ALL_QUANTITY_FILTER,
    viewMode: 'trade',
    trade: ALL_QUANTITY_FILTER,
    assigneeKey: ALL_QUANTITY_FILTER,
    ...overrides,
  })
}

describe('工程量矩阵纯投影', () => {
  it('同一户跨月只显示最近阶段摘要，同时保留逐阶段完整时间线', () => {
    const cell = matrix().rows[0]!.cells[0]!

    expect(cell.summary?.stageName).toBe('地砖铺贴')
    expect(cell.summary?.completedAt).toBe('2026-06-03T08:00:00.000Z')
    expect(cell.timeline.map(item => item.stageName)).toEqual(['地砖铺贴', '墙砖铺贴'])
  })

  it('月份只约束格子摘要，不裁掉详情时间线，也不把同工种阶段折叠', () => {
    const cell = matrix({ month: '2026-05' }).rows[0]!.cells[0]!

    expect(cell.summary?.stageName).toBe('墙砖铺贴')
    expect(cell.timeline.map(item => item.stageId)).toEqual(['s-floor', 's-wall'])
  })

  it('最近已完成阶段不会吞掉同户待处理草稿异常', () => {
    const withDraft: QuantityProjectSnapshot = {
      ...snapshot,
      completions: [
        ...snapshot.completions,
        {
          id: 'draft-water',
          unitId: 'u201',
          stageId: 's-water',
          stageName: '防水一遍',
          stageTrade: '防水工',
          stageSortOrder: 2,
          assignmentId: 'a-water',
          assigneeKind: 'crew',
          assigneeId: 'c-water',
          assigneeName: '防水班',
          status: 'draft',
          completedAt: '2026-07-01T08:00:00.000Z',
          note: '待补验收照片',
        },
      ],
    }
    const view = buildQuantityMatrix(withDraft, {
      buildingId: 'b1',
      month: ALL_QUANTITY_FILTER,
      viewMode: 'trade',
      trade: ALL_QUANTITY_FILTER,
      assigneeKey: ALL_QUANTITY_FILTER,
    })
    const cell = view.rows[0]!.cells[0]!

    expect(cell.summary?.stageName).toBe('地砖铺贴')
    expect(cell.draftCount).toBe(1)
    expect(cell.ariaLabel).toContain('另有 1 条草稿异常')
    expect(quantityMonthOptions(withDraft).map(option => option.key)).not.toContain('2026-07')
  })

  it('工种与班组视角都从同一责任和完成事实投影', () => {
    const tradeCell = matrix({ trade: '泥水工' }).rows[0]!.cells[0]!
    const crewCell = matrix({ viewMode: 'crew', assigneeKey: 'crew:c1' }).rows[0]!.cells[0]!
    const otherCrewCell = matrix({ viewMode: 'crew', assigneeKey: 'crew:c2' }).rows[0]!.cells[0]!
    const workerCell = matrix({ viewMode: 'crew', assigneeKey: 'worker:w1' }).rows[1]!.cells[0]!

    expect(tradeCell.hasResponsibility).toBe(true)
    expect(crewCell.hasResponsibility).toBe(true)
    expect(crewCell.summary?.assigneeName).toBe('泥水A班')
    expect(otherCrewCell.hasResponsibility).toBe(false)
    expect(otherCrewCell.summary).toBeNull()
    expect(workerCell.hasResponsibility).toBe(true)
    expect(workerCell.assignments[0]?.assigneeName).toBe('张建国')
  })

  it('排程下钻可按稳定阶段精确筛选，并覆盖楼栋分组的多栋范围', () => {
    const grouped: QuantityProjectSnapshot = {
      ...snapshot,
      buildings: [
        ...snapshot.buildings,
        { id: 'b2', projectId: 'p1', code: '2', name: '2栋', sortOrder: 1 },
      ],
      floors: [
        ...snapshot.floors,
        { id: 'f3', buildingId: 'b2', code: '1', name: '1层', sortOrder: 0 },
      ],
      units: [
        ...snapshot.units,
        { id: 'u301', floorId: 'f3', templateId: 't1', code: '01', name: '101户', sortOrder: 0 },
      ],
    }
    const view = buildQuantityMatrix(grouped, {
      buildingId: 'b1',
      buildingIds: ['b1', 'b2'],
      month: ALL_QUANTITY_FILTER,
      viewMode: 'trade',
      trade: '泥水工',
      assigneeKey: ALL_QUANTITY_FILTER,
      stageId: 's-wall',
    })

    expect(view.rows.map(row => row.label)).toEqual(['1栋 · 2层', '2栋 · 1层', '1栋 · 1层'])
    expect(view.rows[0]!.cells[0]!.timeline.map(item => item.stageId)).toEqual(['s-wall'])
  })

  it('派生月份、工种和班组选项且顺序稳定', () => {
    expect(quantityMonthOptions(snapshot).map(option => option.key)).toEqual(['all', '2026-06', '2026-05'])
    expect(quantityTradeOptions(snapshot).map(option => option.key)).toEqual(['all', '泥水工', '防水工'])
    expect(quantityAssigneeOptions(snapshot).map(option => option.key)).toEqual(['all', 'crew:c1', 'crew:c2', 'worker:w1'])
  })

  it('已被替换的历史责任仍能从班组或个人筛选进入', () => {
    const withHistoricalAssignee: QuantityProjectSnapshot = {
      ...snapshot,
      assignments: [],
      completions: [
        {
          ...snapshot.completions[0]!,
          id: 'historical-worker',
          assignmentId: 'deleted-assignment',
          assigneeKind: 'worker',
          assigneeId: 'old-worker',
          assigneeName: '历史工人',
        },
      ],
    }

    expect(quantityAssigneeOptions(withHistoricalAssignee)).toEqual([
      { key: 'all', label: '全部班组 / 个人' },
      { key: 'worker:old-worker', label: '历史工人（个人）' },
    ])
    const cell = buildQuantityMatrix(withHistoricalAssignee, {
      buildingId: 'b1',
      month: ALL_QUANTITY_FILTER,
      viewMode: 'crew',
      trade: ALL_QUANTITY_FILTER,
      assigneeKey: 'worker:old-worker',
    }).rows[0]!.cells[0]!
    expect(cell.summary?.id).toBe('historical-worker')
  })
})

describe('工程量矩阵方向键', () => {
  const positions = matrix().positions

  it.each([
    { case: 'positions / \'u201\' / \'ArrowRight\'', input: positions, argument2: 'u201', argument3: 'ArrowRight', expected: 'u202' },
    { case: 'positions / \'u201\' / \'ArrowDown\'', input: positions, argument2: 'u201', argument3: 'ArrowDown', expected: 'u101' },
    { case: 'positions / \'u201\' / \'ArrowLeft\'', input: positions, argument2: 'u201', argument3: 'ArrowLeft', expected: 'u201' },
    { case: 'positions / \'u201\' / \'ArrowUp\'', input: positions, argument2: 'u201', argument3: 'ArrowUp', expected: 'u201' },
    { case: 'positions / \'u102\' / \'ArrowRight\'', input: positions, argument2: 'u102', argument3: 'ArrowRight', expected: 'u102' },
  ])('按二维坐标移动并在边界原地停留 / moveQuantityFocus：$case', ({ input, argument2, argument3, expected }) => {
    expect(moveQuantityFocus(input, argument2, argument3)).toBe(expected)
  })

  describe('稀疏楼层跳过空房号，并在下一行选择最接近的真实格', () => {
    const sparse = [
      { id: 'top-left', row: 0, column: 0 },
      { id: 'top-right', row: 0, column: 2 },
      { id: 'middle', row: 1, column: 1 },
      { id: 'bottom-right', row: 2, column: 2 },
    ]
    it.each([
      { case: 'sparse / \'top-left\' / \'ArrowRight\'', input: sparse, argument2: 'top-left', argument3: 'ArrowRight', expected: 'top-right' },
      { case: 'sparse / \'top-left\' / \'ArrowDown\'', input: sparse, argument2: 'top-left', argument3: 'ArrowDown', expected: 'middle' },
      { case: 'sparse / \'top-right\' / \'ArrowDown\'', input: sparse, argument2: 'top-right', argument3: 'ArrowDown', expected: 'middle' },
      { case: 'sparse / \'middle\' / \'ArrowDown\'', input: sparse, argument2: 'middle', argument3: 'ArrowDown', expected: 'bottom-right' },
    ])('moveQuantityFocus：$case', ({ input, argument2, argument3, expected }) => {
      expect(moveQuantityFocus(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBe(expected)
    })
  })
})
