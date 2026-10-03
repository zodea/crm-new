import type { TabsState } from '~/lib/tabs/tab-machine'
import { describe, expect, it } from 'vitest'
import {
  closeAll,
  closeOthers,
  closeRight,
  closeTab,
  deriveKey,
  HOME_KEY,
  initialTabsState,
  MAX_TABS,
  openTab,
} from '~/lib/tabs/tab-machine'

/** 便捷：连续开 N 个不同页签。 */
function openMany(n: number, start = 1): TabsState {
  let s = initialTabsState()
  for (let i = start; i < start + n; i++)
    s = openTab(s, { fullPath: `/p/${i}`, title: `P${i}` }).state
  return s
}

describe('初始态', () => {
  it('仅首页、激活首页、首页不可关', () => {
    const s = initialTabsState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]).toMatchObject({ key: HOME_KEY, closable: false })
    expect(s.activeKey).toBe(HOME_KEY)
  })
})

describe('deriveKey', () => {
  it('页内锚点不增加页签身份，首页仍是固定首页', () => {
    const first = openTab(initialTabsState(), { fullPath: '/project', title: '项目' }).state
    const next = openTab(first, { fullPath: '/project#summary', title: '项目' }).state
    expect(next.tabs).toHaveLength(2)
    expect(next.tabs[1]?.fullPath).toBe('/project#summary')
  })

  it.each([
    { case: '\'/project#summary\'', input: '/project#summary', expected: '/project' },
    { case: '\'/#progress\'', input: '/#progress', expected: HOME_KEY },
  ])('页内锚点不增加页签身份，首页仍是固定首页 / deriveKey：$case', ({ input, expected }) => {
    expect(deriveKey(input)).toBe(expected)
  })
  it.each([
    { case: '\'/\'', input: '/', expected: HOME_KEY },
    { case: '\'\'', input: '', expected: HOME_KEY },
    { case: '\'/base/supplier\'', input: '/base/supplier', expected: '/base/supplier' },
  ])('首页归一 HOME_KEY，其余用路径 / deriveKey：$case', ({ input, expected }) => {
    expect(deriveKey(input)).toBe(expected)
  })

  it.each([
    { case: '\'/project/1?tab=info\'', input: '/project/1?tab=info', expected: '/project/1' },
    { case: '\'/finance/ledger?project=p1\'', input: '/finance/ledger?project=p1', expected: '/finance/ledger' },
    { case: '\'/?from=x\'', input: '/?from=x', expected: HOME_KEY },
  ])('穿透预筛不进页签身份：query 不参与键判定（CONTEXT.md 页签词条 / specs §07） / deriveKey：$case', ({ input, expected }) => {
    expect(deriveKey(input)).toBe(expected)
  })
})

describe('openTab：穿透预筛复用', () => {
  it('同路径不同 query 复用页签并刷新 fullPath（复用 + 应用新预筛）', () => {
    const s = openTab(initialTabsState(), { fullPath: '/finance/ledger', title: '发票台账' }).state
    const before = s.tabs.length
    const r = openTab(s, { fullPath: '/finance/ledger?project=p1', title: '发票台账' })
    expect(r.blocked).toBe(false)
    expect(r.state.tabs).toHaveLength(before)
    expect(r.state.activeKey).toBe('/finance/ledger')
    expect(r.state.tabs.find(t => t.key === '/finance/ledger')!.fullPath).toBe('/finance/ledger?project=p1')
  })
})

describe('openTab：打开/复用/超限', () => {
  it('新页签追加并激活，closable=true', () => {
    const { state } = openTab(initialTabsState(), { fullPath: '/base/supplier', title: '分供方' })
    expect(state.tabs).toHaveLength(2)
    expect(state.activeKey).toBe('/base/supplier')
    expect(state.tabs[1]).toMatchObject({ title: '分供方', closable: true })
  })

  it('同路由同参数复用（不新增），保留已有 title 不被覆盖（#98）', () => {
    let s = openTab(initialTabsState(), { fullPath: '/project/1', title: '项目详情' }).state
    // 页面回填动态标题（等价 store.setTitle）
    s = { ...s, tabs: s.tabs.map(t => (t.key === '/project/1' ? { ...t, title: '合和新城' } : t)) }
    s = openTab(s, { fullPath: '/base/supplier', title: '分供方' }).state
    const before = s.tabs.length
    const r = openTab(s, { fullPath: '/project/1', title: '项目详情' }) // 切回，调用方仍传静态标题
    expect(r.blocked).toBe(false)
    expect(r.state.tabs).toHaveLength(before) // 未新增
    expect(r.state.activeKey).toBe('/project/1')
    expect(r.state.tabs.find(t => t.key === '/project/1')!.title).toBe('合和新城') // 动态标题保留
  })

  it('复用历史“未命名”页签时用当前稳定路由标题修复，不要求用户手工关闭重开', () => {
    const state = openTab(initialTabsState(), {
      fullPath: '/schedule',
      title: '未命名',
    }).state

    const result = openTab(state, {
      fullPath: '/schedule?project=project_1',
      title: '施工进度',
    })

    expect(result.state.tabs).toHaveLength(2)
    expect(result.state.tabs.find(tab => tab.key === '/schedule')).toMatchObject({
      title: '施工进度',
      fullPath: '/schedule?project=project_1',
    })
  })

  it('不同 query 复用同一页签（旧规则「不同 query 不同页签」已被穿透预筛规则取代）', () => {
    let s = openTab(initialTabsState(), { fullPath: '/project/1?tab=a', title: 'A' }).state
    s = openTab(s, { fullPath: '/project/1?tab=b', title: 'B' }).state
    expect(s.tabs.filter(t => t.key !== HOME_KEY)).toHaveLength(1)
    expect(s.tabs.find(t => t.key === '/project/1')!.fullPath).toBe('/project/1?tab=b')
  })

  it('达上限 15（不含首页）后阻断：不新增、不改激活、blocked=true', () => {
    const s = openMany(MAX_TABS) // 15 个 + 首页
    expect(s.tabs.filter(t => t.key !== HOME_KEY)).toHaveLength(MAX_TABS)
    const activeBefore = s.activeKey
    const r = openTab(s, { fullPath: '/p/overflow', title: '溢出' })
    expect(r.blocked).toBe(true)
    expect(r.state).toBe(s) // 原样
    expect(r.state.activeKey).toBe(activeBefore)
  })

  it('达上限后复用已存在页签不受阻断', () => {
    const s = openMany(MAX_TABS)
    const r = openTab(s, { fullPath: '/p/1', title: 'P1' }) // 已存在
    expect(r.blocked).toBe(false)
    expect(r.state.activeKey).toBe('/p/1')
  })
})

describe('closeTab：关闭与激活转移', () => {
  it('首页不可关（no-op）', () => {
    const s = openMany(2)
    expect(closeTab(s, HOME_KEY)).toBe(s)
  })

  it('关非激活页签：仅移除，激活不变', () => {
    let s = openMany(2) // home, /p/1, /p/2, active=/p/2
    s = { ...s, activeKey: '/p/2' }
    const next = closeTab(s, '/p/1')
    expect(next.tabs.some(t => t.key === '/p/1')).toBe(false)
    expect(next.activeKey).toBe('/p/2')
  })

  it('关激活页签：激活右邻优先', () => {
    let s = openMany(3) // home,/p/1,/p/2,/p/3 active=/p/3
    s = { ...s, activeKey: '/p/2' }
    const next = closeTab(s, '/p/2')
    expect(next.activeKey).toBe('/p/3') // 右邻
  })

  it('关激活的最右页签：激活左邻', () => {
    const s = openMany(3) // active=/p/3（最右）
    const next = closeTab(s, '/p/3')
    expect(next.activeKey).toBe('/p/2')
  })

  it('关最后一个非首页激活页签：回落首页', () => {
    const s = openMany(1) // home,/p/1 active=/p/1
    const next = closeTab(s, '/p/1')
    expect(next.activeKey).toBe(HOME_KEY)
    expect(next.tabs).toHaveLength(1)
  })
})

describe('批量关闭均保留首页', () => {
  it('closeOthers：只留首页 + 指定，并激活它', () => {
    const s = openMany(4)
    const next = closeOthers(s, '/p/2')
    expect(next.tabs.map(t => t.key)).toEqual([HOME_KEY, '/p/2'])
    expect(next.activeKey).toBe('/p/2')
  })

  it('closeRight：留指定及左侧 + 首页；激活在右侧则改激活指定', () => {
    const s = openMany(4) // home,/p/1../p/4 active=/p/4
    const next = closeRight(s, '/p/2')
    expect(next.tabs.map(t => t.key)).toEqual([HOME_KEY, '/p/1', '/p/2'])
    expect(next.activeKey).toBe('/p/2') // 原激活 /p/4 被关
  })

  it('closeRight：激活在保留区则激活不变', () => {
    let s = openMany(4)
    s = { ...s, activeKey: '/p/1' }
    const next = closeRight(s, '/p/2')
    expect(next.activeKey).toBe('/p/1')
  })

  it('closeAll：仅留首页并激活首页', () => {
    const next = closeAll()
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].key).toBe(HOME_KEY)
    expect(next.activeKey).toBe(HOME_KEY)
  })
})
