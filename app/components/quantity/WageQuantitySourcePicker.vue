<script setup lang="ts">
import type { WageQuantitySource } from '~/lib/quantity/wage-source'
import { WAGE_QUANTITY_SOURCE_OPTIONS } from '~/lib/quantity/wage-source'

const model = defineModel<WageQuantitySource>({ required: true })
</script>

<template>
  <label class="inline-flex items-center gap-1.5 text-10px text-ink-soft">
    <span class="font-700 text-ink">工程量比较</span>
    <select v-model="model" class="field-input h-7 min-w-28 py-0" aria-label="工程量比较口径">
      <option
        v-for="option in WAGE_QUANTITY_SOURCE_OPTIONS"
        :key="option.value"
        :value="option.value"
      >
        {{ option.label }}
      </option>
    </select>
  </label>
</template>
