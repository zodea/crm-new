<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps, PointerDownOutsideEvent } from 'reka-ui'
import {
  DialogClose,
  DialogContent,

  DialogOverlay,
  DialogPortal,
  injectDialogRootContext,

  useForwardPropsEmits,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { cn } from '~/lib/utils'

// shadcn-vue DialogContent：portal + 遮罩（中性黑轻遮罩 --overlay = rgb(0 0 0/28%)，不上毛玻璃）+ 居中面板。
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

// #86 双击误取消防护：弹窗打开后 GRACE_MS 内忽略 pointer-down-outside。
// 竞态成因：第一击开窗 → 遮罩在微任务 flush 后挂载接管指针 → 第二击命中遮罩被
// reka usePointerDownOutside 判为「点外部」→ dismiss。reka 仅 setTimeout(0) 延迟注册监听，
// 挡不住 ≥50ms 的双击。这里按打开时间戳设 300ms 宽限窗口，窗口内 preventDefault 抑制 dismiss；
// 窗口外点遮罩仍正常关闭（#79 语义不变），Esc 不受影响（走 escapeKeyDown，非本回调）。
const GRACE_MS = 300
const rootContext = injectDialogRootContext()
const openedAt = ref(0)
watch(() => rootContext.open.value, (isOpen) => {
  if (isOpen)
    openedAt.value = performance.now()
}, { immediate: true })

function onPointerDownOutside(e: PointerDownOutsideEvent) {
  const target = e.detail.originalEvent.target
  const isToastInteraction = target instanceof Element && target.closest('[data-sonner-toaster]') != null
  if (isToastInteraction || performance.now() - openedAt.value < GRACE_MS)
    e.preventDefault()
}
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
      @pointer-down-outside="onPointerDownOutside"
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
