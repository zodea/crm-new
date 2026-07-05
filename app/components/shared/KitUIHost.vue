<script setup lang="ts">
// KitUI 全局单宿主：一处挂载，任意页面通过 useKitUI() 触发原语。
// toast/undoToast 由 <ToastHost/> 渲染；confirm 复用 <ConfirmDialog/>；
// formModal 走 <KitFormModal/>。（ripple 暂缓，待补动态图后再挂）
const {
  confirmState,
  confirmOpts,
  resolveConfirm,
  formModalState,
  formModalOpts,
  resolveFormModal,
} = useKitUIHostState()
</script>

<template>
  <ToastHost />

  <ConfirmDialog
    :open="!!confirmState"
    :variant="confirmOpts?.variant"
    :title="confirmOpts?.title"
    :message="confirmOpts?.message ?? ''"
    :count="confirmOpts?.count"
    :impact="confirmOpts?.impact"
    :require-typing="confirmOpts?.requireTyping"
    :hold-ms="confirmOpts?.holdMs"
    :confirm-label="confirmOpts?.confirmLabel"
    :cancel-label="confirmOpts?.cancelLabel"
    @confirm="resolveConfirm(true)"
    @cancel="resolveConfirm(false)"
  />

  <KitFormModal
    :open="!!formModalState"
    :options="formModalOpts"
    @save="resolveFormModal($event)"
    @cancel="resolveFormModal(null)"
  />
</template>
