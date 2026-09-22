<script setup lang="ts">
import type { NavLeaf } from '~/lib/nav/nav-tree'
import { onKeyStroke, useLocalStorage } from '@vueuse/core'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from '~/components/ui/sidebar'
import {
  activeNavKey,
  DEFAULT_OPEN_GROUPS,
  ensureActiveGroupOpen,
  filterNavTree,
  NAV_TREE,
  toggleExclusiveGroup,
} from '~/lib/nav/nav-tree'

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
  activeKey,
  (key) => {
    const next = ensureActiveGroupOpen(openGroupKeys.value, key)
    if (next !== openGroupKeys.value)
      openGroupKeys.value = next
  },
  { immediate: true },
)

function togglePinned() {
  isPinned.value = !isPinned.value
}

function toggleGroup(key: string) {
  openGroupKeys.value = toggleExclusiveGroup(openGroupKeys.value, key)
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
    openGroupKeys.value = [key]
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
    <SidebarHeader
      class="shrink-0 gap-3 pb-3 pt-3"
      :class="isVisuallyCollapsed ? 'px-1.5' : 'px-2'"
    >
      <NuxtLink
        to="/"
        class="flex h-8 items-center text-[var(--shell-sidebar-text)] no-underline outline-none focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
        :class="isVisuallyCollapsed ? 'justify-center' : 'gap-2 px-1'"
        aria-label="返回首页"
        @click="onNavigate"
      >
        <span class="grid h-7 w-7 flex-none place-items-center rounded-[2px] bg-brand text-14px font-700 text-white" aria-hidden="true">瑞</span>
        <span v-if="!isVisuallyCollapsed" class="min-w-0 flex-1 truncate text-16px font-600 leading-[1.2]">瑞航 CRM</span>
      </NuxtLink>

      <AppSidebarSearch
        v-model="searchQuery"
        :collapsed="isVisuallyCollapsed"
        :focus-token="searchFocusToken"
        @expand="openSearch"
      />
    </SidebarHeader>

    <SidebarContent
      class="min-h-0 pb-2"
      :class="isVisuallyCollapsed ? 'px-1.5' : 'px-1'"
    >
      <nav class="shell-sidebar-scroll min-h-0 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
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
              data-nav-rail-group
              class="mx-auto grid h-9 w-9 place-items-center border-0 rounded-[2px] bg-transparent text-[var(--shell-sidebar-muted)] outline-none transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)] focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
              :title="node.label"
              :aria-label="`展开${node.label}`"
              @click="openGroupFromRail(node.key)"
            >
              <span class="h-[18px] w-[18px]" :class="node.icon" aria-hidden="true" />
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

            <div v-else data-nav-group>
              <button
                type="button"
                class="flex h-[38px] w-full items-center gap-2 border-0 rounded-[2px] bg-transparent px-[10px] text-[var(--shell-sidebar-muted)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]"
                :aria-expanded="isGroupOpen(node.key)"
                @click="toggleGroup(node.key)"
              >
                <span class="h-[18px] w-[18px] flex-none" :class="node.icon" aria-hidden="true" />
                <span data-nav-group-label class="min-w-0 flex-1 truncate text-left text-14px font-500 leading-5">{{ node.label }}</span>
                <span
                  class="h-4 w-4 flex-none"
                  :class="isGroupOpen(node.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  aria-hidden="true"
                />
              </button>

              <div
                v-show="isGroupOpen(node.key)"
                class="flex flex-col pl-4"
              >
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
          class="mx-2 mt-4 rounded-[var(--radius-btn)] border border-dashed border-[var(--shell-sidebar-border)] px-3 py-5 text-center text-13px text-[var(--shell-sidebar-muted)]"
        >
          没有匹配的菜单
        </div>
      </nav>
    </SidebarContent>

    <SidebarFooter
      class="shrink-0 border-t border-[var(--shell-sidebar-border)] py-1.5"
      :class="isVisuallyCollapsed ? 'mx-1.5 px-0' : 'mx-2 px-0'"
    >
      <button
        v-if="!isMobile"
        type="button"
        class="flex items-center justify-center gap-2 border-0 rounded-[2px] bg-transparent text-14px text-[var(--shell-sidebar-muted)] outline-none transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)] focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
        :class="isVisuallyCollapsed ? 'mx-auto h-9 w-9' : 'h-[38px] w-full px-2'"
        :title="isPinned ? '收起侧栏' : '固定侧栏'"
        :aria-label="isPinned ? '收起侧栏' : '固定侧栏'"
        :aria-pressed="isPinned"
        @click="togglePinned"
      >
        <span
          :class="isPinned ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
          class="h-[18px] w-[18px] flex-none"
          aria-hidden="true"
        />
        <span v-if="!isVisuallyCollapsed">{{ isPinned ? '收起侧栏' : '固定侧栏' }}</span>
      </button>
    </SidebarFooter>
  </Sidebar>
</template>
