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
| `toast` 家族 | `ToastHost.vue`/`useToast.ts` | `vue-sonner` 双 Toaster | 双泳道 = 两个 Toaster（system expand 右上 / process 折叠右下、新消息最上层）；`toasterId` 路由；promise/hover 暂停/action(undo) 全用原生。删掉自研计时器/暂停/堆叠。`ToastCard.vue` 已删。 | ✅ |
| `KitUIHost` | 单宿主 | 两个 `<Toaster>` + `<Dialog>` | 全局单挂载点（宿主 template 不变，内部 ToastHost 换实现） | ✅ |

> `useKitUI()` 导出的 `toast/success/error/warning/info/loading/promise/updateToast/dismissToast/undoToast/confirm/formModal` **签名逐一保持**，业务页面零改动。

## 原子组件（`app/components/ui/*`）

**迁移原则**：只有含交互「脏活」（键盘导航/焦点/aria/定位）的原子才迁到 reka-ui 原语；纯展示与原生控件已是令牌化 shadcn 风格，套 reka 只增风险无收益，**保持不变即是迁移结论**。

| 旧原子 | 处置 | 状态 |
|---|---|---|
| `SegTab` | → **reka-ui Tabs**（roving tabindex/方向键/tablist 语义），保留下划线视觉 + count 角标 | ✅ |
| `SelectFilter` | → **reka-ui Select**（键盘导航/样式化下拉/定位），保留 label+chevron 触发器 | ✅ |
| `SearchInput` | 原生 `<input type=search>`——已可访问、令牌化，无 reka 收益，**保留** | ✅ |
| `SectionHeader` | 纯排版（品牌竖条标题），已令牌化，**保留** | ✅ |
| `Metric` / `MetricGrid` | 纯展示（指标数字/网格），已令牌化，**保留** | ✅ |
| `StatCard` | 纯展示卡片，已令牌化，**保留** | ✅ |
| `TreeNav` | 左树导航——纯展示 + 自有轻逻辑，无浮层/焦点脏活，**保留**（reka Tree 收益低、盲改风险高，暂不引） | ✅ |
| `DataListToolbar` | ~~组合件——保留~~ ⛔ 零引用死组件已删除（#110 阶段⑥，各列表页用 Panel 化工具栏组件） | 已删 |
| `TablePager` | 分页按钮组——vxe-table 负责表体，纯 Button 组合，**保留** | ✅ |

## 依赖现状

`reka-ui` + `class-variance-authority` + `clsx` + `vue-sonner` 已装（**无** tailwindcss/tailwind-merge/tailwindcss-animate）。

## 收尾

| 项 | 状态 |
|---|---|
| 旧自研实现清除 | ✅ ConfirmDialog/KitFormModal/ToastHost 已原地重写在 shadcn 底座上；ToastCard.vue 已删；生产代码无 `window.KitUI` 引用 |
| 架构评审四小项 | ✅ toast laneById 泄漏修复（onDismiss/onAutoClose 清账）；KitUIHost v-bind 坍缩；Button 变真实接缝（confirm/formModal footer）；SegTab 选中态单源（data-[state=active]） |
| `/dev/kit-ui` 验证台 | ✅ 页面只调 `useKitUI()` 公共 API，底座切换后自动验证新实现，无需改造 |
| 全量文档更新 | ✅ CLAUDE.md、规格横幅、参考站、CONTEXT.md 词条、dc-rebuild 三份（设计稿域文档加「生产端见 ADR 0008」横幅留档） |
| `pnpm test` | ✅ 55 tests 全过（confirm.ts / form-modal.ts 纯逻辑无损） |
| dev 实机冒烟 | ⏳ 另一会话 dev server 经 HMR 已加载新代码，可在 `/dev/kit-ui` 直接点验 |

## 后续候选（未纳入本轮，见架构评审报告）

- toast 句柄化：`loading()` 返回 `{update/succeed/fail/dismiss}` 句柄，替代裸 id + `updateToast`
- formModal 抽 `FieldControl` 子组件：收敛三分支红错重复，select 分支复用 reka Select
- `btn-*` shortcuts 随改随迁到 `<Button variant>`（乙案），迁完删 shortcuts
