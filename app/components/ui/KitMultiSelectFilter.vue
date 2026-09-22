<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'
import KitEnumFilterOptions from '~/components/ui/KitEnumFilterOptions.vue'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'

const props = withDefaults(defineProps<{
  label: string
  ariaLabel?: string
  options: readonly { key: string, label: string }[]
  minWidth?: number
  fullWidth?: boolean
  disabled?: boolean
}>(), { minWidth: 132, fullWidth: false, disabled: false })
const model = defineModel<string[]>({ required: true })
const open = shallowRef(false)
const draft = shallowRef<string[]>([])
const choices = computed(() => props.options.filter(option => option.key && option.key !== 'all'))
const summary = computed(() => model.value.length > 1
  ? `已选 ${model.value.length} 项`
  : model.value.length === 1 ? choices.value.find(option => option.key === model.value[0])?.label ?? model.value[0] : '不限')
const ownedLayerStyle = useOwnedOverlayLayerStyle()

watch(open, (value) => {
  if (value)
    draft.value = [...model.value]
})
function apply() {
  model.value = [...draft.value]
  open.value = false
}
function clear() {
  model.value = []
  open.value = false
}
</script>

<template>
  <div class="inline-flex min-w-0 items-center gap-1.5" :class="{ 'w-full': fullWidth }">
    <span class="shrink-0 text-12px text-ink-soft">{{ label }}</span>
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button type="button" :disabled="disabled" :aria-label="`${ariaLabel || label}，已选 ${model.length} 项`" class="kit-multi-select-trigger" :class="{ 'is-active': model.length > 0, 'w-full': fullWidth }" :style="{ minWidth: `${minWidth}px` }">
          <span class="truncate">{{ summary }}</span>
          <span class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent :aria-label="`${label}筛选`" align="start" :side-offset="5" :collision-padding="12" data-overlay-owned :style="ownedLayerStyle" class="overlay-layer-owned w-[min(260px,calc(100vw-24px))] border border-line rounded-sm bg-panel p-3 text-12px text-ink shadow-[var(--shadow-pop)] outline-none">
          <form class="grid gap-2" @submit.prevent="apply">
            <KitEnumFilterOptions v-model="draft" :label="label" :options="choices" />
            <div class="flex justify-end gap-2">
              <button type="button" class="btn-secondary h-7 px-3 text-12px" @click="clear">
                清除
              </button>
              <button type="submit" class="btn-primary h-7 px-3 text-12px">
                应用
              </button>
            </div>
          </form>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>

<style scoped>
.kit-multi-select-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; height: 32px; max-width: 100%; padding: 0 9px; border: 1px solid var(--line-strong); border-radius: var(--radius-btn); background: var(--panel); color: var(--ink); font-size: 12px; cursor: pointer; outline: none; }
.kit-multi-select-trigger.is-active { color: var(--brand); }
.kit-multi-select-trigger:focus-visible { outline: 1px solid var(--brand); outline-offset: 1px; }
.kit-multi-select-trigger:disabled { cursor: not-allowed; opacity: .7; }
</style>
