import { describe, expect, it } from 'vitest'
import { clampPage, deriveFilterOptions, formatCell, normalizeKitColumn, pageCount, paginate } from '~/lib/kit/table'

describe('列配置归一化:normalizeKitColumn', () => {
  it('money 列 → 右对齐 + col--money 等宽类(vxe-theme 既有钩子)', () => {
    const col = normalizeKitColumn({ field: 'amount', title: '合同金额', type: 'money' })
    expect(col.align).toBe('right')
    expect(col.className).toBe('col--money')
  })

  it('type 缺省为 text、左对齐,给默认 minWidth 兜底防挤压', () => {
    const col = normalizeKitColumn({ field: 'name', title: '项目名称' })
    expect(col.type).toBe('text')
    expect(col.align).toBe('left')
    expect(col.minWidth).toBe(120)
  })

  it('显式 width/minWidth/align 优先于类型默认值', () => {
    const col = normalizeKitColumn({ field: 'amount', title: '金额', type: 'money', width: 160, align: 'center' })
    expect(col.width).toBe(160)
    expect(col.minWidth).toBeUndefined()
    expect(col.align).toBe('center')
  })

  it('seq 列默认窄宽居中,action 列默认右固定', () => {
    const seq = normalizeKitColumn({ title: '#', type: 'seq' })
    expect(seq.width).toBe(52)
    expect(seq.align).toBe('center')

    const action = normalizeKitColumn({ title: '操作', type: 'action' })
    expect(action.fixed).toBe('right')
    expect(action.width).toBe(130)
  })

  it('date 列默认 110 宽', () => {
    const col = normalizeKitColumn({ field: 'startDate', title: '开工日期', type: 'date' })
    expect(col.width).toBe(110)
  })

  it('checkbox 列默认 40 宽居中(#69 勾选浮出合计)', () => {
    const col = normalizeKitColumn({ title: '', type: 'checkbox' })
    expect(col.width).toBe(40)
    expect(col.align).toBe('center')
  })

  it('filterable 支持显式选项数组透传(受控分页下选项来自全量数据)', () => {
    const opts = [{ label: '施工中', value: '施工中' }]
    expect(normalizeKitColumn({ field: 'status', title: '状态', filterable: opts }).filterable).toEqual(opts)
    expect(normalizeKitColumn({ field: 'status', title: '状态', filterable: true }).filterable).toBe(true)
    expect(normalizeKitColumn({ field: 'status', title: '状态' }).filterable).toBe(false)
  })
})

describe('单元格格式化:formatCell', () => {
  const money = normalizeKitColumn({ field: 'amount', title: '金额', type: 'money' })
  const text = normalizeKitColumn({ field: 'name', title: '名称' })

  it('money 列按 ¥#,##0.00 完整展示(走 lib/util/money 的 yuan)', () => {
    expect(formatCell(money, 1234567.89)).toBe('¥1,234,567.89')
    expect(formatCell(money, 0)).toBe('¥0.00')
    expect(formatCell(money, '8600000')).toBe('¥8,600,000.00')
  })

  it('money 列空值给 — 占位', () => {
    expect(formatCell(money, null)).toBe('—')
    expect(formatCell(money, undefined)).toBe('—')
  })

  it('其他列原样转字符串,空值给 — 占位', () => {
    expect(formatCell(text, '合和新城')).toBe('合和新城')
    expect(formatCell(text, 0)).toBe('0')
    expect(formatCell(text, null)).toBe('—')
    expect(formatCell(text, '')).toBe('—')
  })
})

describe('列头筛选选项推导:deriveFilterOptions', () => {
  const rows = [
    { status: '施工中' },
    { status: '已竣工' },
    { status: '施工中' },
    { status: null },
    { status: '停工' },
  ]

  it('按数据行首次出现顺序去重,产出 vxe filters 形状 {label, value}', () => {
    expect(deriveFilterOptions(rows, 'status')).toEqual([
      { label: '施工中', value: '施工中' },
      { label: '已竣工', value: '已竣工' },
      { label: '停工', value: '停工' },
    ])
  })

  it('空值行不产出选项,空数据返回空数组', () => {
    expect(deriveFilterOptions([], 'status')).toEqual([])
    expect(deriveFilterOptions([{ status: null }, { status: undefined }, { status: '' }], 'status')).toEqual([])
  })

  it('naN 不产出选项(NaN === NaN 恒 false,选项永远筛不出行)', () => {
    expect(deriveFilterOptions([{ n: Number.NaN }, { n: 1 }], 'n')).toEqual([
      { label: '1', value: 1 },
    ])
  })

  it('0 和 false 是合法值,照常产出选项', () => {
    expect(deriveFilterOptions([{ n: 0 }, { b: false }], 'n')).toEqual([{ label: '0', value: 0 }])
    expect(deriveFilterOptions([{ b: false }], 'b')).toEqual([{ label: 'false', value: false }])
  })

  it('数字字段 label 转字符串、value 保留原值(vxe 相等匹配用)', () => {
    expect(deriveFilterOptions([{ n: 2026 }, { n: 2025 }, { n: 2026 }], 'n')).toEqual([
      { label: '2026', value: 2026 },
      { label: '2025', value: 2025 },
    ])
  })
})

describe('客户端分页:paginate / pageCount / clampPage', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: i + 1 }))

  it('按页切片:首页、中间页、末页不足一页', () => {
    expect(paginate(rows, 1, 20).map(r => r.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    )
    expect(paginate(rows, 2, 20)[0]!.id).toBe(21)
    expect(paginate(rows, 3, 20).map(r => r.id)).toEqual([41, 42, 43, 44, 45])
  })

  it('pageCount 向上取整,至少 1 页(空数据也算 1 页)', () => {
    expect(pageCount(45, 20)).toBe(3)
    expect(pageCount(40, 20)).toBe(2)
    expect(pageCount(0, 20)).toBe(1)
  })

  it('pageSize 非法(0/负数)按 1 页兜底,不产出 Infinity', () => {
    expect(pageCount(45, 0)).toBe(1)
    expect(pageCount(45, -5)).toBe(1)
    expect(clampPage(3, 45, 0)).toBe(1)
  })

  it('clampPage 钳到 [1, 总页数]——筛选收窄后当前页越界时回落末页', () => {
    expect(clampPage(5, 45, 20)).toBe(3)
    expect(clampPage(0, 45, 20)).toBe(1)
    expect(clampPage(2, 45, 20)).toBe(2)
    expect(clampPage(3, 0, 20)).toBe(1)
  })

  it('越界页返回空数组而非报错', () => {
    expect(paginate(rows, 9, 20)).toEqual([])
  })
})
