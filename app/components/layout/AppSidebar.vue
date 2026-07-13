<script setup lang="ts">
// 应用侧边栏 —— 底座沿用 shadcn-vue Sidebar（状态机/快捷键/移动端 Sheet/Rail，ADR 0008），
// 导航内容层对齐 DC 设计稿批A 锁定版（app.dc.html _buildSidebar）：
// 10 组 IA（首页独立项 + 9 分组）+ NavItem 品牌签名（单字方块+名称+副提示）+
// 分组头（icon+组名+chevron）+ 子项左竖线缩进 + 折叠态单字方块列 + 底部收起按钮/注脚。
// 未实装页面 = 「待建」占位（#87 后续域 / #91 批C-E 落地后回填 nav-tree 的 to）。
import type { NavLeaf } from '~/lib/nav/nav-tree'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '~/components/ui/sidebar'
import { activeNavKey, DEFAULT_OPEN_GROUPS, NAV_TREE } from '~/lib/nav/nav-tree'

const route = useRoute()
const contractStore = useContractStore()
const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar()

/** 桌面 icon 折叠态（移动端 Sheet 内始终展开渲染） */
const isIconCollapsed = computed(() => state.value === 'collapsed' && !isMobile.value)

/** 合同详情页（/contract/[id]）按 kind 点亮来源列表 */
const contractDetailKind = computed(() => {
  const m = route.path.match(/^\/contract\/([^/]+)$/)
  if (!m || ['construction', 'material', 'subcontract'].includes(m[1]!))
    return null
  return contractStore.byId(m[1]!)?.kind ?? null
})

const activeKey = computed(() => activeNavKey(route.path, contractDetailKind.value))

const openGroups = ref(new Set<string>(DEFAULT_OPEN_GROUPS))

function toggleGroup(key: string) {
  if (openGroups.value.has(key))
    openGroups.value.delete(key)
  else
    openGroups.value.add(key)
}

// 当前路由所在分组自动展开（如直达设置组页面时）
watchEffect(() => {
  const key = activeKey.value
  if (!key)
    return
  for (const node of NAV_TREE) {
    if (node.type === 'group' && node.items.some(it => it.key === key))
      openGroups.value.add(node.key)
  }
})

function isStub(it: NavLeaf): boolean {
  return !it.to
}

/** 移动端点导航链接后收起抽屉。 */
function onNavigate() {
  if (isMobile.value)
    setOpenMobile(false)
}
</script>

<template>
  <Sidebar collapsible="icon">
    <!-- 品牌区：36px「瑞」方块 + 名称 + 副标（折叠态只留方块） -->
    <SidebarHeader class="flex-row items-center gap-[10px] px-[12px] pb-[20px] pt-[16px] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-[4px]">
      <NuxtLink to="/" class="flex min-w-0 flex-1 items-center gap-[10px] group-data-[collapsible=icon]:flex-none" @click="onNavigate">
        <span
          class="grid h-[36px] w-[36px] flex-none place-items-center rounded-[8px] bg-brand text-16px font-800 text-white"
          aria-hidden="true"
        >瑞</span>
        <span v-if="!isIconCollapsed" class="min-w-0 flex-1">
          <span class="block text-16px font-800 leading-tight text-ink">瑞航 CRM</span>
          <span class="mt-0.5 block text-11px text-ink-soft">工程财务管理</span>
        </span>
      </NuxtLink>
    </SidebarHeader>

    <SidebarContent>
      <nav class="min-h-0 flex flex-1 flex-col gap-[2px] overflow-x-hidden overflow-y-auto px-[12px] pb-[8px] group-data-[collapsible=icon]:px-[6px]">
        <template v-for="node in NAV_TREE" :key="node.key">
          <!-- 折叠态：拍平成单字方块列，分组前加横线 -->
          <template v-if="isIconCollapsed">
            <div v-if="node.type === 'group'" class="mx-[6px] my-[8px] h-px bg-line" />
            <template v-for="it in (node.type === 'group' ? node.items : [node])" :key="it.key">
              <NuxtLink
                v-if="!isStub(it)"
                :to="it.to!"
                :title="it.label"
                class="mx-auto my-[2px] grid h-[40px] w-[40px] place-items-center border rounded-[var(--radius-btn)] text-15px font-800"
                :class="activeKey === it.key
                  ? 'bg-brand-soft border-[rgba(57,118,198,0.25)] text-brand'
                  : 'bg-surface-2 border-line text-ink-soft hover:bg-surface-3'"
              >
                {{ it.mark }}
              </NuxtLink>
              <div
                v-else
                :title="`${it.label}（后续批次）`"
                class="mx-auto my-[2px] grid h-[40px] w-[40px] cursor-not-allowed place-items-center border border-line rounded-[var(--radius-btn)] bg-surface-2 text-15px font-800 text-ink-soft opacity-38"
                aria-disabled="true"
              >
                {{ it.mark }}
              </div>
            </template>
          </template>

          <!-- 展开态 -->
          <template v-else>
            <AppSidebarNavItem
              v-if="node.type === 'item'"
              :mark="node.mark" :label="node.label" :hint="node.hint" :to="node.to!"
              :active="activeKey === node.key"
              @navigate="onNavigate"
            />
            <div v-else>
              <!-- 分组头：icon + 组名 + chevron -->
              <button
                type="button"
                class="mt-[4px] flex w-full items-center gap-[8px] rounded-[var(--radius-btn)] px-[10px] py-[8px] text-ink-soft hover:bg-surface-3"
                @click="toggleGroup(node.key)"
              >
                <span class="h-[15px] w-[15px] flex-none" :class="node.icon" aria-hidden="true" />
                <span class="flex-1 text-left text-12px font-800 tracking-[var(--tracking-wide)]">{{ node.label }}</span>
                <span
                  class="h-[14px] w-[14px] flex-none"
                  :class="openGroups.has(node.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  aria-hidden="true"
                />
              </button>
              <!-- 子项：左竖线缩进 -->
              <div v-show="openGroups.has(node.key)" class="ml-[8px] flex flex-col gap-[2px] border-l border-line pl-[8px]">
                <template v-for="it in node.items" :key="it.key">
                  <AppSidebarNavItem
                    v-if="!isStub(it)"
                    :mark="it.mark" :label="it.label" :hint="it.hint" :to="it.to!"
                    :active="activeKey === it.key"
                    @navigate="onNavigate"
                  />
                  <AppSidebarStubItem v-else :mark="it.mark" :label="it.label" />
                </template>
              </div>
            </div>
          </template>
        </template>
      </nav>
    </SidebarContent>

    <!-- 底部：收起侧栏按钮 + 注脚 -->
    <SidebarFooter class="border-t border-line px-[12px] pb-[12px] pt-[12px] group-data-[collapsible=icon]:px-[6px]">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-[8px] border border-line rounded-[var(--radius-btn)] bg-surface-2 p-[8px] text-12px font-700 text-ink-soft hover:bg-surface-3"
        :title="isIconCollapsed ? '展开侧栏' : '收起侧栏'"
        @click="toggleSidebar()"
      >
        <span
          class="h-[16px] w-[16px] flex-none"
          :class="isIconCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
          aria-hidden="true"
        />
        <span v-if="!isIconCollapsed">收起侧栏</span>
      </button>
      <div v-if="!isIconCollapsed" class="px-[4px] pt-[4px] text-11px leading-relaxed text-ink-soft">
        <div>本地部署 · 数据不上传</div>
        <div>瑞航 CRM · 工程财务管理</div>
      </div>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
