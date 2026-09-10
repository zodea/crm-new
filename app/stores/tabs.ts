import type { Tab } from '~/lib/tabs/tab-machine'
// 页签导航 store（Pinia）——纯状态机 tab-machine 的响应式外壳 + 副作用边界。
// 唯一写路径走 action；超限由 open() 返回 blocked，交调用方弹临时 toast（CONTEXT.md）。
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import {
  closeAll,
  closeOthers,
  closeRight,
  closeTab,
  deriveKey,
  initialTabsState,
  openTab,
} from '~/lib/tabs/tab-machine'

export const useTabsStore = defineStore('tabs', () => {
  const state = shallowRef(initialTabsState())
  const cacheVersions = shallowRef<Record<string, number>>({})
  const invalidatedKeys = shallowRef<string[]>([])
  const closeGuards = new Map<string, () => boolean | Promise<boolean>>()
  let requestingClose = false
  const tabs = computed(() => state.value.tabs)
  const activeKey = computed(() => state.value.activeKey)

  function registerCloseGuard(key: string, guard: () => boolean | Promise<boolean>) {
    closeGuards.set(key, guard)
    return () => {
      if (closeGuards.get(key) === guard)
        closeGuards.delete(key)
    }
  }

  /** 先确认全部目标，再统一卸载；取消时不能使任何页面缓存失效。 */
  async function requestChange(keys: string[], refresh = false, retainedKey?: string) {
    if (requestingClose)
      return false
    requestingClose = true
    const guards = keys.map(key => [key, closeGuards.get(key)] as const)
    try {
      for (const [, guard] of guards) {
        if (guard && !await guard())
          return false
      }
      // 等待确认期间页面若被替换，旧确认不能授权丢弃新草稿。
      if (guards.some(([key, guard]) => closeGuards.get(key) !== guard))
        return false
      if (refresh) {
        invalidate(keys)
      }
      else {
        applyClose(() => {
          const next = keys.reduce((next, key) => closeTab(next, key), state.value)
          // 激活规则仍由纯状态机裁定；只关闭已确认的集合，保留等待期间新开的页签。
          return retainedKey && next.tabs.some(tab => tab.key === retainedKey)
            ? { ...next, activeKey: closeOthers(next, retainedKey).activeKey }
            : next
        })
      }
      for (const key of keys)
        closeGuards.delete(key)
      return true
    }
    finally {
      requestingClose = false
    }
  }

  function requestClose(key: string) {
    return requestChange(tabs.value.filter(tab => tab.closable && tab.key === key).map(tab => tab.key))
  }

  function requestCloseOther(key: string) {
    return requestChange(tabs.value.filter(tab => tab.closable && tab.key !== key).map(tab => tab.key), false, key)
  }

  function requestCloseToRight(key: string) {
    const index = tabs.value.findIndex(tab => tab.key === key)
    return requestChange(index < 0 ? [] : tabs.value.slice(index + 1).filter(tab => tab.closable).map(tab => tab.key))
  }

  function requestCloseEvery() {
    return requestChange(tabs.value.filter(tab => tab.closable).map(tab => tab.key))
  }

  function requestRefresh() {
    return requestChange([activeKey.value], true)
  }

  /** 当前激活页签的 fullPath（关闭后据此导航）。 */
  const activeFullPath = computed(
    () => tabs.value.find(t => t.key === activeKey.value)?.fullPath ?? '/',
  )

  /** 打开/复用页签；返回是否被上限阻断（true = 未打开，需弹 toast）。 */
  function open(input: { fullPath: string, title: string }): boolean {
    const r = openTab(state.value, input)
    state.value = r.state
    return r.blocked
  }

  function activate(key: string) {
    if (state.value.activeKey !== key)
      state.value = { ...state.value, activeKey: key }
  }

  function invalidate(keys: string[]) {
    if (!keys.length)
      return

    const next = { ...cacheVersions.value }
    for (const key of keys)
      next[key] = (next[key] ?? 0) + 1
    cacheVersions.value = next
    invalidatedKeys.value = [...new Set([...invalidatedKeys.value, ...keys])]
  }

  function applyClose(transform: () => ReturnType<typeof closeTab>) {
    const before = state.value.tabs.map(tab => tab.key)
    const next = transform()
    state.value = next
    const retained = new Set(next.tabs.map(tab => tab.key))
    invalidate(before.filter(key => !retained.has(key)))
  }

  function close(key: string) {
    applyClose(() => closeTab(state.value, key))
  }

  function closeOther(key: string) {
    applyClose(() => closeOthers(state.value, key))
  }

  function closeToRight(key: string) {
    applyClose(() => closeRight(state.value, key))
  }

  function closeEvery() {
    applyClose(() => closeAll())
  }

  /** 切换当前页签组件 key；外层 KeepAlive include 会据 invalidatedKeys 定向卸载旧实例。 */
  function refreshActive() {
    invalidate([activeKey.value])
  }

  function acknowledgeInvalidations(keys: string[]) {
    const completed = new Set(keys)
    invalidatedKeys.value = invalidatedKeys.value.filter(key => !completed.has(key))
    // 旧实例已卸载后不再保存历史路径；卸载前快速重开的页签仍需保留新版本。
    const retained = new Set(tabs.value.map(tab => tab.key))
    cacheVersions.value = Object.fromEntries(Object.entries(cacheVersions.value)
      .filter(([key]) => retained.has(key) || !completed.has(key)))
  }

  function pageCacheKey(fullPath: string): string {
    const key = deriveKey(fullPath)
    return `${key}::${cacheVersions.value[key] ?? 0}`
  }

  /** 覆盖某页签标题（页面拿到记录名后调用，如「合和新城」）。 */
  function setTitle(key: string, title: string) {
    const idx = state.value.tabs.findIndex(t => t.key === key)
    if (idx === -1)
      return
    const tabs = state.value.tabs.map(t => (t.key === key ? { ...t, title } : t))
    state.value = { ...state.value, tabs }
  }

  /** 仅由恢复边界传入已完成结构校验的页面；不激活或挂载后台页。 */
  function restoreSession(pages: Tab[]) {
    const previous = tabs.value.map(tab => tab.key)
    let restored = initialTabsState()
    for (const page of pages)
      restored = openTab(restored, page).state
    state.value = { ...restored, activeKey: initialTabsState().activeKey }
    closeGuards.clear()
    invalidate(previous)
  }

  function updateRestoredTab(key: string, input: { fullPath: string, title: string }) {
    if (!tabs.value.some(tab => tab.key === key))
      return
    const canonicalKey = deriveKey(input.fullPath)
    state.value = {
      ...state.value,
      activeKey: activeKey.value === key ? canonicalKey : activeKey.value,
      tabs: tabs.value
        .filter(tab => tab.key !== canonicalKey || tab.key === key)
        .map(tab => tab.key === key ? { ...tab, ...input, key: canonicalKey } : tab),
    }
    if (key !== canonicalKey) {
      invalidate([key])
      closeGuards.delete(key)
    }
  }

  return {
    tabs,
    activeKey,
    activeFullPath,
    invalidatedKeys,
    open,
    activate,
    close,
    closeOther,
    closeToRight,
    closeEvery,
    refreshActive,
    registerCloseGuard,
    requestClose,
    requestCloseOther,
    requestCloseToRight,
    requestCloseEvery,
    requestRefresh,
    acknowledgeInvalidations,
    pageCacheKey,
    setTitle,
    restoreSession,
    updateRestoredTab,
  }
})
