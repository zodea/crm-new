<script setup lang="ts">
defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
}>()

const route = useRoute()

interface NavGroup {
  char: string
  label: string
  icon: string
  children: { label: string; to: string }[]
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
  if (expandedGroups.value.has(label)) {
    expandedGroups.value.delete(label)
  }
  else {
    expandedGroups.value.add(label)
  }
}

function isGroupActive(group: NavGroup): boolean {
  return group.children.some(c => route.path === c.to || route.path.startsWith(c.to + '/'))
}

watchEffect(() => {
  for (const g of navGroups) {
    if (isGroupActive(g))
      expandedGroups.value.add(g.label)
  }
})
</script>

<template>
  <aside
    class="flex flex-col h-screen shrink-0 border-r border-line transition-[width] duration-[var(--dur-base)] ease-[var(--ease-snappy)]"
    :class="collapsed ? 'w-[var(--sidebar-w-collapsed)]' : 'w-[var(--sidebar-w)]'"
    :style="{ background: 'rgb(255 255 255 / 82%)', backdropFilter: 'var(--sidebar-blur)' }"
  >
    <!-- 品牌 -->
    <div class="flex items-center h-[var(--header-h)] px-4 shrink-0">
      <div
        class="flex items-center justify-center w-8 h-8 rounded-[var(--radius-btn)] bg-brand text-white font-800 text-14px"
      >
        瑞
      </div>
      <span
        v-if="!collapsed"
        class="ml-2.5 text-17px font-500 text-ink whitespace-nowrap"
      >
        瑞航CRM
      </span>
    </div>

    <!-- 导航 -->
    <nav class="flex-1 overflow-y-auto px-2.5 pb-4">
      <div v-for="group in navGroups" :key="group.label" class="mb-1">
        <!-- 一级菜单 -->
        <button
          class="flex items-center w-full px-2 py-2 rounded-[var(--radius-btn)] text-left transition-colors duration-[var(--dur-fast)]"
          :class="isGroupActive(group)
            ? 'bg-brand-soft text-brand-deep font-800 shadow-[inset_3px_0_0_var(--brand)] border border-white/50'
            : 'text-ink-soft hover:bg-surface-3'"
          :style="isGroupActive(group) ? { backdropFilter: 'blur(9px)' } : {}"
          @click="collapsed ? $emit('toggle') : toggleGroup(group.label)"
        >
          <!-- 中文单字方块 -->
          <div
            class="flex items-center justify-center w-7 h-7 rounded-[6px] text-13px font-800 shrink-0"
            :class="isGroupActive(group)
              ? 'bg-brand text-white'
              : 'bg-surface-2 text-ink-soft'"
          >
            {{ group.char }}
          </div>
          <template v-if="!collapsed">
            <span class="ml-2.5 text-13px whitespace-nowrap">{{ group.label }}</span>
            <span
              v-if="group.children.length > 1"
              class="i-lucide-chevron-down ml-auto text-11px transition-transform duration-[var(--dur-fast)]"
              :class="expandedGroups.has(group.label) ? 'rotate-180' : ''"
            />
          </template>
        </button>

        <!-- 子菜单 -->
        <div
          v-if="!collapsed && expandedGroups.has(group.label) && group.children.length > 1"
          class="ml-9 mt-0.5"
        >
          <NuxtLink
            v-for="child in group.children"
            :key="child.to"
            :to="child.to"
            class="block px-2.5 py-1.5 text-12px rounded-[4px] transition-colors duration-[var(--dur-fast)]"
            :class="route.path === child.to || route.path.startsWith(child.to + '/')
              ? 'text-brand-deep font-600 bg-brand-soft/40'
              : 'text-ink-soft hover:text-ink hover:bg-surface-3'"
          >
            {{ child.label }}
          </NuxtLink>
        </div>
      </div>
    </nav>

    <!-- 收起按钮 -->
    <button
      class="flex items-center justify-center h-10 border-t border-line text-ink-faint hover:text-brand transition-colors cursor-pointer"
      @click="$emit('toggle')"
    >
      <span
        class="text-16px transition-transform duration-[var(--dur-base)]"
        :class="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
      />
    </button>
  </aside>
</template>
