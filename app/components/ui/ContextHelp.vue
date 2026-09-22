<script setup lang="ts">
import {
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'
import { shallowRef, useTemplateRef } from 'vue'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'

defineProps<{
  label: string
  text: string
}>()

defineSlots<{ default?: () => unknown }>()

const open = shallowRef(false)
const tooltipOpen = shallowRef(false)
const suppressTooltip = shallowRef(false)
const triggerElement = useTemplateRef<HTMLButtonElement>('triggerElement')
const ownedLayerStyle = useOwnedOverlayLayerStyle()

function changeOpen(value: boolean) {
  open.value = value
  tooltipOpen.value = false
  suppressTooltip.value = true
}

function allowTooltip() {
  suppressTooltip.value = false
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="changeOpen">
    <PopoverAnchor :reference="triggerElement ?? undefined" />
    <TooltipProvider :delay-duration="150">
      <TooltipRoot v-model:open="tooltipOpen" :disabled="open || suppressTooltip">
        <TooltipTrigger as-child>
          <PopoverTrigger as-child>
            <button
              ref="triggerElement"
              type="button"
              data-ui="context-help-trigger"
              class="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-ink-faint hover:bg-surface-2 hover:text-brand focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
              :aria-label="`查看${label}说明`"
              @click.stop
              @pointerdown.stop
              @keydown.enter.stop
              @keydown.space.stop
              @blur="allowTooltip"
              @pointerleave="allowTooltip"
            >
              <span class="i-lucide-circle-help h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>

        <TooltipPortal>
          <TooltipContent
            side="top"
            :side-offset="6"
            :collision-padding="12"
            hide-when-detached
            data-overlay-owned
            data-ui="context-help-tooltip"
            class="overlay-layer-owned max-w-[min(20rem,calc(100vw-24px))] rounded-[var(--radius-sm)] border border-line bg-panel px-2.5 py-2 text-12px leading-5 text-ink-soft shadow-[var(--shadow-pop)]"
            :style="ownedLayerStyle"
          >
            {{ text }}
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>

    <PopoverPortal>
      <PopoverContent
        align="start"
        side="bottom"
        :side-offset="6"
        :collision-padding="12"
        hide-when-detached
        data-overlay-owned
        data-ui="context-help-popover"
        class="overlay-layer-owned w-80 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-line bg-panel p-3 text-12px leading-5 text-ink-soft shadow-[var(--shadow-pop)] outline-none"
        :style="[ownedLayerStyle, { maxHeight: 'min(28rem, var(--reka-popover-content-available-height))' }]"
        @close-auto-focus="suppressTooltip = true"
        @click.stop
      >
        <div class="mb-2 flex items-center justify-between gap-3">
          <strong class="text-ink">{{ label }}说明</strong>
          <PopoverClose as-child>
            <button type="button" class="icon-btn shrink-0" :aria-label="`关闭${label}说明`">
              <span class="i-lucide-x h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </PopoverClose>
        </div>
        <slot>
          <p class="m-0 whitespace-pre-line break-words">
            {{ text }}
          </p>
        </slot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
