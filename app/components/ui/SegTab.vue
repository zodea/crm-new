<script setup lang="ts">
// 分段 tab（KitAtoms §3.5）。两种观感，语义一份：
//   underline（默认）—— 底部下划线，用于独占一行的分段导航
//   pill —— 描边分段按钮组，用于收进工具栏内联的模式切换（省一整行高度）
// 底座 reka-ui Tabs（ADR 0008）——roving tabindex / 方向键切换 / tablist·tab 语义交给 reka，
// 换观感不换语义：两种 variant 都仍是 tablist/tab，键盘操作与测试选择器不受影响。
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
// 显式 import：组件测试环境（tests/components）不带 Nuxt 自动导入
import { computed } from 'vue'

interface Tab {
  key: string
  label: string
  count?: number | null
  /** pill 变体的前置图标类名（如 i-lucide-printer）；underline 变体忽略 */
  icon?: string
}

const props = withDefaults(defineProps<{
  tabs: Tab[]
  variant?: 'underline' | 'pill'
}>(), {
  variant: 'underline',
})

const active = defineModel<string>()

const isPill = computed(() => props.variant === 'pill')

// 选中态视觉全挂 reka 的 data-state，JS 侧不比较 active（选中态单源）
const listClass = computed(() => isPill.value
  ? 'inline-flex overflow-hidden border border-line-strong rounded-[var(--radius-btn)] bg-panel'
  : 'flex flex-wrap gap-[2px] border-b border-line')

const triggerClass = computed(() => isPill.value
  ? 'group h-8 inline-flex cursor-pointer items-center gap-[6px] whitespace-nowrap border-0 bg-panel px-3 py-0 text-[13px] font-600 text-ink-soft transition-colors hover:bg-surface-3 data-[state=active]:bg-brand-soft data-[state=active]:font-800 data-[state=active]:text-brand-deep focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]'
  : 'group -mb-px h-8 inline-flex cursor-pointer items-center gap-[6px] whitespace-nowrap border-0 border-b-2 border-transparent bg-transparent px-3 py-0 text-[13px] font-500 text-ink-soft transition-colors hover:text-brand data-[state=active]:border-brand data-[state=active]:font-700 data-[state=active]:text-brand-deep focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]')
</script>

<template>
  <TabsRoot v-model="active" activation-mode="automatic">
    <TabsList :class="listClass">
      <TabsTrigger
        v-for="t in tabs"
        :key="t.key"
        :value="t.key"
        :class="triggerClass"
      >
        <span v-if="isPill && t.icon" :class="t.icon" class="text-[14px]" aria-hidden="true" />
        {{ t.label }}
        <span
          v-if="t.count != null"
          class="rounded-full bg-surface-3 px-[6px] py-[1px] text-[11px] text-ink-soft font-mono tabular-nums group-data-[state=active]:bg-brand-soft group-data-[state=active]:text-brand-deep"
        >{{ t.count }}</span>
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>
