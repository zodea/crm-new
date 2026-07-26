<script setup lang="ts">
import type { BoqCatalogSection } from '~/lib/boq/read-model'
import type { TreeNode } from '~/lib/kit/tree-nav'

const props = defineProps<{
  catalog: readonly BoqCatalogSection[]
  lineCount: number
}>()

const selected = defineModel<string>({ default: 'all' })

const items = computed<TreeNode[]>(() => [
  {
    key: 'all',
    label: '全部清单',
    icon: 'i-lucide-list-tree',
    count: props.lineCount,
    tone: 'brand',
  },
  ...props.catalog.map(section => ({
    key: `section:${section.name}`,
    label: section.name,
    icon: 'i-lucide-folder',
    count: section.trades.reduce((total, trade) => total + trade.lineIds.length, 0),
    children: section.trades.map(trade => ({
      key: `trade:${section.name}:${trade.name}`,
      label: trade.name,
      icon: 'i-lucide-hard-hat',
      count: trade.lineIds.length,
    })),
  })),
])
</script>

<template>
  <TreeNav v-model="selected" title="分部 · 工种" :items="items" />
</template>
