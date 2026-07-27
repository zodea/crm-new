<script setup lang="ts">
import { computed } from 'vue'

type StatePanelKind = 'loading' | 'empty' | 'error'

const {
  kind,
  title,
  description = '',
  actionLabel = '',
  compact = false,
} = defineProps<{
  kind: StatePanelKind
  title: string
  description?: string
  actionLabel?: string
  compact?: boolean
}>()

defineEmits<{
  action: []
}>()

const role = computed(() => kind === 'error' ? 'alert' : 'status')
const iconClass = computed(() => {
  if (kind === 'error')
    return 'i-lucide-circle-alert text-danger'
  return 'i-lucide-inbox text-ink-faint'
})
</script>

<template>
  <section
    data-ui="state-panel"
    :data-state="kind"
    :role="role"
    :aria-label="title"
    :aria-busy="kind === 'loading' ? 'true' : undefined"
    :aria-live="kind === 'error' ? 'assertive' : 'polite'"
    class="panel flex min-w-0 flex-col items-center justify-center text-center"
    :class="compact ? 'px-5 py-6' : 'min-h-64 px-6 py-10'"
  >
    <template v-if="kind === 'loading'">
      <span class="sr-only">{{ title }}</span>
      <div class="w-full max-w-2xl space-y-4" aria-hidden="true">
        <span
          data-ui="state-panel-skeleton"
          class="state-panel__skeleton mx-auto block h-5 w-42"
        />
        <span
          data-ui="state-panel-skeleton"
          class="state-panel__skeleton mx-auto block h-3 w-64 max-w-full"
        />
        <div class="grid grid-cols-1 mt-5 gap-3 sm:grid-cols-2">
          <span
            v-for="index in 6"
            :key="index"
            data-ui="state-panel-skeleton"
            class="state-panel__skeleton block h-12"
          />
        </div>
      </div>
    </template>

    <template v-else>
      <span aria-hidden="true" class="mb-3 h-8 w-8" :class="iconClass" />
      <h2 class="m-0 text-16px font-700 text-ink">
        {{ title }}
      </h2>
      <p v-if="description" class="m-0 mt-2 max-w-xl text-13px leading-6 text-ink-soft">
        {{ description }}
      </p>
      <div v-if="$slots.action || actionLabel" class="mt-5">
        <slot name="action">
          <button
            type="button"
            class="btn-primary"
            @click="$emit('action')"
          >
            {{ actionLabel }}
          </button>
        </slot>
      </div>
    </template>
  </section>
</template>

<style scoped>
.state-panel__skeleton {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
}

.state-panel__skeleton::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 72%), transparent);
  content: "";
  animation: state-panel-shimmer 1.5s ease-in-out infinite;
  transform: translateX(-100%);
}

@keyframes state-panel-shimmer {
  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-panel__skeleton::after {
    animation: none;
  }
}
</style>
