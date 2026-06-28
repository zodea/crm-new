<script setup lang="ts">
const props = defineProps<{
  total: number
  page: number
  pageSize?: number
}>()

const emit = defineEmits<{
  'update:page': [page: number]
}>()

const size = computed(() => props.pageSize ?? 20)
const totalPages = computed(() => Math.max(1, Math.ceil(props.total / size.value)))

const visiblePages = computed(() => {
  const pages: number[] = []
  const cur = props.page
  const total = totalPages.value
  const start = Math.max(1, cur - 2)
  const end = Math.min(total, start + 4)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
})
</script>

<template>
  <div class="flex items-center justify-end gap-1.5 py-2 px-1 border-t border-line text-12px">
    <span class="text-ink-faint mr-2">共 {{ total }} 条</span>
    <button
      class="pager-btn"
      :disabled="page <= 1"
      @click="emit('update:page', page - 1)"
    >
      <span class="i-lucide-chevron-left text-12px" />
    </button>
    <button
      v-for="p in visiblePages"
      :key="p"
      class="pager-btn"
      :class="p === page ? 'pager-active' : ''"
      @click="emit('update:page', p)"
    >
      {{ p }}
    </button>
    <button
      class="pager-btn"
      :disabled="page >= totalPages"
      @click="emit('update:page', page + 1)"
    >
      <span class="i-lucide-chevron-right text-12px" />
    </button>
  </div>
</template>
