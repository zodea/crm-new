<script setup lang="ts">
// 双泳道 toast 宿主 —— vue-sonner 的两个 Toaster（多 Toaster 路由，toasterId 见 useToast.ts）。
// system 道：右上、expand（展开可读）；process 道：右下、折叠堆叠、hover 展开、新消息最上层。
// 计时/暂停/堆叠/promise/action 全由 vue-sonner 原生负责。皮肤经下方全局样式桥接项目令牌。
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'
</script>

<template>
  <!-- 脱离应用壳 stacking context，确保 Dialog 打开时 toast action 仍在遮罩上方可操作。 -->
  <Teleport to="body">
    <!-- system 道：右上，展开可读（系统消息 / 需确认后的结果 / undo）
         close-button：Toaster 级不强制显示，仅 default 类型（undo）按 toast 级 closeButton 单独开启 -->
    <Toaster
      id="system"
      position="top-right"
      :expand="true"
      :visible-toasts="6"
      :offset="16"
      :gap="12"
    />
    <!-- process 道：右下，折叠堆叠 + hover 展开（上传/识别等过程提示） -->
    <Toaster
      id="process"
      position="bottom-right"
      :expand="false"
      :visible-toasts="3"
      :offset="16"
      :gap="12"
    />
  </Teleport>
</template>

<style>
/* vue-sonner 令牌桥接（sonner 走 body 传送门，用非 scoped 全局样式）。
   不启 richColors，改为按 data-type 覆盖 --normal-* 三元组，套项目品牌语义色。 */
[data-sonner-toaster] {
  --normal-bg: var(--panel);
  --normal-border: var(--line);
  --normal-text: var(--ink);
  --border-radius: var(--radius-card);
  /* 覆盖 vue-sonner 的裸 999999999，统一进入 ADR 0016 消息平面。 */
  z-index: var(--z-toast) !important;
  font-family: var(--font-sans);
}

[data-sonner-toast] {
  box-shadow: var(--shadow-pop);
  font-size: 13px;
  /* reka modal 会把 body 设为 pointer-events:none；toast 叶节点需显式恢复命中。 */
  pointer-events: auto;
}

[data-sonner-toast] [data-title] {
  font-weight: 600;
}

[data-sonner-toast] [data-description] {
  color: var(--ink-soft);
}

[data-sonner-toast][data-type='success'] {
  --normal-bg: var(--ok-soft);
  --normal-border: var(--ok);
  --normal-text: var(--ok-ink);
}
[data-sonner-toast][data-type='error'] {
  --normal-bg: var(--danger-soft);
  --normal-border: var(--danger);
  --normal-text: var(--danger-ink);
}
[data-sonner-toast][data-type='warning'] {
  --normal-bg: var(--warn-soft);
  --normal-border: var(--warn);
  --normal-text: var(--warn-ink);
}
[data-sonner-toast][data-type='info'] {
  --normal-border: var(--brand);
}

/* 撤回等 action 按钮：品牌蓝 */
[data-sonner-toast] [data-button] {
  background: var(--brand);
  color: #fff;
  border-radius: var(--radius-btn);
  font-weight: 600;
}

/* 关闭按钮：套项目令牌（默认走 sonner 的 --gray*，这里改中性描边） */
[data-sonner-toast] [data-close-button] {
  background: var(--panel);
  border-color: var(--line);
  color: var(--ink-soft);
}
[data-sonner-toast] [data-close-button]:hover {
  border-color: var(--line-strong);
  color: var(--ink);
}
</style>
