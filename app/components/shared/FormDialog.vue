<script setup lang="ts">
// 业务大表单弹窗（左侧分区锚点导航 + 吸顶标题 + 吸底操作栏）。
// 底座 shadcn-vue Dialog（reka-ui，ADR 0008）：焦点陷阱/Esc/遮罩关闭/焦点返回/滚动锁
// 交给 reka，本体只管布局与分区滚动。props/emits 对 5 个业务调用点保持不变。
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
  width: 'min(880px, calc(100dvw - var(--space-6, 24px)))',
})

const emit = defineEmits<{
  save: []
  cancel: []
}>()

const activeSection = shallowRef(props.sections?.[0]?.key ?? '')

// 每次打开回到第一个分区（sections 后变也随之生效）
watch(() => props.open, (isOpen) => {
  if (isOpen)
    activeSection.value = props.sections?.[0]?.key ?? ''
})

function scrollTo(key: string) {
  activeSection.value = key
  const el = document.getElementById(`form-section-${key}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// reka 请求关闭（Esc / 点遮罩）→ 取消
function onOpenChange(value: boolean) {
  if (!value)
    emit('cancel')
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      :show-close="false"
      class="form-dialog flex flex-col p-0"
      :style="{ width }"
    >
      <!-- 标题栏（固定） -->
      <div class="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
        <DialogTitle>{{ title }}</DialogTitle>
        <button type="button" class="icon-btn" aria-label="关闭" @click="emit('cancel')">
          <span class="i-lucide-x text-14px" />
        </button>
      </div>

      <!-- 主体 -->
      <div class="form-dialog__body flex flex-1 min-h-0">
        <!-- 左侧分区导航 -->
        <nav
          v-if="sections?.length"
          class="form-dialog__nav w-36 border-r border-line py-3 overflow-y-auto shrink-0"
        >
          <button
            v-for="s in sections"
            :key="s.key"
            type="button"
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
        <div class="form-dialog__content min-w-0 flex-1 overflow-y-auto p-5">
          <label v-if="sections?.length" class="form-dialog__section-select mb-4">
            <span class="field-label">表单分区</span>
            <select
              v-model="activeSection"
              aria-label="表单分区"
              class="field-input w-full"
              @change="scrollTo(activeSection)"
            >
              <option v-for="s in sections" :key="s.key" :value="s.key">
                {{ s.label }}
              </option>
            </select>
          </label>
          <slot />
        </div>
      </div>

      <!-- 底部操作栏（固定，吸底；按钮走 shadcn Button 变体） -->
      <div class="form-dialog__actions flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0">
        <Button variant="outline" @click="emit('cancel')">
          取消
        </Button>
        <slot name="actions" />
        <Button variant="accent" @click="emit('save')">
          {{ saveLabel }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style>
.form-dialog {
  container-type: inline-size;
  max-width: calc(100dvw - var(--space-6, 24px));
  max-height: min(85dvh, calc(100svh - var(--space-6, 24px)));
}

.form-dialog__section-select {
  display: none;
}

@container (max-width: 40rem) {
  .form-dialog__nav {
    display: none;
  }

  .form-dialog__section-select {
    display: block;
  }

  .form-dialog__content {
    padding: var(--space-4, 16px);
  }

  .form-dialog__content .grid-cols-2 {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .form-dialog__content .col-span-2 {
    grid-column: span 1 / span 1 !important;
  }

  .form-dialog__actions {
    padding-inline: var(--space-4, 16px);
  }
}
</style>
