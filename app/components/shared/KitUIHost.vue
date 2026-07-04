<script setup lang="ts">
// KitUI 全局单宿主：一处挂载，任意页面通过 useKitUI() 触发五原语。
// toast/undoToast 由 <ToastHost/> 渲染；confirm 复用 <ConfirmDialog/>；
// formModal 走 <KitFormModal/>；ripple 走 <KitRippleLayer/>。
const {
  confirmState,
  confirmOpts,
  resolveConfirm,
  formModalState,
  formModalOpts,
  resolveFormModal,
  ripples,
} = useKitUIHostState()
</script>

<template>
  <ToastHost />

  <ConfirmDialog
    :open="!!confirmState"
    :title="confirmOpts?.title"
    :message="confirmOpts?.message ?? ''"
    :confirm-label="confirmOpts?.confirmLabel"
    :cancel-label="confirmOpts?.cancelLabel"
    :danger="confirmOpts?.danger"
    @confirm="resolveConfirm(true)"
    @cancel="resolveConfirm(false)"
  />

  <KitFormModal
    :open="!!formModalState"
    :options="formModalOpts"
    @save="resolveFormModal($event)"
    @cancel="resolveFormModal(null)"
  />

  <KitRippleLayer :ripples="ripples" />
</template>
