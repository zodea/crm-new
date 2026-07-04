# KitUI 交互原语组件规格（可落地模板）

把每类交互敲定的方向翻译成**照着就能写组件**的规格:结构锚点、变体/状态、配色令牌、行为规则、调用签名。与另外两份分工:方向从 [interaction-style-references.md](./interaction-style-references.md) 挑,为什么这么定见 `docs/adr/`,本文只答「照着怎么写」。

- 技术栈:Nuxt 4 + Vue 3 + UnoCSS,SSR 关闭。统一入口 `app/composables/useKitUI.ts`,单宿主 `app/components/shared/KitUIHost.vue`。
- dev 验证载体:`/dev/kit-ui`。令牌见 `app/assets/css/tokens.css`。

---

## 00 · 全局约定(所有浮层共用)

| 项 | 规格 |
|---|---|
| 遮罩 | `rgba(42,89,150,.28)`(品牌色轻遮罩),**不上毛玻璃**(Tauri 性价比低) |
| 圆角 | 弹窗/卡片 `--radius-card`(12px),按钮 `--radius-btn`(8px) |
| 浮层阴影 | `--shadow-pop` |
| 进出动效 | `--dur-dialog`(220ms)+ `--ease-snappy`;进场 `opacity 0→1 + translateY(12→0)` |
| 退路 | Esc 关闭、遮罩点击关闭、焦点锁定在浮层内 |
| 配色语义 | 建设性主操作 = `--brand`;破坏性确认 = `--danger`;取消 = ghost 灰 |
| z-index | 浮层 9000 段;toast 在其上 |

---

## 01 · 确认弹窗 `confirm-dialog` ✅ 已定案(ADR 0003)

**用途**:只服务「不可撤回 / 高杀伤 / 批量」操作。可撤回的单条删除**不弹本弹窗**,走软删除 + undoToast;纯信息阻断走 toast。

**结构锚点**(自上而下):标题 → 正文/杀伤清单 → [type-to-confirm 输入框] → footer(取消 ghost 左 · 确认 danger 右)。

**三档变体 & 行为**:

| 变体 | 触发 | 打字确认 | 点确认后 | 事后撤回 |
|---|---|---|---|---|
| `simple` | 归档后修改、删未入库扫描件等高后果但轻量操作 | 无 | 立即关窗 → 交 toast 反馈 | 视操作,一般无 |
| `batch` | 批量删除 | 无(仅显示「将删除 N 条」) | 立即关窗 | **10 秒 undoToast** 整批恢复 |
| `cascade` | 删有下游关联的父级(如分供方) | **必填,打记录自身名称** | **原地 spinner、弹窗不关、≥3 秒预提交挂起** | **无**(挂起期即撤销窗口) |

**cascade 细节**:

- 弹窗列**杀伤清单**:「将影响 3 份合同、12 条材料、8 张发票」(只读 count 查询得出)。
- 输入框需精确匹配记录名(如「华东建材」)才激活确认按钮。
- 点确认 → 进入 **≥3 秒**挂起(关联多则更久,永不少于 3 秒),期间 **不写库**、显示显眼「撤销」按钮;撤销即彻底中止;超时未撤才写父级删除标记、关窗。
- 软删除**只标父级**,子级靠「祖先是否已删」过滤隐藏,不逐条标记。

**配色 & 令牌**:确认 `--danger`、取消 ghost 灰、品牌蓝不当主角;遮罩 `rgba(42,89,150,.28)`;打开焦点默认落**取消**按钮(危险操作停在安全选项)。

**调用签名**(命令式 Promise,沿用 `useKitUI`):

```ts
await confirm({
  variant: 'simple' | 'batch' | 'cascade',
  title, message,
  count?: number,                 // batch: 显示删除条数
  impact?: { label: string; n: number }[], // cascade: 杀伤清单
  requireTyping?: string,         // cascade: 需精确打入的记录名
  holdMs?: number,                // cascade: 预提交挂起时长,默认 ≥3000
  confirmLabel?, cancelLabel?,
}) // resolve(true) 执行 / resolve(false) 取消
```
