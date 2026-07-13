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

function openMenu(event: MouseEvent, key: string) {
  menu.value = {
    open: true,
    x: Math.min(event.clientX, window.innerWidth - 148),
    y: Math.min(event.clientY, window.innerHeight - 166),
    key,
  }
}

function closeMenu() {
  menu.value = { ...menu.value, open: false }
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

useEventListener('click', closeMenu)
useEventListener('scroll', closeMenu, true)
onKeyStroke('Escape', closeMenu)
</script>

<template>
  <div class="flex h-[var(--tabbar-h)] shrink-0 border-b border-line bg-surface-2">
    <div
      ref="tabListEl"
      class="tabbar-scroll min-w-0 flex flex-1 items-stretch gap-px overflow-x-auto overflow-y-hidden px-2"
      role="tablist"
      aria-label="已打开页面"
    >
      <div
        v-for="tab in tabsStore.tabs"
        :key="tab.key"
        ref="tabEl"
        :data-tab-key="tab.key"
        role="tab"
        :aria-selected="tab.key === tabsStore.activeKey"
        :tabindex="tab.key === tabsStore.activeKey ? 0 : -1"
        class="group/tab inline-flex max-w-[200px] shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 text-12px outline-none transition-colors duration-[var(--dur-fast)] focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]"
        :class="tab.key === tabsStore.activeKey
          ? 'border-brand bg-brand-soft font-700 text-brand-deep'
          : 'font-500 text-ink-soft hover:bg-[rgba(17,24,39,0.05)] hover:text-ink'"
        @click="goTab(tab.fullPath, tab.key)"
        @keydown.enter.prevent="goTab(tab.fullPath, tab.key)"
        @keydown.space.prevent="goTab(tab.fullPath, tab.key)"
        @contextmenu.prevent="openMenu($event, tab.key)"
      >
        <span class="truncate">{{ tab.title }}</span>
        <button
          v-if="tab.closable"
          type="button"
          class="grid h-5 w-5 shrink-0 place-items-center border-0 rounded-[4px] bg-transparent text-ink-faint opacity-70 hover:bg-danger-soft hover:text-danger group-hover/tab:opacity-100"
          title="关闭页签"
          :aria-label="`关闭 ${tab.title}`"
          @click.stop="closeAndFollow(tab.key)"
        >
          <span class="i-lucide-x h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1 border-l border-line bg-surface-2 px-2">
      <span class="px-1 text-10px text-ink-faint" title="当前页签数量">
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
      class="shell-layer-popover fixed min-w-[136px] border border-line rounded-[var(--radius-btn)] bg-panel py-1 shadow-[var(--shadow-pop)]"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      role="menu"
      @click.stop
    >
      <button
        type="button"
        class="flex h-8 w-full items-center border-0 bg-transparent px-3 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!menuTab?.closable"
        @click="act(() => tabsStore.close(menu.key))"
      >
        关闭当前
      </button>
      <button
        type="button"
        class="flex h-8 w-full items-center border-0 bg-transparent px-3 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!hasOthers"
        @click="act(() => tabsStore.closeOther(menu.key))"
      >
        关闭其他
      </button>
      <button
        type="button"
        class="flex h-8 w-full items-center border-0 bg-transparent px-3 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!hasRight"
        @click="act(() => tabsStore.closeToRight(menu.key))"
      >
        关闭右侧
      </button>
      <div class="my-1 h-px bg-line" />
      <button
        type="button"
        class="flex h-8 w-full items-center border-0 bg-transparent px-3 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
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
</style>
