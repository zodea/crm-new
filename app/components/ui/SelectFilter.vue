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
}>(), { minWidth: 132, placeholder: '请选择', fullWidth: false })

const model = defineModel<string>()
</script>

<template>
  <label class="inline-flex items-center gap-[7px]" :class="{ 'w-full': fullWidth }">
    <span v-if="label" class="flex-none text-[12px] font-700 text-ink-soft">{{ label }}</span>
    <SelectRoot v-model="model">
      <SelectTrigger
        :aria-label="ariaLabel || label"
        class="inline-flex h-8 items-center justify-between gap-2 cursor-pointer border border-line-strong rounded-[var(--radius-btn)] bg-panel pl-[12px] pr-[9px] text-[13px] font-600 text-ink outline-none data-[placeholder]:text-ink-faint focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_var(--brand-ring)]"
        :class="{ 'w-full': fullWidth }"
        :style="{ minWidth: `${minWidth}px` }"
      >
        <SelectValue :placeholder="placeholder" />
        <SelectIcon class="flex text-ink-faint">
          <span class="i-lucide-chevron-down h-[14px] w-[14px]" />
        </SelectIcon>
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="5"
          class="z-[9600] min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-[var(--radius-btn)] border border-line bg-panel shadow-[var(--shadow-pop)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
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
              <SelectItemText>{{ o.label }}</SelectItemText>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </label>
</template>
