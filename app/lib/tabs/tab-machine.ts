// 页签导航状态机（CONTEXT.md「页签导航」+ #47 PRD）——纯函数，node 可测。
// 规则：首页固定不可关；同路由同参数复用；四种关闭均保留首页；上限 15（不含首页），
// 超限阻断（不新增、不改激活，由调用方弹临时 toast）。UI/store 只做状态搬运与副作用。

export interface Tab {
  /** 唯一键：同 fullPath 复用（首页固定 HOME_KEY）。 */
  key: string
  title: string
  /** 完整路径（含 query），用于导航。 */
  fullPath: string
  /** 是否可关闭（首页 false）。 */
  closable: boolean
}

export interface TabsState {
  tabs: Tab[]
  activeKey: string
}

export const HOME_KEY = 'home'
/** 上限：不含首页的最大页签数。 */
export const MAX_TABS = 15

export function makeHomeTab(): Tab {
  return { key: HOME_KEY, title: '首页', fullPath: '/', closable: false }
}

export function initialTabsState(): TabsState {
  return { tabs: [makeHomeTab()], activeKey: HOME_KEY }
}

/** 由 fullPath 推 key：首页归一到 HOME_KEY，其余用 fullPath 本身（同路由同参数复用）。 */
export function deriveKey(fullPath: string): string {
  if (fullPath === '/' || fullPath === '')
    return HOME_KEY
  return fullPath
}

export interface OpenResult {
  state: TabsState
  /** 超限被阻断（state 不变）。 */
  blocked: boolean
}

/**
 * 打开/复用页签：
 * - 已存在 → 激活并刷新 title/fullPath（详情名可能变化）；
 * - 不存在且未超限 → 新增并激活；
 * - 不存在且已达上限（不含首页）→ 阻断（state 原样返回，blocked=true）。
 */
export function openTab(state: TabsState, input: { fullPath: string, title: string }): OpenResult {
  const key = deriveKey(input.fullPath)
  const existing = state.tabs.find(t => t.key === key)
  if (existing) {
    const tabs = state.tabs.map(t =>
      t.key === key ? { ...t, title: input.title, fullPath: input.fullPath } : t,
    )
    return { state: { tabs, activeKey: key }, blocked: false }
  }
  const nonHomeCount = state.tabs.filter(t => t.key !== HOME_KEY).length
  if (key !== HOME_KEY && nonHomeCount >= MAX_TABS)
    return { state, blocked: true }
  const tab: Tab = { key, title: input.title, fullPath: input.fullPath, closable: key !== HOME_KEY }
  return { state: { tabs: [...state.tabs, tab], activeKey: key }, blocked: false }
}

/** 关闭单个（首页不可关）。若关的是当前激活页签，激活右邻 → 左邻 → 首页。 */
export function closeTab(state: TabsState, key: string): TabsState {
  if (key === HOME_KEY)
    return state
  const idx = state.tabs.findIndex(t => t.key === key)
  if (idx === -1)
    return state
  const tabs = state.tabs.filter(t => t.key !== key)
  let { activeKey } = state
  if (activeKey === key)
    activeKey = state.tabs[idx + 1]?.key ?? state.tabs[idx - 1]?.key ?? HOME_KEY
  return { tabs, activeKey }
}

/** 关闭其他（保留首页 + 指定页签，并激活它）。 */
export function closeOthers(state: TabsState, key: string): TabsState {
  const tabs = state.tabs.filter(t => t.key === HOME_KEY || t.key === key)
  return { tabs, activeKey: key }
}

/** 关闭右侧（保留指定页签及其左侧 + 首页）。若激活页签被关，改激活指定页签。 */
export function closeRight(state: TabsState, key: string): TabsState {
  const idx = state.tabs.findIndex(t => t.key === key)
  if (idx === -1)
    return state
  const tabs = state.tabs.filter((t, i) => i <= idx || t.key === HOME_KEY)
  const activeStillOpen = tabs.some(t => t.key === state.activeKey)
  return { tabs, activeKey: activeStillOpen ? state.activeKey : key }
}

/** 关闭全部（仅留首页并激活）。 */
export function closeAll(): TabsState {
  return initialTabsState()
}
