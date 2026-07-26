<script setup lang="ts">
import { computed } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'

type FormFooterAction = 'cancel' | 'draft' | 'saveNew' | 'saveSubmit' | 'save'

interface Props {
  actions?: FormFooterAction[]
  dirty: boolean
  closeAfterSave?: boolean
  loadingAction?: FormFooterAction | null
}

const props = withDefaults(defineProps<Props>(), {
  actions: () => ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save'],
  closeAfterSave: false,
  loadingAction: null,
})

const emit = defineEmits<{
  action: [name: FormFooterAction]
}>()

const closeAfter = defineModel<boolean>({ default: false })

const ACTIONS = [
  { name: 'cancel', label: '取消', variant: 'secondary' },
  { name: 'draft', label: '保存草稿', variant: 'secondary' },
  { name: 'saveNew', label: '保存并新建', variant: 'secondary' },
  { name: 'saveSubmit', label: '保存并提交', variant: 'primary' },
  { name: 'save', label: '保存', variant: 'primary' },
] as const

const visibleActions = computed(() =>
  ACTIONS.filter(action => props.actions.includes(action.name)),
)

function isDisabled(action: FormFooterAction) {
  return props.loadingAction !== null
    || (action === 'draft' && !props.dirty)
}

function emitAction(action: FormFooterAction) {
  if (!isDisabled(action))
    emit('action', action)
}
</script>

<template>
  <footer
    class="sticky bottom-0 z-[var(--z-form-footer)] flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-3.5 py-2.5 shadow-[var(--shadow-form-footer)]"
    role="group"
    aria-label="表单操作"
  >
    <label
      v-if="closeAfterSave"
      class="inline-flex cursor-pointer select-none items-center gap-1.5 text-12px text-ink-soft"
    >
      <input
        v-model="closeAfter"
        type="checkbox"
        class="h-3.5 w-3.5 accent-[var(--brand)]"
      >
      <span>【保存】后关闭</span>
    </label>

    <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
      <KitButton
        v-for="action in visibleActions"
        :key="action.name"
        type="button"
        :variant="action.variant"
        :loading="loadingAction === action.name"
        :disabled="isDisabled(action.name)"
        @click="emitAction(action.name)"
      >
        {{ action.label }}
      </KitButton>
    </div>
  </footer>
</template>
