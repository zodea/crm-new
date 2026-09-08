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
    class="mx-auto grid h-9 w-9 place-items-center border-0 rounded-[2px] bg-[var(--shell-sidebar-input)] text-[var(--shell-sidebar-muted)] outline-none transition-colors duration-[var(--dur-fast)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)] focus-visible:[box-shadow:0_0_0_2px_var(--brand)]"
    title="搜索菜单"
    aria-label="搜索菜单"
    @click="emit('expand')"
  >
    <span class="i-lucide-search h-[18px] w-[18px]" aria-hidden="true" />
  </button>

  <label
    v-else
    class="flex h-9 items-center gap-2 border border-[var(--shell-sidebar-border)] rounded-[2px] bg-[var(--shell-sidebar-input)] px-2 text-[var(--shell-sidebar-muted)] focus-within:border-brand focus-within:[box-shadow:0_0_0_2px_var(--brand-ring)]"
  >
    <span class="i-lucide-search h-[18px] w-[18px] flex-none" aria-hidden="true" />
    <input
      ref="inputEl"
      v-model="query"
      type="search"
      aria-label="搜索菜单"
      class="min-w-0 flex-1 border-0 bg-transparent text-14px text-[var(--shell-sidebar-text)] outline-none placeholder:text-[var(--shell-sidebar-muted)]"
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
