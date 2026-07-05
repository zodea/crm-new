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

  <!-- ConfirmOptions 字段名与 ConfirmDialog props 同名，整包 v-bind 透传：
       新增 confirm 选项只需改 ConfirmOptions 类型 + ConfirmDialog，宿主零改动 -->
  <ConfirmDialog
    :open="!!confirmState"
    v-bind="confirmOpts ?? { message: '' }"
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
