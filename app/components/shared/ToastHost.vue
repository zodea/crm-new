<script setup lang="ts">
const { toasts, dismiss } = useToast()

const iconMap: Record<string, string> = {
  success: 'i-lucide-circle-check',
  error: 'i-lucide-circle-x',
  warning: 'i-lucide-triangle-alert',
  info: 'i-lucide-info',
}

const colorMap: Record<string, string> = {
  success: 'text-ok',
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-brand',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-80">
      <TransitionGroup
        enter-active-class="transition-all duration-[180ms] ease-[var(--ease-snappy)]"
        leave-active-class="transition-all duration-[150ms] ease-[var(--ease-snappy)]"
        enter-from-class="translate-x-full opacity-0"
        leave-to-class="translate-x-full opacity-0"
      >
        <div
          v-for="t in toasts"
          :key="t.id"
          class="flex items-start gap-2.5 px-3.5 py-3 bg-panel border border-line shadow-[var(--shadow-pop)] text-13px"
        >
          <span :class="[iconMap[t.type], colorMap[t.type]]" class="text-16px shrink-0 mt-px" />
          <span class="flex-1 text-ink leading-snug">{{ t.message }}</span>
          <button
            v-if="t.action"
            class="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 text-12px font-700 text-brand-deep cursor-pointer hover:opacity-80 transition-opacity"
            @click="t.action.onClick()"
          >
            {{ t.action.label }}
          </button>
          <button
            class="text-ink-faint hover:text-ink shrink-0 cursor-pointer"
            @click="dismiss(t.id)"
          >
            <span class="i-lucide-x text-13px" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
