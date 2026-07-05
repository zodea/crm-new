<script setup lang="ts">
import type { FormModalOptions, FormValues } from '~/lib/kit/form-modal'
import { computed, nextTick, ref, watch } from 'vue'
import { findMissingRequired, initValues } from '~/lib/kit/form-modal'

// 字段配置驱动的表单弹窗，底座换为 shadcn-vue Dialog（reka-ui）：
// 焦点陷阱/Esc/遮罩关闭/焦点返回交给 reka；本体保留字段渲染 + 必填校验（复用 form-modal.ts）
// + 长表单吸底 footer。props/emits 对宿主保持不变。
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
const bodyRef = ref<HTMLElement | null>(null)

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

// 用户修改某字段即清掉它的红错态（错误贴字段下方，改则消失）
function clearMissing(key: string) {
  if (missing.value.has(key)) {
    const next = new Set(missing.value)
    next.delete(key)
    missing.value = next
  }
}

// reka 请求关闭（Esc / 点遮罩）→ 取消
function onOpenChange(value: boolean) {
  if (!value) emit('cancel')
}

// 打开后焦点落在第一个字段控件（规格：自动聚焦第一个输入框）
function onOpenAutoFocus(e: Event) {
  e.preventDefault()
  nextTick(() => {
    bodyRef.value?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      v-if="options"
      :show-close="false"
      class="max-h-[86vh] flex flex-col p-0"
      :style="{ width: `min(${options.width ?? 480}px, 94vw)` }"
      @open-auto-focus="onOpenAutoFocus"
    >
      <!-- 标题栏（固定） -->
      <div class="flex items-start justify-between px-5 py-3.5 border-b border-line shrink-0">
        <div>
          <DialogTitle>{{ options.title ?? '编辑' }}</DialogTitle>
          <DialogDescription v-if="options.subtitle" class="text-12px mt-0.5">
            {{ options.subtitle }}
          </DialogDescription>
        </div>
        <button type="button" class="icon-btn" aria-label="关闭" @click="emit('cancel')">
          <span class="i-lucide-x text-14px" />
        </button>
      </div>

      <!-- 字段区（可滚动） -->
      <div ref="bodyRef" class="flex-1 overflow-y-auto p-5">
        <div class="grid gap-3.5" :class="cols === 2 ? 'grid-cols-2' : 'grid-cols-1'">
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
              @change="clearMissing(f.key)"
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
              @input="clearMissing(f.key)"
            />

            <input
              v-else
              v-model="values[f.key]"
              :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'"
              class="field-input w-full"
              :class="{ 'border-danger! shadow-[0_0_0_2px_rgba(224,78,92,0.15)]!': missing.has(f.key) }"
              :placeholder="f.placeholder"
              @input="clearMissing(f.key)"
            >

            <span v-if="missing.has(f.key)" class="text-11px text-danger mt-1">
              此项为必填
            </span>
          </div>
        </div>
      </div>

      <!-- 底部操作栏（固定，吸底） -->
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0">
        <button type="button" class="btn-secondary" @click="emit('cancel')">取消</button>
        <button type="button" class="btn-primary" @click="handleSave">
          {{ options.saveText ?? '保存' }}
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
