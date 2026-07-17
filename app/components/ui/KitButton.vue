<script setup lang="ts">
import type { ComponentPublicInstance, CSSProperties } from 'vue'
import type { KitButtonVariant } from '~/lib/kit/button'
import { unrefElement, useTimeoutFn } from '@vueuse/core'
import { computed, onMounted, shallowRef, useAttrs, useTemplateRef, watch } from 'vue'
import { Button } from '~/components/ui/button'
import { resolveKitButtonState, resolveKitButtonVariant } from '~/lib/kit/button'

interface Props {
  disabled?: boolean
  loading?: boolean
  variant?: KitButtonVariant
}

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  loading: false,
  variant: 'secondary',
})

const success = defineModel<boolean>('success', { default: false })
const attrs = useAttrs()
const buttonRef = useTemplateRef<ComponentPublicInstance>('buttonRef')
const lockedWidth = shallowRef<number>()

const state = computed(() => resolveKitButtonState({
  disabled: props.disabled,
  loading: props.loading,
  success: success.value,
}))

const buttonVariant = computed(() => resolveKitButtonVariant(props.variant))

const buttonStyle = computed<CSSProperties | undefined>(() => lockedWidth.value == null
  ? undefined
  : { width: `${lockedWidth.value}px` })

function lockCurrentWidth() {
  const element = unrefElement(buttonRef)
  // 布局宽度而非 getBoundingClientRect：点击触发 loading 时按钮可能正处于
  // active scale(0.97) 按压态，rect 是变换后的值，会把宽度锁小约 3%
  if (element)
    lockedWidth.value = Number.parseFloat(getComputedStyle(element).width)
}

watch(
  () => state.value.lockWidth,
  (lock, wasLocked) => {
    if (lock && !wasLocked)
      lockCurrentWidth()
    else if (!lock)
      lockedWidth.value = undefined
  },
  { flush: 'pre' },
)

onMounted(() => {
  if (state.value.lockWidth)
    lockCurrentWidth()
})

const { start: startSuccessReset, stop: stopSuccessReset } = useTimeoutFn(
  () => {
    success.value = false
  },
  1000,
  { immediate: false },
)

watch(
  () => state.value.phase,
  (phase) => {
    stopSuccessReset()
    if (phase === 'success')
      startSuccessReset()
  },
  { immediate: true },
)
</script>

<template>
  <Button
    v-bind="attrs"
    ref="buttonRef"
    :variant="buttonVariant"
    :disabled="state.disabled"
    :style="buttonStyle"
    class="relative overflow-hidden"
    :class="state.showCheck ? 'border-ok! bg-ok-soft! text-ok-ink! hover:bg-ok-soft!' : undefined"
    :aria-busy="state.phase === 'loading' || undefined"
    :data-state="state.phase"
    :data-lock-width="state.lockWidth || undefined"
  >
    <span class="relative inline-grid place-items-center">
      <span
        v-if="state.showSpinner"
        data-kit-button-spinner
        class="i-lucide-loader-circle absolute right-full mr-0.5 h-3 w-3 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span
        class="transition-[opacity,transform] duration-[var(--dur-fast)] motion-reduce:transition-none"
        :class="state.showCheck ? 'scale-90 opacity-0' : undefined"
      >
        <slot />
      </span>
      <span
        v-if="state.showCheck"
        data-kit-button-check
        class="i-lucide-check absolute h-4 w-4 text-ok"
        aria-hidden="true"
      />
    </span>
  </Button>
  <span
    v-if="state.showCheck"
    class="sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >操作已完成</span>
</template>
