<script setup lang="ts">
import type { NavLeaf } from '~/lib/nav/nav-tree'
import { onKeyStroke, useLocalStorage } from '@vueuse/core'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from '~/components/ui/sidebar'
import { activeNavKey, DEFAULT_OPEN_GROUPS, ensureActiveGroupOpen, filterNavTree, NAV_TREE } from '~/lib/nav/nav-tree'

const route = useRoute()
const contractStore = useContractStore()
const { state, isMobile, setOpen, setOpenMobile } = useSidebar()

const isPinned = useLocalStorage('ruihang-sidebar-pinned', true, { initOnMounted: true })
const openGroupKeys = useLocalStorage<string[]>('ruihang-sidebar-groups', DEFAULT_OPEN_GROUPS, {
  initOnMounted: true,
})
const searchQuery = shallowRef('')
const isHovering = shallowRef(false)
const forcePeek = shallowRef(false)
const searchFocusToken = shallowRef(0)

const contractDetailKind = computed(() => {
  const match = route.path.match(/^\/contract\/([^/]+)$/)
  if (!match || ['construction', 'material', 'subcontract'].includes(match[1]!))
    return null
  return contractStore.byId(match[1]!)?.kind ?? null
})

const activeKey = computed(() => activeNavKey(route.path, contractDetailKind.value))
const peekOpen = computed(() => !isMobile.value && !isPinned.value && (isHovering.value || forcePeek.value))
const isVisuallyCollapsed = computed(() => state.value === 'collapsed' && !peekOpen.value && !isMobile.value)
const visibleTree = computed(() => filterNavTree(NAV_TREE, searchQuery.value))

watch(
  isPinned,
  (pinned) => {
    setOpen(pinned)
    if (pinned)
      forcePeek.value = false
  },
  { immediate: true },
)

watch(
  [activeKey, openGroupKeys],
  ([key, openKeys]) => {
    const next = ensureActiveGroupOpen(openKeys, key)
    if (next !== openKeys)
      openGroupKeys.value = next
  },
  { immediate: true },
)

function togglePinned() {
  isPinned.value = !isPinned.value
}

function toggleGroup(key: string) {
  openGroupKeys.value = openGroupKeys.value.includes(key)
    ? openGroupKeys.value.filter(current => current !== key)
    : [...openGroupKeys.value, key]
}

function isGroupOpen(key: string): boolean {
  return searchQuery.value.length > 0 || openGroupKeys.value.includes(key)
}

function isStub(item: NavLeaf): item is NavLeaf & { to?: undefined } {
  return !item.to
}

function openSearch() {
  forcePeek.value = true
  searchFocusToken.value += 1
}

function openGroupFromRail(key: string) {
  if (!openGroupKeys.value.includes(key))
    openGroupKeys.value = [...openGroupKeys.value, key]
  forcePeek.value = true
}

function closeTemporaryPanel() {
  isHovering.value = false
  forcePeek.value = false
}

function onNavigate() {
  searchQuery.value = ''
  forcePeek.value = false
  if (isMobile.value)
    setOpenMobile(false)
}

onKeyStroke('Escape', closeTemporaryPanel)
</script>

<template>
  <Sidebar
    collapsible="icon"
    :peek-open="peekOpen"
    @mouseenter="isHovering = true"
    @mouseleave="closeTemporaryPanel"
  >
    <SidebarHeader class="shrink-0 gap-2 px-2 pb-2 pt-2">
      <div class="flex h-10 items-center gap-2">
        <button
          v-if="isVisuallyCollapsed"
          type="button"
          class="mx-auto grid h-10 w-10 place-items-center border-0 rounded-[var(--radius-btn)] bg-transparent text-[var(--shell-sidebar-text)] hover:bg-[var(--shell-sidebar-hover)]"
          title="展开侧栏"
          aria-label="临时展开侧栏"
          @click="forcePeek = true"
        >
          <span class="i-lucide-chart-no-axes-combined h-[18px] w-[18px]" aria-hidden="true" />
        </button>

        <template v-else>
          <NuxtLink
            to="/"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-btn)] px-2 py-1 text-[var(--shell-sidebar-text)] no-underline hover:bg-[var(--shell-sidebar-hover)]"
            title="返回首页"
            @click="onNavigate"
          >
            <span class="i-lucide-chart-no-axes-combined h-[18px] w-[18px] flex-none text-[var(--shell-sidebar-active-text)]" aria-hidden="true" />
            <span class="truncate text-14px font-700 tracking-wide">瑞航 CRM</span>
          </NuxtLink>
          <button
            v-if="!isMobile"
            type="button"
            class="grid h-8 w-8 flex-none place-items-center border-0 rounded-[var(--radius-btn)] bg-transparent text-[var(--shell-sidebar-muted)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]"
            :title="isPinned ? '取消固定侧栏' : '固定侧栏'"
            :aria-label="isPinned ? '取消固定侧栏' : '固定侧栏'"
            :aria-pressed="isPinned"
            @click="togglePinned"
          >
            <span :class="isPinned ? 'i-lucide-pin-off' : 'i-lucide-pin'" class="h-4 w-4" aria-hidden="true" />
          </button>
        </template>
      </div>

      <AppSidebarSearch
        v-model="searchQuery"
        :collapsed="isVisuallyCollapsed"
        :focus-token="searchFocusToken"
        @expand="openSearch"
      />
    </SidebarHeader>

    <SidebarContent class="min-h-0 px-2 pb-2">
      <nav class="shell-sidebar-scroll min-h-0 flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
        <template v-for="node in visibleTree" :key="node.key">
          <template v-if="isVisuallyCollapsed">
            <template v-if="node.type === 'item'">
              <AppSidebarNavItem
                v-if="node.to"
                :item="node as NavLeaf & { to: string }"
                :active="activeKey === node.key"
                collapsed
                @navigate="onNavigate"
              />
              <AppSidebarStubItem v-else :item="node" collapsed />
            </template>
            <button
              v-else
              type="button"
              class="mx-auto grid h-10 w-10 place-items-center border-0 rounded-[var(--radius-btn)] bg-transparent text-[var(--shell-sidebar-muted)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]"
              :title="node.label"
              :aria-label="`展开${node.label}`"
              @click="openGroupFromRail(node.key)"
            >
              <span class="h-4 w-4" :class="node.icon" aria-hidden="true" />
            </button>
          </template>

          <template v-else>
            <template v-if="node.type === 'item'">
              <AppSidebarNavItem
                v-if="node.to"
                :item="node as NavLeaf & { to: string }"
                :active="activeKey === node.key"
                @navigate="onNavigate"
              />
              <AppSidebarStubItem v-else :item="node" />
            </template>

            <div v-else>
              <button
                type="button"
                class="mt-1 flex h-8 w-full items-center gap-2 border-0 rounded-[var(--radius-btn)] bg-transparent px-3 text-[var(--shell-sidebar-muted)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]"
                :aria-expanded="isGroupOpen(node.key)"
                @click="toggleGroup(node.key)"
              >
                <span class="h-4 w-4 flex-none" :class="node.icon" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left text-12px font-600">{{ node.label }}</span>
                <span
                  class="h-3.5 w-3.5 flex-none"
                  :class="isGroupOpen(node.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  aria-hidden="true"
                />
              </button>

              <div v-show="isGroupOpen(node.key)" class="flex flex-col gap-0.5">
                <template v-for="item in node.items" :key="item.key">
                  <AppSidebarNavItem
                    v-if="!isStub(item)"
                    :item="item as NavLeaf & { to: string }"
                    :active="activeKey === item.key"
                    @navigate="onNavigate"
                  />
                  <AppSidebarStubItem v-else :item="item" />
                </template>
              </div>
            </div>
          </template>
        </template>

        <div
          v-if="!visibleTree.length && !isVisuallyCollapsed"
          class="mx-2 mt-4 rounded-[var(--radius-btn)] border border-dashed border-[var(--shell-sidebar-border)] px-3 py-5 text-center text-12px text-[var(--shell-sidebar-muted)]"
        >
          没有匹配的菜单
        </div>
      </nav>
    </SidebarContent>
  </Sidebar>
</template>
