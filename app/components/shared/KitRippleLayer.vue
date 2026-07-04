<script setup lang="ts">
import type { RippleItem } from '~/composables/useKitUI'

defineProps<{
  ripples: readonly RippleItem[]
}>()
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[9500] pointer-events-none overflow-hidden">
      <div
        v-for="r in ripples"
        :key="r.id"
        class="kit-ripple"
        :style="{ left: `${r.x}px`, top: `${r.y}px` }"
      >
        <!-- 减弱动画：静态勾选淡入 -->
        <div v-if="r.reduced" class="kit-check">✓</div>
        <!-- 水波粼粼：水滴落下 + 3 圈同心波纹 -->
        <template v-else>
          <div class="kit-drop" />
          <div class="kit-wave" style="animation-delay: 150ms" />
          <div class="kit-wave" style="animation-delay: 270ms" />
          <div class="kit-wave" style="animation-delay: 390ms" />
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.kit-ripple {
  position: absolute;
  width: 0;
  height: 0;
}

/* ① 水滴从上方落下（150ms ease-in，scaleY 拉伸） */
.kit-drop {
  position: absolute;
  left: -5px;
  top: -5px;
  width: 10px;
  height: 14px;
  background: var(--brand);
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  animation: kit-drop 150ms ease-in forwards;
}

/* ② 触达后 3 圈同心水波，opacity 0.4→0（600ms） */
.kit-wave {
  position: absolute;
  left: -8px;
  top: -8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--brand);
  background: var(--brand-soft);
  opacity: 0;
  animation: kit-wave 600ms ease-out forwards;
}

.kit-check {
  position: absolute;
  left: -14px;
  top: -14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--ok);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 800;
  opacity: 0;
  animation: kit-check 300ms ease-out forwards;
}

@keyframes kit-drop {
  0% { transform: translateY(-40px) scaleY(1.2); opacity: 1; }
  100% { transform: translateY(0) scaleY(1); opacity: 0; }
}

@keyframes kit-wave {
  0% { transform: scale(0.5); opacity: 0.4; background: var(--brand-soft); }
  100% { transform: scale(5); opacity: 0; background: transparent; }
}

@keyframes kit-check {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}
</style>
