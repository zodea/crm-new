<script setup lang="ts">
// KitUI 全局单宿主：一处挂载，任意页面通过 useKitUI() 触发原语。
// toast/undoToast 由 <ToastHost/> 渲染；confirm、formModal、typeSelect
// 均复用 reka-ui Dialog 与全局模态栈。（ripple 已全域废弃，见 ADR 0004）
const {
  confirmState,
  confirmOpts,
  resolveConfirm,
  formModalState,
  formModalOpts,
  resolveFormModal,
  typeSelectState,
  typeSelectOpts,
  resolveTypeSelect,
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

  <KitTypeSelectDialog
    :open="!!typeSelectState"
    :options="typeSelectOpts"
    @select="resolveTypeSelect($event)"
    @cancel="resolveTypeSelect(null)"
  />
</template>
