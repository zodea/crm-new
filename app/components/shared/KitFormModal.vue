<script setup lang="ts">
import type { FormModalOptions, FormValues } from '~/lib/kit/form-modal'
import { findMissingRequired, initValues } from '~/lib/kit/form-modal'

const props = defineProps<{
  open: boolean
  options: FormModalOptions | null
}>()

const emit = defineEmits<{
  save: [values: FormValues]
  cancel: []
}>()

const values = ref<FormValues>({})
const missing = ref<Set<string>>(new Set())

const fields = computed(() => props.options?.fields ?? [])
const cols = computed(() => props.options?.cols ?? 1)

// 每次打开都用字段初始值重置草稿与校验态
watch(() => props.open, (isOpen) => {
  if (isOpen && props.options) {
    values.value = initValues(props.options.fields)
    missing.value = new Set()
  }
})

function handleSave() {
  const miss = findMissingRequired(fields.value, values.value)
  if (miss.length) {
    missing.value = new Set(miss)
    return
  }
  emit('save', { ...values.value })
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
        v-if="open && options"
        class="fixed inset-0 z-[9000] flex items-center justify-center p-6"
      >
        <div class="absolute inset-0 bg-black/30" @click="emit('cancel')" />
        <div
          class="relative bg-panel border border-line shadow-[var(--shadow-pop)] flex flex-col max-h-[86vh]"
          :style="{ width: `min(${options.width ?? 480}px, 94vw)` }"
          style="animation: dialog-enter var(--dur-dialog) var(--ease-snappy)"
        >
          <!-- 标题栏 -->
          <div class="flex items-start justify-between px-5 py-3.5 border-b border-line shrink-0">
            <div>
              <h3 class="text-14px font-800 text-ink">{{ options.title ?? '编辑' }}</h3>
              <p v-if="options.subtitle" class="text-12px text-ink-soft mt-0.5">
                {{ options.subtitle }}
              </p>
            </div>
            <button class="icon-btn" @click="emit('cancel')">
              <span class="i-lucide-x text-14px" />
            </button>
          </div>

          <!-- 字段区 -->
          <div class="flex-1 overflow-y-auto p-5">
            <div
              class="grid gap-3.5"
              :class="cols === 2 ? 'grid-cols-2' : 'grid-cols-1'"
            >
              <div
                v-for="f in fields"
                :key="f.key"
                :class="{ 'col-span-full': f.full }"
                class="flex flex-col"
              >
                <label class="field-label flex items-center gap-0.5">
                  {{ f.label }}
                  <span v-if="f.required" class="text-danger">*</span>
                </label>

                <select
                  v-if="f.type === 'select'"
                  v-model="values[f.key]"
                  class="field-input w-full"
                  :class="{ 'border-danger! shadow-[0_0_0_2px_rgba(224,78,92,0.15)]!': missing.has(f.key) }"
                >
                  <option value="" disabled>请选择</option>
                  <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
                </select>

                <textarea
                  v-else-if="f.type === 'textarea'"
                  v-model="values[f.key]"
                  class="field-input w-full min-h-16 resize-y"
                  :class="{ 'border-danger! shadow-[0_0_0_2px_rgba(224,78,92,0.15)]!': missing.has(f.key) }"
                  :placeholder="f.placeholder"
                />

                <input
                  v-else
                  v-model="values[f.key]"
                  :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'"
                  class="field-input w-full"
                  :class="{ 'border-danger! shadow-[0_0_0_2px_rgba(224,78,92,0.15)]!': missing.has(f.key) }"
                  :placeholder="f.placeholder"
                >

                <span v-if="missing.has(f.key)" class="text-11px text-danger mt-1">
                  此项为必填
                </span>
              </div>
            </div>
          </div>

          <!-- 底部操作栏 -->
          <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0">
            <button class="btn-secondary" @click="emit('cancel')">取消</button>
            <button class="btn-primary" @click="handleSave">
              {{ options.saveText ?? '保存' }}
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
