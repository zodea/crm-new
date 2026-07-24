<script setup lang="ts">
// 穿透件·金额穿透（specs §07）：聚合金额可点 → 跳来源单据列表带预筛（目标由调用点传入，
// 预筛走 query、不进页签身份）；0/空/无目标退化普通 mono 文本，不做死链。
// 字号字重随上下文继承（表格金额列/Metric 各有其阶）。
import type { RouteLocationRaw } from 'vue-router'
import { computed } from 'vue'
import { resolveMoneyLink } from '~/lib/kit/money-link'

const props = defineProps<{
  value?: number | null
  /** 目标单据列表路由（含预筛 query），如 { path: '/finance/ledger', query: { project: id } } */
  to?: RouteLocationRaw | null
  title?: string
}>()

const resolution = computed(() => resolveMoneyLink({
  value: props.value,
  hasTarget: props.to != null,
}))
</script>

<template>
  <NuxtLink
    v-if="resolution.linkable"
    :to="props.to!"
    class="font-mono tabular-nums text-brand hover:underline"
    :title="title || '查看对应单据'"
    @click.stop
  >
    {{ resolution.text }}
  </NuxtLink>
  <span v-else class="font-mono tabular-nums">{{ resolution.text }}</span>
</template>
