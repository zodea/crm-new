<script setup lang="ts">
interface PreviewRoute {
  to: string
  label: string
  icon: string
}

const route = useRoute()

const previewRoutes = [
  { to: '/dev/kit-ui', label: 'KitUI', icon: 'i-lucide-panels-top-left' },
  { to: '/dev/kit-atoms', label: 'Atoms', icon: 'i-lucide-blocks' },
  { to: '/dev/kit-table', label: 'Table', icon: 'i-lucide-table-2' },
] as const satisfies readonly PreviewRoute[]

function isCurrent(path: string): boolean {
  return route.path === path
}
</script>

<template>
  <nav
    aria-label="组件预览切换"
    class="mb-4 flex w-fit items-center gap-1 border border-line rounded-[var(--radius-btn)] bg-panel p-1"
  >
    <NuxtLink
      v-for="item in previewRoutes"
      :key="item.to"
      :to="item.to"
      class="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-btn)] px-3 text-12px font-700 transition-colors duration-[var(--dur-fast)]"
      :class="isCurrent(item.to)
        ? 'bg-brand-soft text-brand-deep'
        : 'text-ink-soft hover:bg-surface-2 hover:text-ink'"
      :aria-current="isCurrent(item.to) ? 'page' : undefined"
    >
      <span class="h-3.5 w-3.5" :class="item.icon" aria-hidden="true" />
      {{ item.label }}
    </NuxtLink>
  </nav>
</template>
