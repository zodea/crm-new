<script setup lang="ts">
interface Section {
  key: string
  label: string
}

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  sections?: Section[]
  saveLabel?: string
  width?: string
}>(), {
  saveLabel: '保存',
  width: 'min(880px, 95vw)',
})

const emit = defineEmits<{
  save: []
  cancel: []
}>()

const activeSection = ref(props.sections?.[0]?.key ?? '')

function scrollTo(key: string) {
  activeSection.value = key
  const el = document.getElementById(`form-section-${key}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
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
        <div class="absolute inset-0 bg-black/30" @click="emit('cancel')" />
        <div
          class="relative bg-panel border border-line shadow-[var(--shadow-pop)] flex flex-col max-h-[85vh]"
          :style="{ width }"
          style="animation: dialog-enter var(--dur-dialog) var(--ease-snappy)"
        >
          <!-- 标题栏 -->
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
            <h3 class="text-14px font-800 text-ink">{{ title }}</h3>
            <button class="icon-btn" @click="emit('cancel')">
              <span class="i-lucide-x text-14px" />
            </button>
          </div>

          <!-- 主体 -->
          <div class="flex flex-1 min-h-0">
            <!-- 左侧分区导航 -->
            <nav
              v-if="sections?.length"
              class="w-36 border-r border-line py-3 overflow-y-auto shrink-0"
            >
              <button
                v-for="s in sections"
                :key="s.key"
                class="block w-full text-left px-3.5 py-2 text-12px transition-colors"
                :class="activeSection === s.key
                  ? 'text-brand-deep font-600 bg-brand-soft/40'
                  : 'text-ink-soft hover:text-ink hover:bg-surface-3'"
                @click="scrollTo(s.key)"
              >
                {{ s.label }}
              </button>
            </nav>

            <!-- 表单内容 -->
            <div class="flex-1 overflow-y-auto p-5">
              <slot />
            </div>
          </div>

          <!-- 底部操作栏 -->
          <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0">
            <button class="btn-secondary" @click="emit('cancel')">取消</button>
            <slot name="actions" />
            <button class="btn-primary" @click="emit('save')">{{ saveLabel }}</button>
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
