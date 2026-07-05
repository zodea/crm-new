<script setup lang="ts">
// 下拉筛选（KitAtoms §3.6）：label + 原生 select + 自绘 chevron。
// 基准：DC重构设计源码/kit/KitAtoms.jsx SelectFilter。
interface Option {
  key: string
  label: string
}

withDefaults(defineProps<{
  label?: string
  options: Option[]
  minWidth?: number
}>(), { minWidth: 132 })

const model = defineModel<string>()
</script>

<template>
  <label class="inline-flex items-center gap-[7px]">
    <span v-if="label" class="flex-none text-[12px] font-700 text-ink-soft">{{ label }}</span>
    <span class="relative inline-flex">
      <select
        v-model="model"
        :aria-label="label"
        class="appearance-none cursor-pointer border border-line-strong rounded-[var(--radius-btn)] bg-white pl-[12px] pr-[30px] py-[7px] text-[13px] font-600 text-ink outline-none focus-visible:border-brand focus-visible:shadow-[0_0_0_2px_rgba(57,118,198,0.25)]"
        :style="{ minWidth: `${minWidth}px` }"
      >
        <option v-for="o in options" :key="o.key" :value="o.key">{{ o.label }}</option>
      </select>
      <span aria-hidden="true" class="pointer-events-none absolute right-[9px] top-1/2 flex -translate-y-1/2">
        <span class="i-lucide-chevron-down h-[14px] w-[14px] text-ink-faint" />
      </span>
    </span>
  </label>
</template>
