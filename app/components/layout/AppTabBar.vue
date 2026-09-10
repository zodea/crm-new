<script setup lang="ts">
import { onKeyStroke, useEventListener, useResizeObserver } from '@vueuse/core'
import { useOverlayStack, useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'
import { HOME_KEY, MAX_TABS } from '~/lib/tabs/tab-machine'
import { routeTitle } from '~/lib/tabs/tab-title'

const route = useRoute()
const router = useRouter()
const tabsStore = useTabsStore()
const kit = useKitUI()
const { hasActiveModal } = useOverlayStack()
const ownedLayerStyle = useOwnedOverlayLayerStyle()

const tabListEl = useTemplateRef<HTMLElement>('tabListEl')
const tabTrackEl = useTemplateRef<HTMLElement>('tabTrackEl')
const tabEls = useTemplateRef<HTMLElement[]>('tabEl')
const menuEl = useTemplateRef<HTMLElement>('menuEl')
const canScrollBackward = shallowRef(false)
const canScrollForward = shallowRef(false)
const hasTabOverflow = computed(() => canScrollBackward.value || canScrollForward.value)

function syncScrollControls() {
  const element = tabListEl.value
  if (!element) {
    canScrollBackward.value = false
    canScrollForward.value = false
    return
  }
  const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)
  canScrollBackward.value = element.scrollLeft > 1
  canScrollForward.value = element.scrollLeft < maxScrollLeft - 1
}

function pageTabs(direction: -1 | 1) {
  const element = tabListEl.value
  if (!element)
    return
  element.scrollBy({
    left: direction * Math.max(160, element.clientWidth * 0.75),
    behavior: 'smooth',
  })
}

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
    syncScrollControls()
  },
  { flush: 'post' },
)

function goTab(fullPath: string, key: string) {
  if (key !== tabsStore.activeKey)
    router.push(fullPath)
}

async function closeAndFollow(key: string) {
  if (!await tabsStore.requestClose(key))
    return
  if (tabsStore.activeFullPath !== route.fullPath)
    router.push(tabsStore.activeFullPath)
}

function refreshCurrent() {
  void tabsStore.requestRefresh()
}

useEventListener(tabListEl, 'wheel', (event) => {
  const element = tabListEl.value
  if (!element || element.scrollWidth <= element.clientWidth)
    return
  event.preventDefault()
  element.scrollLeft += event.deltaY || event.deltaX
}, { passive: false })
useEventListener(tabListEl, 'scroll', syncScrollControls, { passive: true })
useResizeObserver(
  () => [tabListEl.value, tabTrackEl.value],
  syncScrollControls,
)

watch(
  () => tabsStore.tabs.length,
  async () => {
    await nextTick()
    syncScrollControls()
  },
  { flush: 'post', immediate: true },
)

const menu = shallowRef({ open: false, x: 0, y: 0, key: '' })

async function showMenu(key: string, x: number, y: number) {
  if (hasActiveModal.value)
    return
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

watch(hasActiveModal, (active) => {
  if (active)
    closeMenu()
})

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

async function act(action: () => Promise<boolean>) {
  const pending = action()
  closeMenu()
  if (!await pending)
    return
  if (tabsStore.activeFullPath !== route.fullPath)
    router.push(tabsStore.activeFullPath)
}

useEventListener('click', () => closeMenu())
useEventListener('scroll', () => closeMenu(), true)
onKeyStroke('Escape', () => closeMenu(true))
</script>

<template>
  <div
    data-shell-tabbar
    class="sticky top-[var(--header-h)] z-[var(--z-shell-tabbar)] flex h-[var(--tabbar-h)] shrink-0 border-b border-line bg-surface-2"
  >
    <nav
      id="shell-route-tabs"
      ref="tabListEl"
      class="tabbar-scroll min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-2"
      aria-label="已打开页面"
    >
      <div
        ref="tabTrackEl"
        class="h-full min-w-max flex items-stretch gap-[2px]"
      >
        <div
          v-for="tab in tabsStore.tabs"
          :key="tab.key"
          ref="tabEl"
          :data-tab-key="tab.key"
          data-shell-tab
          :data-active="tab.key === tabsStore.activeKey"
          class="browser-tab group/tab relative inline-flex max-w-[180px] shrink-0 select-none items-center gap-1 whitespace-nowrap px-2 text-12px transition-[color,background-color,box-shadow] duration-[var(--dur-fast)]"
          :class="tab.key === tabsStore.activeKey
            ? 'browser-tab--active font-500 text-brand'
            : 'font-400 text-ink-soft hover:bg-[rgb(17_24_39/5%)] hover:text-ink'"
          @contextmenu.prevent="openMenu($event, tab.key)"
        >
          <button
            type="button"
            data-tab-trigger
            class="min-w-0 flex h-full flex-1 items-center border-0 bg-transparent p-0 text-inherit outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--brand)]"
            :aria-current="tab.key === tabsStore.activeKey ? 'page' : undefined"
            @click="goTab(tab.fullPath, tab.key)"
            @keydown="openKeyboardMenu($event, tab.key)"
          >
            <span class="truncate">{{ tab.title }}</span>
          </button>
          <button
            v-if="tab.closable"
            type="button"
            class="grid h-4 w-4 shrink-0 place-items-center border-0 rounded-[4px] bg-transparent p-0 text-13px leading-none text-ink-soft outline-none hover:bg-danger-soft hover:text-danger-ink focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
            title="关闭页签"
            :aria-label="`关闭 ${tab.title}`"
            @click.stop="closeAndFollow(tab.key)"
          >
            <span class="i-lucide-x h-[12px] w-[12px]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>

    <div class="flex shrink-0 items-center gap-1 border-l border-line bg-surface-2 px-2">
      <button
        v-if="hasTabOverflow"
        type="button"
        class="tab-page-button"
        :disabled="!canScrollBackward"
        aria-label="向前翻动页签"
        aria-controls="shell-route-tabs"
        @click="pageTabs(-1)"
      >
        <span class="i-lucide-chevron-left h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        v-if="hasTabOverflow"
        type="button"
        class="tab-page-button"
        :disabled="!canScrollForward"
        aria-label="向后翻动页签"
        aria-controls="shell-route-tabs"
        @click="pageTabs(1)"
      >
        <span class="i-lucide-chevron-right h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span class="px-1 text-11px text-ink-faint" :title="`${tabsStore.tabs.length} 个页签`" :aria-label="`${tabsStore.tabs.length} 个页签`">
        <span class="font-mono tabular-nums">{{ tabsStore.tabs.length }}</span>
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
      data-overlay-owned
      class="overlay-layer-owned fixed min-w-[136px] border border-line rounded-[var(--radius-btn)] bg-panel py-1 shadow-[var(--shadow-pop)]"
      :style="[ownedLayerStyle, { left: `${menu.x}px`, top: `${menu.y}px` }]"
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
        @click="act(() => tabsStore.requestClose(menu.key))"
      >
        关闭当前
      </button>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="tab-menu-item"
        :disabled="!hasOthers"
        @click="act(() => tabsStore.requestCloseOther(menu.key))"
      >
        关闭其他
      </button>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="tab-menu-item"
        :disabled="!hasRight"
        @click="act(() => tabsStore.requestCloseToRight(menu.key))"
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
        @click="act(() => tabsStore.requestCloseEvery())"
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
  height: var(--tabbar-h);
  border-radius: 2px 2px 0 0;
}

.browser-tab--active {
  color: var(--brand);
  background: var(--panel);
  box-shadow: inset 0 -2px 0 var(--brand);
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

.tab-page-button {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: var(--radius-btn);
  color: var(--ink-soft);
  background: transparent;
}

.tab-page-button:hover:not(:disabled) {
  color: var(--brand);
  background: var(--brand-soft);
}

.tab-page-button:focus-visible {
  box-shadow: 0 0 0 2px var(--brand);
  outline: none;
}

.tab-page-button:disabled {
  color: var(--ink-faint);
  opacity: 0.45;
}
</style>
