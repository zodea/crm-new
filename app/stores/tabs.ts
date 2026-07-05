// 页签导航 store（Pinia）——纯状态机 tab-machine 的响应式外壳 + 副作用边界。
// 唯一写路径走 action；超限由 open() 返回 blocked，交调用方弹临时 toast（CONTEXT.md）。
import {
  closeAll,
  closeOthers,
  closeRight,
  closeTab,
  initialTabsState,
  openTab,
} from '~/lib/tabs/tab-machine'

export const useTabsStore = defineStore('tabs', () => {
  const state = shallowRef(initialTabsState())

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

  function close(key: string) {
    state.value = closeTab(state.value, key)
  }

  function closeOther(key: string) {
    state.value = closeOthers(state.value, key)
  }

  function closeToRight(key: string) {
    state.value = closeRight(state.value, key)
  }

  function closeEvery() {
    state.value = closeAll()
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
    open,
    activate,
    close,
    closeOther,
    closeToRight,
    closeEvery,
    setTitle,
  }
})
