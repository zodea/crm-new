<script setup lang="ts">
// 下拉筛选（KitAtoms §3.6）：label + 自绘 chevron 触发器 + 样式化下拉。
// 底座 reka-ui Select（ADR 0008）——键盘导航 / 焦点 / aria / 定位交给 reka，
// props(label/options/minWidth)/v-model 契约不变，触发器视觉保留原样。
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'

interface Option {
  key: string
  label: string
}

withDefaults(defineProps<{
  label?: string
  ariaLabel?: string
  options: Option[]
  minWidth?: number
  placeholder?: string
  fullWidth?: boolean
  disabled?: boolean
}>(), { minWidth: 132, placeholder: '请选择', fullWidth: false, disabled: false })

const model = defineModel<string>()
const ownedLayerStyle = useOwnedOverlayLayerStyle()
</script>

<template>
  <label class="inline-flex min-w-0 max-w-full items-center gap-[7px]" :class="{ 'w-full': fullWidth }">
    <span v-if="label" class="flex-none text-[12px] font-700 text-ink-soft">{{ label }}</span>
    <SelectRoot v-model="model" :disabled="disabled">
      <SelectTrigger
        :aria-label="ariaLabel || label"
        class="inline-flex h-8 max-w-full items-center justify-between gap-2 overflow-hidden cursor-pointer border border-line-strong rounded-[var(--radius-btn)] bg-panel pl-[12px] pr-[9px] text-[13px] font-600 text-ink outline-none data-[placeholder]:text-ink-faint focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_var(--brand-ring)] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70"
        :class="{ 'w-full': fullWidth }"
        :style="{ minWidth: `${minWidth}px` }"
      >
        <SelectValue :placeholder="placeholder" class="min-w-0 flex-1 truncate text-left" :title="options.find(option => option.key === model)?.label" />
        <SelectIcon class="flex flex-none text-ink-faint">
          <span class="i-lucide-chevron-down h-[14px] w-[14px]" />
        </SelectIcon>
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="5"
          data-overlay-owned
          class="overlay-layer-owned min-w-[var(--reka-select-trigger-width)] max-w-[calc(100dvw-24px)] overflow-hidden rounded-[var(--radius-btn)] border border-line bg-panel shadow-[var(--shadow-pop)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
          :style="ownedLayerStyle"
        >
          <SelectViewport class="p-[4px]">
            <SelectItem
              v-for="o in options"
              :key="o.key"
              :value="o.key"
              class="relative flex cursor-pointer select-none items-center rounded-[var(--radius-sm)] py-[6px] pl-[26px] pr-[10px] text-[14px] text-ink outline-none data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand-deep data-[state=checked]:font-700"
            >
              <SelectItemIndicator class="absolute left-[7px] inline-flex items-center">
                <span class="i-lucide-check h-[13px] w-[13px] text-brand" />
              </SelectItemIndicator>
              <SelectItemText class="min-w-0 whitespace-normal break-words">{{ o.label }}</SelectItemText>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </label>
</template>
