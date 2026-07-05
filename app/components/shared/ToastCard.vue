<script setup lang="ts">
import type { Toast } from '~/composables/useToast'

defineProps<{ toast: Toast }>()
const emit = defineEmits<{ dismiss: [id: number] }>()

const iconMap: Record<string, string> = {
  success: 'i-lucide-circle-check',
  error: 'i-lucide-circle-x',
  warning: 'i-lucide-triangle-alert',
  info: 'i-lucide-info',
  default: 'i-lucide-bell',
}
const colorMap: Record<string, string> = {
  success: 'text-ok',
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-brand',
  default: 'text-ink-soft',
}
</script>

<template>
  <div
    class="group flex gap-2.5 w-full rounded-[10px] bg-panel border border-line px-3.5 py-3 shadow-[0_4px_12px_-2px_rgba(16,24,40,0.14),0_2px_6px_-3px_rgba(16,24,40,0.10)]"
    :class="toast.description ? 'items-start' : 'items-center'"
  >
    <!-- 图标 / 加载转圈 -->
    <span v-if="toast.type === 'loading'" class="kit-spinner shrink-0 mt-px" />
    <span
      v-else
      :class="[iconMap[toast.type], colorMap[toast.type]]"
      class="text-17px shrink-0 mt-px"
    />

    <div class="flex-1 min-w-0">
      <div class="text-13px font-600 text-ink leading-snug break-words">{{ toast.message }}</div>
      <div v-if="toast.description" class="text-12px text-ink-soft mt-0.5 leading-snug break-words">
        {{ toast.description }}
      </div>
    </div>

    <!-- 操作按钮（撤回等） -->
    <button
      v-if="toast.action"
      class="shrink-0 self-center rounded-[6px] bg-brand-soft px-2.5 py-1 text-12px font-700 text-brand-deep cursor-pointer hover:opacity-80 transition-opacity"
      @click="toast.action.onClick()"
    >
      {{ toast.action.label }}
    </button>

    <!-- 关闭（loading 态不可手动关闭） -->
    <button
      v-if="toast.type !== 'loading'"
      class="shrink-0 -mr-1 -mt-0.5 p-1 rounded-[6px] text-ink-faint hover:text-ink hover:bg-surface-3 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
      aria-label="关闭"
      @click="emit('dismiss', toast.id)"
    >
      <span class="i-lucide-x text-13px" />
    </button>
  </div>
</template>

<style scoped>
.kit-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--line-strong);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: kit-spin 0.6s linear infinite;
}
@keyframes kit-spin {
  to { transform: rotate(360deg); }
}
</style>
