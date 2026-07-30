<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { evaluateQuantityFormula } from '~/lib/quantity/formula'

const props = defineProps<{
  formula: string
}>()

const emit = defineEmits<{
  updateFormula: [formula: string]
}>()

const editing = shallowRef(false)
const draft = shallowRef(props.formula)
const editor = useTemplateRef<HTMLInputElement>('editor')
const result = computed(() => evaluateQuantityFormula(draft.value))
const showEditor = computed(() => editing.value || !result.value.ok)
const displayValue = computed(() => {
  if (!result.value.ok || result.value.value == null)
    return '—'
  return String(result.value.value)
})

watch(
  () => props.formula,
  (formula) => {
    if (!editing.value)
      draft.value = formula
  },
)

async function startEditing() {
  editing.value = true
  await nextTick()
  editor.value?.focus()
  editor.value?.select()
}

function updateFormula(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
  emit('updateFormula', draft.value)
}

function finishEditing() {
  if (!result.value.ok)
    return
  editing.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter')
    return
  event.preventDefault()
  finishEditing()
}
</script>

<template>
  <div class="min-w-0">
    <template v-if="showEditor">
      <input
        ref="editor"
        :value="draft"
        class="field-input w-full font-mono"
        :class="result.ok ? '' : 'border-danger text-danger'"
        aria-label="现场复核算式"
        placeholder="如 客厅（3.2×4）"
        @input="updateFormula"
        @blur="finishEditing"
        @keydown="handleKeydown"
      >
      <div v-if="!result.ok" class="mt-1 px-1 text-9px text-danger" role="alert">
        {{ result.error }}
      </div>
    </template>
    <button
      v-else
      type="button"
      class="field-input w-full cursor-text text-right font-mono hover:border-brand focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/15"
      :aria-label="`现场复核量 ${displayValue}，点击编辑算式`"
      @click="startEditing"
    >
      {{ displayValue }}
    </button>
  </div>
</template>
