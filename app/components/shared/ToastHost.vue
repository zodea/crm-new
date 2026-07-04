<script setup lang="ts">
const { toasts, dismiss, pauseLane, resumeLane } = useToast()

// system 道（expand，右上）：newest 在上
const systemStack = computed(() => toasts.value.filter(t => t.lane === 'system').slice().reverse())
// process 道（collapse pile，右下）：newest 在前（idx 0）
const processStack = computed(() => toasts.value.filter(t => t.lane === 'process').slice().reverse())

// —— process pile 堆叠参数（对齐 Sonner）——
const GAP = 14
const EST_H = 58 // 过程提示多为单行，用估算高度做展开偏移
const PEEK = 16 // 折叠态每层露出的高度
const VISIBLE = 3
const processHover = ref(false)

function stackStyle(idx: number) {
  if (processHover.value) {
    return {
      transform: `translateY(${-(idx * (EST_H + GAP))}px) scale(1)`,
      opacity: idx < 8 ? '1' : '0',
      zIndex: String(200 - idx),
      transformOrigin: 'bottom center',
    }
  }
  const scale = Math.max(0.82, 1 - idx * 0.05)
  return {
    transform: `translateY(${-(idx * PEEK)}px) scale(${scale})`,
    opacity: idx < VISIBLE ? '1' : '0',
    zIndex: String(200 - idx),
    transformOrigin: 'bottom center',
  }
}

const pileHeight = computed(() => {
  const n = processStack.value.length
  if (n === 0) return '0px'
  if (processHover.value) return `${n * (EST_H + GAP)}px`
  return `${EST_H + Math.min(n - 1, VISIBLE - 1) * PEEK}px`
})
</script>

<template>
  <!-- system 道：右上，展开可读 -->
  <Teleport to="body">
    <div
      class="fixed top-4 right-4 z-[9999] w-[356px] flex flex-col gap-3"
      @mouseenter="pauseLane('system')"
      @mouseleave="resumeLane('system')"
    >
      <TransitionGroup
        move-class="transition-transform duration-[280ms] ease-[var(--ease-snappy)]"
        enter-active-class="transition-all duration-[240ms] ease-[var(--ease-snappy)]"
        leave-active-class="transition-all duration-[180ms] ease-[var(--ease-snappy)] absolute w-[356px]"
        enter-from-class="translate-x-[110%] opacity-0"
        leave-to-class="translate-x-[110%] opacity-0"
      >
        <ToastCard
          v-for="t in systemStack"
          :key="t.id"
          :toast="t"
          @dismiss="dismiss"
        />
      </TransitionGroup>
    </div>
  </Teleport>

  <!-- process 道：右下，折叠重叠 + hover 展开 -->
  <Teleport to="body">
    <div
      class="fixed bottom-4 right-4 z-[9998] w-[356px] transition-[height] duration-[300ms] ease-[var(--ease-snappy)]"
      :style="{ height: pileHeight }"
      @mouseenter="processHover = true; pauseLane('process')"
      @mouseleave="processHover = false; resumeLane('process')"
    >
      <TransitionGroup
        enter-active-class="transition-opacity duration-[220ms] ease-[var(--ease-snappy)]"
        leave-active-class="transition-opacity duration-[180ms] ease-[var(--ease-snappy)]"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-for="(t, idx) in processStack"
          :key="t.id"
          class="absolute bottom-0 right-0 w-full"
        >
          <div
            class="w-full transition-all duration-[300ms] ease-[var(--ease-snappy)]"
            :style="stackStyle(idx)"
          >
            <ToastCard :toast="t" @dismiss="dismiss" />
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
