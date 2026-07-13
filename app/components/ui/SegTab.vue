<script setup lang="ts">
// 下划线分段 tab（KitAtoms §3.5）：底部下划线标示选中，可带数量角标。
// 底座 reka-ui Tabs（ADR 0008）——roving tabindex / 方向键切换 / tablist·tab 语义交给 reka，
// props/v-model 契约不变（tabs + modelValue），视觉样式保留原样。
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

interface Tab {
  key: string
  label: string
  count?: number | null
}

defineProps<{
  tabs: Tab[]
}>()

const active = defineModel<string>()
</script>

<template>
  <TabsRoot v-model="active" activation-mode="automatic">
    <TabsList class="flex flex-wrap gap-[2px] border-b border-line">
      <!-- 选中态单源：视觉全挂 reka 的 data-state，JS 侧不再比较 active -->
      <TabsTrigger
        v-for="t in tabs"
        :key="t.key"
        :value="t.key"
        class="group -mb-px inline-flex cursor-pointer items-center gap-[6px] whitespace-nowrap border-0 border-b-2 border-transparent bg-transparent px-[14px] py-[9px] text-[14px] font-500 text-ink-soft transition-colors hover:text-brand data-[state=active]:border-brand data-[state=active]:font-700 data-[state=active]:text-brand-deep focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]"
      >
        {{ t.label }}
        <span
          v-if="t.count != null"
          class="rounded-full bg-surface-3 px-[6px] py-[1px] text-[12px] text-ink-soft font-mono tabular-nums group-data-[state=active]:bg-brand-soft group-data-[state=active]:text-brand-deep"
        >{{ t.count }}</span>
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>
