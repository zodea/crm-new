<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/lib/utils'

// shadcn-vue DialogContent：portal + 遮罩（品牌色轻遮罩 --overlay，不上毛玻璃）+ 居中面板。
// 进出动画走 uno.config 的 dialog-in/out（zoom+fade+微升，始终居中）。
// 基类刻意不含 宽度/内边距/布局——那些由各调用方经 class 自带（无 tailwind-merge，
// 避免同名工具类对冲靠 CSS 顺序定胜负）。style/role 等经 $attrs 透传到内容元素。
// showClose=false 时不渲染右上角 ×。
defineOptions({ inheritAttrs: false })

const props = defineProps<DialogContentProps & { class?: any, showClose?: boolean }>()
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = computed(() => {
  const { class: _c, showClose: _s, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-[9000] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
    />
    <DialogContent
      v-bind="{ ...forwarded, ...$attrs }"
      :class="cn(
        'fixed left-1/2 top-1/2 z-[9001] -translate-x-1/2 -translate-y-1/2 border border-line bg-panel shadow-[var(--shadow-pop)] rounded-[var(--radius-card)] focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:dialog-in data-[state=closed]:dialog-out',
        props.class,
      )"
    >
      <slot />
      <DialogClose
        v-if="showClose !== false"
        aria-label="关闭"
        class="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-btn)] text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink focus:outline-none"
      >
        <span class="i-lucide-x text-15px" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
