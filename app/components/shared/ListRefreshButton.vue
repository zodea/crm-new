<script setup lang="ts">
import { Button } from '~/components/ui/button'

withDefaults(defineProps<{
  loading: boolean
  ariaLabel?: string
  title?: string
  srLabel?: string
  compact?: boolean
}>(), {
  title: '刷新',
  srLabel: '刷新',
})

const emit = defineEmits<{ refresh: [] }>()
</script>

<template>
  <component
    :is="compact ? 'button' : Button"
    v-bind="compact ? { type: 'button', class: 'list-tool-button' } : { variant: 'outline', size: 'icon' }"
    :title="title"
    :aria-label="ariaLabel"
    :disabled="loading"
    @click="emit('refresh')"
  >
    <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
    <span v-if="!ariaLabel" class="sr-only">{{ srLabel }}</span>
  </component>
</template>
