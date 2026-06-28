<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}>(), {
  title: '确认操作',
  confirmLabel: '确定',
  cancelLabel: '取消',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-[var(--dur-dialog)]"
      leave-active-class="transition-opacity duration-[180ms]"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-[9000] flex items-center justify-center"
      >
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-black/30" @click="emit('cancel')" />
        <!-- 内容 -->
        <div
          class="relative bg-panel border border-line shadow-[var(--shadow-pop)] w-[min(420px,90vw)] p-5"
          style="animation: dialog-enter var(--dur-dialog) var(--ease-snappy)"
        >
          <h3 class="text-14px font-800 text-ink mb-3">{{ title }}</h3>
          <p class="text-13px text-ink-soft leading-relaxed mb-5">{{ message }}</p>
          <div class="flex justify-end gap-2">
            <button class="btn-secondary" @click="emit('cancel')">
              {{ cancelLabel }}
            </button>
            <button
              :class="danger ? 'btn-danger' : 'btn-primary'"
              @click="emit('confirm')"
            >
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@keyframes dialog-enter {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
