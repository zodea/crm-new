<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'

defineProps<{ label: string, icon: string, active?: boolean }>()
const open = defineModel<boolean>('open', { default: false })
const ownedLayerStyle = useOwnedOverlayLayerStyle()
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button type="button" class="list-tool-button" :class="active ? 'text-brand border-brand' : ''" :aria-label="label" :title="label">
        <span :class="icon" class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent :aria-label="label" align="end" :side-offset="5" :collision-padding="12" data-overlay-owned :style="ownedLayerStyle" class="overlay-layer-owned max-h-[min(480px,70vh)] w-[min(280px,calc(100vw-24px))] overflow-y-auto border border-line rounded-sm bg-panel p-3 text-12px text-ink shadow-[var(--shadow-pop)] outline-none">
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
