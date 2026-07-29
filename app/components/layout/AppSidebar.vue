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
      class="shrink-0 gap-[12px] pb-[8px] pt-[16px]"
      :class="isVisuallyCollapsed ? 'px-[8px]' : 'px-[12px]'"
    >
      <NuxtLink
        to="/"
        class="flex items-center text-ink no-underline outline-none focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
        :class="isVisuallyCollapsed ? 'justify-center' : 'gap-[10px] px-[8px]'"
        aria-label="返回首页"
        @click="onNavigate"
      >
        <span class="grid h-9 w-9 flex-none place-items-center rounded-[var(--radius-btn)] bg-brand text-16px font-800 text-white" aria-hidden="true">瑞</span>
        <span v-if="!isVisuallyCollapsed" class="min-w-0 flex-1">
          <span class="block truncate text-16px font-800 leading-[1.2]">瑞航 CRM</span>
          <span class="mt-[2px] block truncate text-11px leading-[1.35] text-ink-soft">工程财务管理</span>
        </span>
      </NuxtLink>

      <AppSidebarSearch
        v-model="searchQuery"
        :collapsed="isVisuallyCollapsed"
        :focus-token="searchFocusToken"
        @expand="openSearch"
      />
    </SidebarHeader>

    <SidebarContent
      class="min-h-0 pb-[8px]"
      :class="isVisuallyCollapsed ? 'px-[8px]' : 'px-[12px]'"
    >
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
              data-nav-rail-group
              class="mx-auto grid h-10 w-10 place-items-center border border-line rounded-[var(--radius-btn)] bg-surface-2 text-ink-soft outline-none transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-ink focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
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

            <div v-else data-nav-group>
              <button
                type="button"
                class="mt-[4px] flex w-full items-center gap-[8px] border-0 rounded-[var(--radius-btn)] bg-transparent px-[10px] py-[8px] text-[var(--shell-sidebar-muted)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]"
                :aria-expanded="isGroupOpen(node.key)"
                @click="toggleGroup(node.key)"
              >
                <span class="h-[15px] w-[15px] flex-none" :class="node.icon" aria-hidden="true" />
                <span data-nav-group-label class="min-w-0 flex-1 truncate text-left text-12px font-800 tracking-[0.05em]">{{ node.label }}</span>
                <span
                  class="h-[14px] w-[14px] flex-none"
                  :class="isGroupOpen(node.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  aria-hidden="true"
                />
              </button>

              <div
                v-show="isGroupOpen(node.key)"
                class="ml-[8px] flex flex-col gap-[2px] border-l border-line pl-[8px]"
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
      class="shrink-0 border-t border-line pt-[12px]"
      :class="isVisuallyCollapsed ? 'mx-[8px] px-0 pb-[16px]' : 'mx-[12px] px-0 pb-[16px]'"
    >
      <button
        v-if="!isMobile"
        type="button"
        class="flex items-center justify-center gap-[8px] border border-line rounded-[var(--radius-btn)] bg-surface-2 text-12px font-700 text-ink-soft outline-none transition-colors duration-[var(--dur-fast)] hover:bg-surface-3 hover:text-ink focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
        :class="isVisuallyCollapsed ? 'mx-auto h-10 w-10' : 'w-full px-[8px] py-[8px]'"
        :title="isPinned ? '收起侧栏' : '固定侧栏'"
        :aria-label="isPinned ? '收起侧栏' : '固定侧栏'"
        :aria-pressed="isPinned"
        @click="togglePinned"
      >
        <span
          :class="isPinned ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
          class="h-4 w-4 flex-none"
          aria-hidden="true"
        />
        <span v-if="!isVisuallyCollapsed">{{ isPinned ? '收起侧栏' : '固定侧栏' }}</span>
      </button>
      <div v-if="!isVisuallyCollapsed" class="pt-[12px] text-11px leading-[1.7] text-ink-soft">
        <div>本地工具 · 数据不上传</div>
        <div>v2.0 · 工程量 / 工资模块</div>
      </div>
    </SidebarFooter>
  </Sidebar>
</template>
