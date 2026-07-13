<script setup lang="ts">
// 左树导航（KitAtoms，发票台账/清单页同构）：两级节点 + 数量角标 + 选中态。
// 基准：DC重构设计源码/kit/KitAtoms.jsx TreeNav。
// 计数走 resolveNodeCount：父节点未显式给 count 时按子节点聚合（台账「全部」口径）。
import type { TreeNode } from '~/lib/kit/tree-nav'
import { computed } from 'vue'
import { isNodeActive, resolveNodeCount } from '~/lib/kit/tree-nav'

const props = defineProps<{
  title?: string
  items: TreeNode[]
}>()

const active = defineModel<string>()

interface Row {
  key: string
  label: string
  icon: string
  count: number | null
  tone?: 'warn' | 'brand'
  sub: boolean
  on: boolean
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const push = (node: TreeNode, sub: boolean) => {
    out.push({
      key: node.key,
      label: node.label,
      icon: node.icon || (sub ? 'i-lucide-wrench' : 'i-lucide-folder'),
      count: resolveNodeCount(node),
      tone: node.tone,
      sub,
      on: isNodeActive(node.key, active.value),
    })
  }
  for (const it of props.items) {
    push(it, false)
    if (it.children) {
      for (const c of it.children)
        push(c, true)
    }
  }
  return out
})

function iconClass(r: Row): string {
  if (r.on)
    return 'text-brand'
  if (r.tone === 'warn')
    return 'text-warn'
  if (r.tone === 'brand')
    return 'text-brand'
  return 'text-ink-faint'
}

function labelClass(r: Row): string {
  const weight = r.on ? 'font-800' : r.sub ? 'font-500' : 'font-600'
  const color = r.tone === 'warn' && !r.on ? 'text-warn-ink' : r.on ? 'text-brand-deep' : 'text-ink'
  const size = r.sub ? 'text-[13px]' : 'text-[14px]'
  return `${weight} ${color} ${size}`
}
</script>

<template>
  <div class="content-panel overflow-hidden rounded-[var(--radius-card)]">
    <div
      v-if="title"
      class="border-b border-line bg-surface-2 px-[12px] py-[10px] text-[13px] font-700 text-ink-soft"
    >
      {{ title }}
    </div>
    <div class="p-[6px]">
      <button
        v-for="r in rows"
        :key="r.key"
        type="button"
        class="mb-[2px] flex w-full cursor-pointer items-center gap-[8px] border-0 rounded-[var(--radius-btn)] pr-[10px] text-left transition-colors focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]"
        :class="[r.on ? 'bg-brand-soft' : 'bg-transparent hover:bg-surface-3', r.sub ? 'py-[6px]' : 'py-[8px]']"
        :style="{ paddingLeft: r.sub ? '24px' : '10px' }"
        @click="active = r.key"
      >
        <span aria-hidden="true" :class="[r.icon, iconClass(r), r.sub ? 'h-[12px] w-[12px]' : 'h-[14px] w-[14px]']" />
        <span
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          :class="labelClass(r)"
        >{{ r.label }}</span>
        <span
          v-if="r.count != null"
          class="rounded-full px-[7px] py-[1px] text-[12px] font-mono tabular-nums"
          :class="r.on ? 'bg-white text-brand' : 'bg-surface-3 text-ink-faint'"
        >{{ r.count }}</span>
      </button>
    </div>
  </div>
</template>
