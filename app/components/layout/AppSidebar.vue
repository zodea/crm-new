<script setup lang="ts">
// 应用侧边栏 —— 基于 ui/sidebar（shadcn-vue Sidebar 体系，ADR 0008），
// 组合方式对照官方 dashboard 示例 AppSidebar.vue；保留项目特色：
// 毛玻璃底（--sidebar-background）+ 中文单字方块（首/项/基/资/合/包/材）+ 分组展开逻辑。
// 单子项分组（首页/项目）= 直接导航链接；多子项分组 = 点击展开子菜单。
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '~/components/ui/sidebar'

const route = useRoute()
const { state, isMobile, setOpen, setOpenMobile } = useSidebar()

interface NavGroup {
  char: string
  label: string
  icon: string
  children: { label: string, to: string }[]
}

const navGroups: NavGroup[] = [
  {
    char: '首',
    label: '首页',
    icon: 'i-lucide-home',
    children: [{ label: '首页概览', to: '/' }],
  },
  {
    char: '项',
    label: '项目信息',
    icon: 'i-lucide-building',
    children: [
      { label: '项目列表', to: '/project' },
    ],
  },
  {
    char: '基',
    label: '基础信息',
    icon: 'i-lucide-database',
    children: [
      { label: '分供方', to: '/base/supplier' },
      { label: '班组管理', to: '/base/crew' },
      { label: '工人信息', to: '/base/worker' },
    ],
  },
  {
    char: '资',
    label: '资金管理',
    icon: 'i-lucide-wallet',
    children: [
      { label: '发票识别', to: '/finance/invoice' },
      { label: '开票因子', to: '/finance/invoice/factor' },
    ],
  },
  {
    char: '合',
    label: '主合同管理',
    icon: 'i-lucide-file-signature',
    children: [],
  },
  {
    char: '包',
    label: '分包及人工',
    icon: 'i-lucide-users',
    children: [
      { label: '工程量管理', to: '/subcontract/quantity' },
      { label: '工资核算', to: '/subcontract/payroll' },
    ],
  },
  {
    char: '材',
    label: '乙供材管理',
    icon: 'i-lucide-truck',
    children: [
      { label: '送货单识别', to: '/material/delivery' },
      { label: '单价对比', to: '/material/price' },
    ],
  },
]

const expandedGroups = ref<Set<string>>(new Set(['首页']))

function toggleGroup(label: string) {
  if (expandedGroups.value.has(label))
    expandedGroups.value.delete(label)
  else
    expandedGroups.value.add(label)
}

function isChildActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

const activeGroups = computed(() => {
  const set = new Set<string>()
  for (const g of navGroups) {
    if (g.children.some(c => isChildActive(c.to)))
      set.add(g.label)
  }
  return set
})

watchEffect(() => {
  for (const label of activeGroups.value)
    expandedGroups.value.add(label)
})

/** 多子项分组的表头点击：icon 折叠态先展开侧栏再开组；展开态切换开合。 */
function onGroupClick(group: NavGroup) {
  if (state.value === 'collapsed' && !isMobile.value) {
    setOpen(true)
    expandedGroups.value.add(group.label)
    return
  }
  toggleGroup(group.label)
}

/** 移动端点导航链接后收起抽屉。 */
function onNavigate() {
  if (isMobile.value)
    setOpenMobile(false)
}
</script>

<template>
  <Sidebar variant="inset" collapsible="icon">
    <!-- 品牌：点击回首页 -->
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child tooltip="瑞航CRM · 首页">
            <NuxtLink to="/" @click="onNavigate">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-brand text-14px font-800 text-white"
                aria-hidden="true"
              >瑞</span>
              <span class="text-15px font-600 text-ink">瑞航CRM</span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem v-for="group in navGroups" :key="group.label">
            <!-- 单子项分组：直接导航 -->
            <SidebarMenuButton
              v-if="group.children.length <= 1"
              size="lg"
              as-child
              :tooltip="group.label"
              :is-active="activeGroups.has(group.label)"
              :class="activeGroups.has(group.label) ? 'shadow-[inset_3px_0_0_var(--brand)]' : ''"
            >
              <NuxtLink :to="group.children[0]?.to ?? '/'" @click="onNavigate">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-13px font-800"
                  :class="activeGroups.has(group.label) ? 'bg-brand text-white' : 'bg-surface-2 text-ink-soft'"
                  aria-hidden="true"
                >{{ group.char }}</span>
                <span>{{ group.label }}</span>
              </NuxtLink>
            </SidebarMenuButton>

            <!-- 多子项分组：展开/收起子菜单 -->
            <template v-else>
              <SidebarMenuButton
                size="lg"
                :tooltip="group.label"
                :is-active="activeGroups.has(group.label)"
                :class="activeGroups.has(group.label) ? 'shadow-[inset_3px_0_0_var(--brand)]' : ''"
                @click="onGroupClick(group)"
              >
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-13px font-800"
                  :class="activeGroups.has(group.label) ? 'bg-brand text-white' : 'bg-surface-2 text-ink-soft'"
                  aria-hidden="true"
                >{{ group.char }}</span>
                <span>{{ group.label }}</span>
                <span
                  class="i-lucide-chevron-down ml-auto h-[13px] w-[13px] shrink-0 text-ink-faint transition-transform duration-[var(--dur-fast)]"
                  :class="expandedGroups.has(group.label) ? 'rotate-180' : ''"
                  aria-hidden="true"
                />
              </SidebarMenuButton>

              <SidebarMenuSub v-if="expandedGroups.has(group.label)">
                <SidebarMenuSubItem v-for="child in group.children" :key="child.to">
                  <SidebarMenuSubButton as-child :is-active="isChildActive(child.to)">
                    <NuxtLink :to="child.to" @click="onNavigate">
                      <span>{{ child.label }}</span>
                    </NuxtLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </template>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarRail />
  </Sidebar>
</template>
