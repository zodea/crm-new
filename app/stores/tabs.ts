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

  const tabs = computed(() => state.value.tabs)
  const activeKey = computed(() => state.value.activeKey)
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
    invalidatedKeys.value = keys
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

  /** 让当前页签使用新组件 key；旧 keep-alive 条目不再可达，并由 LRU 回收。 */
  function refreshActive() {
    invalidate([activeKey.value])
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
    pageCacheKey,
    setTitle,
  }
})
