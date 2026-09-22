<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  options?: readonly { key: string, label: string }[]
}>()
const model = defineModel<string[]>({ required: true })
const choices = computed(() => {
  const options = new Map((props.options ?? []).filter(option => option.key).map(option => [option.key, option]))
  for (const key of model.value) {
    if (key && !options.has(key))
      options.set(key, { key, label: key })
  }
  return [...options.values()]
})

function toggle(key: string, checked: boolean) {
  model.value = checked ? [...new Set([...model.value, key])] : model.value.filter(value => value !== key)
}
</script>

<template>
  <div role="group" :aria-label="label" class="text-12px">
    <div class="flex items-center gap-2 px-1 pb-1 text-ink-soft">
      <span class="mr-auto">已选 {{ model.length }} 项</span>
      <button type="button" class="border-0 bg-transparent p-0 text-brand disabled:text-ink-faint" :disabled="!choices.length" @click="model = choices.map(option => option.key)">
        全选
      </button>
      <button type="button" class="border-0 bg-transparent p-0 text-brand disabled:text-ink-faint" :disabled="!model.length" @click="model = []">
        清空
      </button>
    </div>
    <div class="max-h-[min(280px,40vh)] overflow-y-auto">
      <label class="kit-enum-option">
        <input type="checkbox" :checked="model.length === 0" @change="model = []">
        <span>不限</span>
      </label>
      <label v-for="option in choices" :key="option.key" class="kit-enum-option">
        <input type="checkbox" :checked="model.includes(option.key)" @change="toggle(option.key, ($event.target as HTMLInputElement).checked)">
        <span class="min-w-0 break-words">{{ option.label }}</span>
      </label>
      <span v-if="!choices.length" class="block px-1 py-2 text-ink-faint">暂无可选项</span>
    </div>
  </div>
</template>

<style scoped>
.kit-enum-option { display: flex; align-items: center; gap: 7px; min-height: 28px; padding: 3px 4px; cursor: pointer; }
.kit-enum-option:hover { background: var(--surface-2); }
.kit-enum-option input { flex: none; width: 13px; height: 13px; accent-color: var(--brand); }
</style>
