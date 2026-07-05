<script setup lang="ts">
// 页签栏（CONTEXT.md「页签导航」）——浏览器式多页签。
// 「监听」核心：watch 路由 → store.open（开/复用）；超限阻断则弹临时 toast 并弹回原页签。
// 交互：点页签导航、中键关闭、右键四关菜单（均保留首页）。
import { onKeyStroke, useEventListener } from '@vueuse/core'
import { HOME_KEY } from '~/lib/tabs/tab-machine'
import { routeTitle } from '~/lib/tabs/tab-title'

const route = useRoute()
const router = useRouter()
const tabsStore = useTabsStore()
const kit = useKitUI()

// ── 路由监听：进入任意路由即开/复用页签；超限则 toast + 弹回 ──
watch(
  () => route.fullPath,
  (fullPath) => {
    const blocked = tabsStore.open({ fullPath, title: routeTitle(route.path) || '未命名' })
    if (blocked) {
      kit.warning(`页签已达上限 ${15} 个`, '请先关闭部分页签再打开新的')
      if (tabsStore.activeFullPath !== fullPath)
        router.replace(tabsStore.activeFullPath)
    }
  },
  { immediate: true },
)

function goTab(fullPath: string, key: string) {
  if (key === tabsStore.activeKey)
    return
  router.push(fullPath)
}

function closeAndFollow(key: string) {
  tabsStore.close(key)
  if (tabsStore.activeFullPath !== route.fullPath)
    router.push(tabsStore.activeFullPath)
}

// ── 右键菜单 ──
const menu = ref<{ open: boolean, x: number, y: number, key: string }>({ open: false, x: 0, y: 0, key: '' })

function openMenu(e: MouseEvent, key: string) {
  menu.value = { open: true, x: e.clientX, y: e.clientY, key }
}
function closeMenu() {
  menu.value.open = false
}

const menuTab = computed(() => tabsStore.tabs.find(t => t.key === menu.value.key))
const menuIdx = computed(() => tabsStore.tabs.findIndex(t => t.key === menu.value.key))
const hasRight = computed(() =>
  tabsStore.tabs.slice(menuIdx.value + 1).some(t => t.key !== HOME_KEY),
)
const hasOthers = computed(() =>
  tabsStore.tabs.some(t => t.key !== HOME_KEY && t.key !== menu.value.key),
)

function act(fn: () => void) {
  fn()
  closeMenu()
  if (tabsStore.activeFullPath !== route.fullPath)
    router.push(tabsStore.activeFullPath)
}

useEventListener('click', () => { if (menu.value.open) closeMenu() })
useEventListener('scroll', () => { if (menu.value.open) closeMenu() }, true)
onKeyStroke('Escape', () => { if (menu.value.open) closeMenu() })
</script>

<template>
  <div class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface-2 px-2">
    <button
      v-for="tab in tabsStore.tabs"
      :key="tab.key"
      type="button"
      class="group/tab inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border px-2.5 text-12px transition-colors focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]"
      :class="tab.key === tabsStore.activeKey
        ? 'border-line bg-panel font-600 text-brand-deep shadow-[var(--sidebar-shadow)]'
        : 'border-transparent text-ink-soft hover:bg-surface-3 hover:text-ink'"
      @click="goTab(tab.fullPath, tab.key)"
      @click.middle.prevent="tab.closable && closeAndFollow(tab.key)"
      @contextmenu.prevent="openMenu($event, tab.key)"
    >
      <span
        v-if="tab.key === HOME_KEY"
        class="i-lucide-home h-[13px] w-[13px] shrink-0"
        aria-hidden="true"
      />
      <span class="max-w-[160px] truncate">{{ tab.title }}</span>
      <span
        v-if="tab.closable"
        class="i-lucide-x h-[13px] w-[13px] shrink-0 rounded-[3px] text-ink-faint opacity-60 hover:bg-surface-sink hover:text-danger hover:opacity-100"
        aria-hidden="true"
        @click.stop="closeAndFollow(tab.key)"
      />
    </button>
  </div>

  <!-- 右键菜单 -->
  <Teleport to="body">
    <div
      v-if="menu.open"
      class="fixed z-[9700] min-w-[128px] rounded-[8px] border border-line bg-panel py-1 shadow-[var(--shadow-pop)]"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button
        type="button"
        class="flex w-full items-center px-3 py-1.5 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!menuTab?.closable"
        @click="act(() => tabsStore.close(menu.key))"
      >
        关闭当前
      </button>
      <button
        type="button"
        class="flex w-full items-center px-3 py-1.5 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!hasOthers"
        @click="act(() => tabsStore.closeOther(menu.key))"
      >
        关闭其他
      </button>
      <button
        type="button"
        class="flex w-full items-center px-3 py-1.5 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!hasRight"
        @click="act(() => tabsStore.closeToRight(menu.key))"
      >
        关闭右侧
      </button>
      <div class="my-1 h-px bg-line" />
      <button
        type="button"
        class="flex w-full items-center px-3 py-1.5 text-12px text-ink-soft hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!hasOthers"
        @click="act(() => tabsStore.closeEvery())"
      >
        关闭全部
      </button>
    </div>
  </Teleport>
</template>
