<script setup lang="ts">
const props = withDefaults(defineProps<{
  collapsed?: boolean
  focusToken?: number
}>(), {
  collapsed: false,
  focusToken: 0,
})

const emit = defineEmits<{
  expand: []
}>()

const query = defineModel<string>({ default: '' })
const inputEl = useTemplateRef<HTMLInputElement>('inputEl')

watch(
  () => props.focusToken,
  async () => {
    if (props.collapsed)
      return
    await nextTick()
    inputEl.value?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <button
    v-if="collapsed"
    type="button"
    class="mx-auto grid h-10 w-10 place-items-center border border-line rounded-[var(--radius-btn)] bg-surface-2 text-[var(--shell-sidebar-muted)] outline-none transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)] focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
    title="搜索菜单"
    aria-label="搜索菜单"
    @click="emit('expand')"
  >
    <span class="i-lucide-search h-4 w-4" aria-hidden="true" />
  </button>

  <label
    v-else
    class="flex h-8 items-center gap-2 border border-[var(--shell-sidebar-border)] rounded-[var(--radius-btn)] bg-[var(--shell-sidebar-input)] px-[10px] text-[var(--shell-sidebar-muted)] focus-within:border-brand focus-within:[box-shadow:0_0_0_2px_var(--brand-ring)]"
  >
    <span class="i-lucide-search h-4 w-4 flex-none" aria-hidden="true" />
    <input
      ref="inputEl"
      v-model="query"
      type="search"
      class="min-w-0 flex-1 border-0 bg-transparent text-13px text-[var(--shell-sidebar-text)] outline-none placeholder:text-[var(--shell-sidebar-muted)]"
      placeholder="搜索菜单"
      autocomplete="off"
    >
    <button
      v-if="query"
      type="button"
      class="grid h-6 w-6 flex-none place-items-center border-0 rounded-[var(--radius-sm)] bg-transparent text-[var(--shell-sidebar-muted)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]"
      title="清空搜索"
      aria-label="清空搜索"
      @click.prevent="query = ''"
    >
      <span class="i-lucide-x h-3.5 w-3.5" aria-hidden="true" />
    </button>
  </label>
</template>
