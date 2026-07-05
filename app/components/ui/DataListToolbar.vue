<script setup lang="ts">
interface ColGroup {
  key: string
  label: string
}

withDefaults(defineProps<{
  title: string
  count?: number
  searchPlaceholder?: string
  colGroups?: ColGroup[]
  activeColGroup?: string
  showCreate?: boolean
  createLabel?: string
}>(), {
  searchPlaceholder: '搜索关键词',
  showCreate: true,
  createLabel: '新增',
})

const emit = defineEmits<{
  search: [value: string]
  colGroupChange: [key: string]
  create: []
  refresh: []
  export: []
  filter: []
}>()
</script>

<template>
  <div class="flex items-center gap-2 py-2.5 px-1">
    <!-- 标题 + 计数 -->
    <h2 class="text-14px font-800 text-ink whitespace-nowrap">
      {{ title }}
      <span v-if="count != null" class="text-ink-faint font-400 ml-1">
        · 共 {{ count }} 条
      </span>
    </h2>

    <!-- 列组切换 -->
    <div v-if="colGroups?.length" class="col-group ml-2">
      <button
        v-for="g in colGroups"
        :key="g.key"
        class="col-group-item"
        :class="activeColGroup === g.key ? 'col-group-active' : ''"
        @click="emit('colGroupChange', g.key)"
      >
        {{ g.label }}
      </button>
    </div>

    <div class="flex-1" />

    <!-- 搜索 -->
    <input
      class="field-input w-52"
      :placeholder="searchPlaceholder"
      @input="emit('search', ($event.target as HTMLInputElement).value)"
    >

    <!-- 操作按钮组 -->
    <button class="icon-btn" title="刷新" @click="emit('refresh')">
      <span class="i-lucide-refresh-cw text-14px" />
    </button>
    <button class="icon-btn" title="列设置">
      <span class="i-lucide-columns-3 text-14px" />
    </button>
    <button class="icon-btn" title="筛选" @click="emit('filter')">
      <span class="i-lucide-filter text-14px" />
    </button>
    <button class="icon-btn" title="导出" @click="emit('export')">
      <span class="i-lucide-download text-14px" />
    </button>
    <button
      v-if="showCreate"
      class="icon-btn-primary"
      :title="createLabel"
      @click="emit('create')"
    >
      <span class="i-lucide-plus text-14px" />
    </button>
  </div>
</template>
