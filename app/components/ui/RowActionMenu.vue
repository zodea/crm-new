<script setup lang="ts">
import {
  DropdownMenuArrow,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { shallowRef } from 'vue'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'

export interface RowActionItem {
  key: string
  label: string
  icon?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  items: readonly RowActionItem[]
  label?: string
}>(), {
  label: '行操作',
})

const emit = defineEmits<{
  select: [key: string]
}>()

const open = shallowRef(false)
const ownedLayerStyle = useOwnedOverlayLayerStyle()

function select(item: RowActionItem) {
  if (item.disabled)
    return
  open.value = false
  emit('select', item.key)
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        data-ui="row-action-menu-trigger"
        class="icon-btn"
        :aria-label="label"
        :title="label"
      >
        <span class="i-lucide-ellipsis h-4 w-4" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        :side-offset="6"
        :collision-padding="12"
        data-overlay-owned
        class="overlay-layer-owned min-w-34 max-w-[calc(100vw-24px)] rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-pop)] outline-none"
        :style="ownedLayerStyle"
        :aria-label="label"
      >
        <div class="max-h-[var(--reka-dropdown-menu-content-available-height)] overflow-y-auto overscroll-contain p-1">
          <p v-if="!items.length" class="m-0 px-2.5 py-2 text-12px text-ink-faint">
            无可用操作
          </p>
          <DropdownMenuItem
            v-for="item in props.items"
            :key="item.key"
            class="flex w-full cursor-default select-none items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-12px outline-none data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
            :class="item.tone === 'danger' ? 'text-danger-ink' : 'text-ink'"
            :disabled="item.disabled"
            @select="select(item)"
          >
            <span v-if="item.icon" class="h-3.5 w-3.5" :class="item.icon" aria-hidden="true" />
            {{ item.label }}
          </DropdownMenuItem>
        </div>
        <DropdownMenuArrow class="fill-panel" :width="10" :height="5" />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
