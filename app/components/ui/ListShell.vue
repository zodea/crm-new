<script setup lang="ts">
import type { TreeNode } from '~/lib/kit/tree-nav'
import { computed, shallowRef } from 'vue'

interface ListView {
  key: string
  label: string
}

const props = defineProps<{
  tree?: TreeNode[]
  views?: ListView[]
  summary?: Record<string, number | string>
  continuous?: boolean
}>()

const treeKey = defineModel<string>('treeKey')
const viewKey = defineModel<string>('viewKey')
const treeCollapsed = shallowRef(false)

const hasTree = computed(() => (props.tree?.length ?? 0) > 0)
const hasViews = computed(() => (props.views?.length ?? 0) > 0)
const hasSummary = computed(() => Object.keys(props.summary ?? {}).length > 0)
const formattedSummary = computed(() =>
  Object.entries(props.summary ?? {}).map(([label, value]) => ({
    label,
    value: typeof value === 'number'
      ? value.toLocaleString('zh-CN', {
          minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
          maximumFractionDigits: 2,
        })
      : value,
  })),
)
</script>

<template>
  <section
    class="min-w-0 grid"
    :class="[
      hasTree && !treeCollapsed ? 'md:grid-cols-[200px_minmax(0,1fr)]' : 'grid-cols-1',
      continuous ? 'list-shell--continuous gap-0 overflow-clip border border-line rounded-[var(--radius-card)] bg-panel' : 'gap-3',
    ]"
    data-list-shell
  >
    <aside
      v-if="hasTree && !treeCollapsed"
      data-list-shell-tree
      class="min-w-0 md:w-[200px]"
      :class="continuous ? 'border-b border-line p-2 md:border-b-0 md:border-r' : ''"
    >
      <div class="mb-2 flex justify-end">
        <button
          type="button"
          class="btn-ghost min-h-8 px-2 text-[12px]"
          aria-label="收起分类"
          @click="treeCollapsed = true"
        >
          <span aria-hidden="true" class="i-lucide-panel-left-close h-3.5 w-3.5" />
          收起
        </button>
      </div>
      <nav aria-label="列表分类">
        <TreeNav
          v-model="treeKey"
          :items="tree ?? []"
        />
      </nav>
    </aside>

    <div class="min-w-0">
      <header
        v-if="$slots.heading || $slots.toolbar || $slots.actions || hasViews || (hasTree && treeCollapsed)"
        class="flex min-w-0 flex-wrap items-center gap-2"
        :class="continuous ? 'px-3 py-2' : 'mb-2'"
        data-list-shell-toolbar
      >
        <slot name="heading" />
        <button
          v-if="hasTree && treeCollapsed"
          type="button"
          class="btn-secondary min-h-8 px-2 text-[12px]"
          aria-label="展开分类"
          @click="treeCollapsed = false"
        >
          <span aria-hidden="true" class="i-lucide-panel-left-open h-3.5 w-3.5" />
          分类
        </button>

        <SelectFilter
          v-if="hasViews"
          v-model="viewKey"
          aria-label="列表视图"
          :options="views ?? []"
          :min-width="148"
        />

        <div
          v-if="$slots.toolbar"
          class="min-w-0 flex-1"
        >
          <slot name="toolbar" />
        </div>

        <div v-if="$slots.actions" class="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <slot name="actions" />
        </div>
      </header>

      <div v-if="$slots.filters" class="min-w-0" :class="continuous ? 'px-3 pb-2' : 'mb-2'" data-list-shell-filters>
        <slot name="filters" />
      </div>

      <div class="min-w-0" data-list-shell-table>
        <slot name="table" />
      </div>

      <div
        v-if="hasSummary || $slots.summary"
        role="status"
        aria-label="列表汇总"
        class="sticky bottom-0 z-1 flex min-h-9 flex-wrap items-center gap-x-5 gap-y-1 border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-soft"
        :class="continuous ? 'border-t' : 'mt-[-1px] border shadow-[0_-4px_12px_rgba(15,23,42,0.04)]'"
        data-list-shell-summary
      >
        <slot name="summary">
          <span
            v-for="item in formattedSummary"
            :key="item.label"
            class="tabular-nums"
          >
            <strong class="font-700 text-ink">{{ item.label }}:</strong>
            {{ item.value }}；
          </span>
        </slot>
      </div>
    </div>
  </section>
</template>

<style scoped>
.list-shell--continuous :deep([data-ui="kit-table"]) {
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
  box-shadow: none;
}
</style>
