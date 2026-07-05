# KitUI → shadcn-vue 迁移映射

决策见 [ADR 0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)。本文是逐件迁移的**映射表 + 进度**，落地时对照勾选。

## 底座（已完成）

| 件 | 现状 |
|---|---|
| 依赖 | `reka-ui@2.10` + `class-variance-authority` + `clsx`；**无** tailwindcss / tailwind-merge / tailwindcss-animate ✅ |
| `cn()` | `app/lib/utils.ts`，仅 clsx ✅ |
| 令牌桥接 | `tokens.css` shadcn 语义变量 → 现有设计令牌；`uno.config.ts` 注册语义色 + 圆角阶梯 ✅ |
| 动画 | `uno.config.ts` `rules`+`preflights` 原生移植 animate-in/out/fade/zoom/slide ✅ |
| 探针 | `app/components/ui/button/`（Button + buttonVariants）✅ |
| Dialog 组件集 | `app/components/ui/dialog/`（Dialog/Content/Title/Description/Header/Footer，reka-ui 透传 + 令牌皮肤 + dialog-in/out 居中动画）✅ |

## 交互原语（`useKitUI()` 签名不变，仅换实现）

| KitUI 原语 | 旧实现 | shadcn-vue 对应 | 保留的行为契约 | 状态 |
|---|---|---|---|---|
| `confirm`(simple/batch/cascade) | `ConfirmDialog.vue` | `Dialog`(reka-ui) | ADR 0003：打字门控、预提交挂起 ≥3s、cascade 杀伤清单、batch 计数、10s undoToast | ✅ 焦点陷阱/Esc/遮罩/焦点返回交给 reka，复用 confirm.ts |
| `formModal` | `KitFormModal.vue` | `Dialog` + 原生控件 | 字段配置驱动、必填校验、改则清红错、错误贴字段下方、长表单吸底 footer、可配宽度 | ✅ 复用 form-modal.ts |
| `toast` 家族 | `ToastHost.vue`/`ToastCard.vue`/`useToast.ts` | `vue-sonner`（Sonner 风格，本就是既定方向） | 双泳道：system 右上 / process 右下；`promise()` 转圈自动成败；hover 暂停；`undoToast` 10s | ⬜ |
| `KitUIHost` | 单宿主 | Sonner `<Toaster>` + `<Dialog>` teleport | 全局单挂载点 | ⬜ |

> `useKitUI()` 导出的 `toast/success/error/warning/info/loading/promise/updateToast/dismissToast/undoToast/confirm/formModal` **签名逐一保持**，业务页面零改动。

## 原子组件（`app/components/ui/*`）

| 旧原子 | shadcn-vue 对应 | 备注 | 状态 |
|---|---|---|---|
| `SegTab` | `Tabs`(reka-ui) 下划线变体 | 保留 count 角标 | ⬜ |
| `SelectFilter` | `Select`(reka-ui) | label + chevron | ⬜ |
| `SearchInput` | `Input` + 前置 icon | pill 圆角 | ⬜ |
| `SectionHeader` | 保留（纯排版），改用语义类 | 品牌竖条标题 | ⬜ |
| `Metric` / `MetricGrid` | 保留，基于 `Card` 排版 | 语义固定列数网格 | ⬜ |
| `StatCard` | `Card` | | ⬜ |
| `TreeNav` | reka-ui `Tree` 或保留逻辑 + shadcn 皮 | 发票台账/清单同构 | ⬜ |
| `DataListToolbar` | `Input`+`Select`+`Button` 组合 | | ⬜ |
| `TablePager` | `Button`(icon/sm) 组合 | vxe-table 仍负责表体 | ⬜ |

> 注：`app/components/ui/*.vue` 里若有用户并行设计新增的未跟踪副本（Metric/SegTab/SearchInput 等），迁移时就地对齐，勿与其冲突。

## vue-sonner 待装

toast 迁移前需 `pnpm add vue-sonner`（Sonner 的 Vue 版，非 Tailwind 依赖）。

## 收尾

| 项 | 状态 |
|---|---|
| 删除旧 KitUIHost/ConfirmDialog/KitFormModal/ToastHost/ToastCard 实现 | ⬜ |
| `/dev/kit-ui` 改 shadcn 验证台 | ⬜ |
| 全量文档更新（CLAUDE.md / CONTEXT.md / 规格 / dc-rebuild / ADR 0003） | ⬜ |
| `pnpm test` + dev 冒烟 | ⬜ |
