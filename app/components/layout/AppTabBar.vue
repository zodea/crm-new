<script setup lang="ts">
import { onKeyStroke, useEventListener } from '@vueuse/core'
import { HOME_KEY, MAX_TABS } from '~/lib/tabs/tab-machine'
import { routeTitle } from '~/lib/tabs/tab-title'

const route = useRoute()
const router = useRouter()
const tabsStore = useTabsStore()
const kit = useKitUI()

const tabListEl = useTemplateRef<HTMLElement>('tabListEl')
const tabEls = useTemplateRef<HTMLElement[]>('tabEl')
const menuEl = useTemplateRef<HTMLElement>('menuEl')

watch(
  () => route.fullPath,
  (fullPath) => {
    const blocked = tabsStore.open({ fullPath, title: routeTitle(route.path) || '未命名' })
    if (blocked) {
      kit.warning(`页签已达上限 ${MAX_TABS} 个`, '请先关闭不需要的页签')
      if (tabsStore.activeFullPath !== fullPath)
        router.replace(tabsStore.activeFullPath)
    }
  },
  { immediate: true },
)

watch(
  () => tabsStore.activeKey,
  async (key) => {
    await nextTick()
    tabEls.value?.find(element => element.dataset.tabKey === key)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  },
  { flush: 'post' },
)

function goTab(fullPath: string, key: string) {
  if (key !== tabsStore.activeKey)
    router.push(fullPath)
}

function closeAndFollow(key: string) {
  tabsStore.close(key)
  if (tabsStore.activeFullPath !== route.fullPath)
    router.push(tabsStore.activeFullPath)
}

function refreshCurrent() {
  tabsStore.refreshActive()
}

useEventListener(tabListEl, 'wheel', (event) => {
  const element = tabListEl.value
  if (!element || element.scrollWidth <= element.clientWidth)
    return
  event.preventDefault()
  element.scrollLeft += event.deltaY || event.deltaX
}, { passive: false })

const menu = shallowRef({ open: false, x: 0, y: 0, key: '' })

async function showMenu(key: string, x: number, y: number) {
  menu.value = {
    open: true,
    x: Math.min(x, window.innerWidth - 148),
    y: Math.min(y, window.innerHeight - 166),
    key,
  }
  await nextTick()
  menuEl.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
}

function openMenu(event: MouseEvent, key: string) {
  void showMenu(key, event.clientX, event.clientY)
}

function openKeyboardMenu(event: KeyboardEvent, key: string) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    return
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  void showMenu(key, rect.left, rect.bottom)
}

function closeMenu(restoreFocus = false) {
  if (!menu.value.open)
    return
  const key = menu.value.key
  menu.value = { ...menu.value, open: false }
  if (restoreFocus) {
    nextTick(() => tabEls.value
      ?.find(element => element.dataset.tabKey === key)
      ?.querySelector<HTMLButtonElement>('[data-tab-trigger]')
      ?.focus())
  }
}

function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
    return
  }
  if (event.key === 'Tab') {
    closeMenu()
    return
  }

  const items = [...(menuEl.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
    return
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length
  items[index]?.focus()
}

const menuTab = computed(() => tabsStore.tabs.find(tab => tab.key === menu.value.key))
const menuIndex = computed(() => tabsStore.tabs.findIndex(tab => tab.key === menu.value.key))
const hasRight = computed(() => tabsStore.tabs.slice(menuIndex.value + 1).some(tab => tab.key !== HOME_KEY))
const hasOthers = computed(() => tabsStore.tabs.some(tab => tab.key !== HOME_KEY && tab.key !== menu.value.key))

function act(action: () => void) {
  action()
  closeMenu()
  if (tabsStore.activeFullPath !== route.fullPath)
    router.push(tabsStore.activeFullPath)
}

useEventListener('click', () => closeMenu())
useEventListener('scroll', () => closeMenu(), true)
onKeyStroke('Escape', () => closeMenu(true))
</script>

<template>
  <div class="flex h-[var(--tabbar-h)] shrink-0 border-b border-line bg-surface-2">
    <nav
      ref="tabListEl"
      class="tabbar-scroll min-w-0 flex flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden px-2 pt-1"
      aria-label="已打开页面"
    >
      <div
        v-for="tab in tabsStore.tabs"
        :key="tab.key"
        ref="tabEl"
        :data-tab-key="tab.key"
        class="browser-tab group/tab relative inline-flex max-w-[200px] shrink-0 select-none items-center whitespace-nowrap border border-transparent text-14px transition-[color,background-color,border-color] duration-[var(--dur-fast)]"
        :class="tab.key === tabsStore.activeKey
          ? 'browser-tab--active z-[1] font-700 text-ink'
          : 'font-500 text-ink-soft hover:border-line hover:bg-surface-3 hover:text-ink'"
        @contextmenu.prevent="openMenu($event, tab.key)"
      >
        <button
          type="button"
          data-tab-trigger
          class="min-w-0 flex h-full flex-1 items-center border-0 bg-transparent py-0 pl-3 pr-1 text-inherit outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--brand)]"
          :class="tab.closable ? '' : 'pr-3'"
          :aria-current="tab.key === tabsStore.activeKey ? 'page' : undefined"
          @click="goTab(tab.fullPath, tab.key)"
          @keydown="openKeyboardMenu($event, tab.key)"
        >
          <span class="truncate">{{ tab.title }}</span>
        </button>
        <button
          v-if="tab.closable"
          type="button"
          class="mr-2 grid h-5 w-5 shrink-0 place-items-center border-0 rounded-sm bg-transparent text-ink-faint opacity-70 outline-none hover:bg-danger-soft hover:text-danger focus-visible:[box-shadow:0_0_0_2px_var(--brand)] group-hover/tab:opacity-100"
          title="关闭页签"
          :aria-label="`关闭 ${tab.title}`"
          @click.stop="closeAndFollow(tab.key)"
        >
          <span class="i-lucide-x h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </nav>

    <div class="flex shrink-0 items-center gap-1 border-l border-line bg-surface-2 px-2">
      <span class="px-1 text-12px text-ink-faint" title="当前页签数量">
        <span class="font-mono tabular-nums">{{ tabsStore.tabs.length }}</span> 个页签
      </span>
      <button
        type="button"
        class="grid h-7 w-7 place-items-center border-0 rounded-[var(--radius-btn)] bg-transparent text-ink-soft hover:bg-brand-soft hover:text-brand"
        title="刷新当前页"
        aria-label="刷新当前页"
        @click="refreshCurrent"
      >
        <span class="i-lucide-refresh-cw h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="menu.open"
      ref="menuEl"
      class="shell-layer-popover fixed min-w-[136px] border border-line rounded-[var(--radius-btn)] bg-panel py-1 shadow-[var(--shadow-pop)]"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      role="menu"
      @click.stop
      @keydown="onMenuKeydown"
    >
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="tab-menu-item"
        :disabled="!menuTab?.closable"
        @click="act(() => tabsStore.close(menu.key))"
      >
        关闭当前
      </button>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="tab-menu-item"
        :disabled="!hasOthers"
        @click="act(() => tabsStore.closeOther(menu.key))"
      >
        关闭其他
      </button>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="tab-menu-item"
        :disabled="!hasRight"
        @click="act(() => tabsStore.closeToRight(menu.key))"
      >
        关闭右侧
      </button>
      <div class="my-1 h-px bg-line" role="separator" />
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="tab-menu-item"
        :disabled="!hasOthers"
        @click="act(() => tabsStore.closeEvery())"
      >
        关闭全部
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.tabbar-scroll {
  scrollbar-width: none;
}

.tabbar-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.browser-tab {
  height: calc(var(--tabbar-h) - 4px);
  border-radius: var(--radius-btn) var(--radius-btn) 0 0;
}

.browser-tab--active {
  margin-bottom: -1px;
  border-color: var(--line);
  border-bottom-color: var(--shell-workspace-bg);
  background: var(--shell-workspace-bg);
  box-shadow: inset 0 2px 0 var(--brand);
}

/* Chrome 式连体肩线：激活页签底部自然过渡到工作区，而不是独立胶囊。 */
.browser-tab--active::before,
.browser-tab--active::after {
  position: absolute;
  bottom: 0;
  width: 10px;
  height: 10px;
  content: '';
  pointer-events: none;
}

.browser-tab--active::before {
  left: -10px;
  border-bottom-right-radius: var(--radius-btn);
  box-shadow: 5px 5px 0 4px var(--shell-workspace-bg);
}

.browser-tab--active::after {
  right: -10px;
  border-bottom-left-radius: var(--radius-btn);
  box-shadow: -5px 5px 0 4px var(--shell-workspace-bg);
}

.tab-menu-item {
  display: flex;
  width: calc(100% - 8px);
  height: 32px;
  align-items: center;
  margin-inline: 4px;
  padding-inline: 10px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--ink-soft);
  background: transparent;
  font-size: 14px;
}

.tab-menu-item:hover {
  color: var(--ink);
  background: var(--surface-3);
}

.tab-menu-item:disabled {
  opacity: 0.4;
}

.tab-menu-item:disabled:hover {
  background: transparent;
}
</style>
