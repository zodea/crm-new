# 瑞航 CRM(crm-new)

## Agent skills

### Issue tracker

Issue 记在 GitHub Issues(zodea/crm-new),通过 `gh` CLI 读写。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个 triage 角色全部使用规范默认名(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix)。见 `docs/agents/triage-labels.md`。

### Domain docs

单一上下文布局:根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

## 交互原语设计语言(KitUI)

全局交互原语在 `app/composables/useKitUI.ts` + 单宿主 `app/components/shared/KitUIHost.vue`;dev 验证载体 `/dev/kit-ui`。

- **toast(已定 Sonner 风格双泳道)**:
  - **system 道**(右上,展开可读):`success/error/warning/info/undo`——系统消息与「需确认后的结果」类。
  - **process 道**(右下,重叠堆叠省空间、hover 展开):`loading/promise`——上传/识别等界面交互过程提示,不占地方。
  - `promise()`:HeroUI 式加载中转圈 → 自动成功/失败;hover 暂停自动消失(按泳道)。
- **confirm**:Promise 化确认弹窗,三档变体 simple/batch/cascade(cascade 打实体名 + 预提交挂起),职责边界见 ADR 0003、规格见 `docs/design/kit-ui-component-specs.md`。**formModal**:字段配置驱动 + 必填校验。
- **ripple**(蓝色水波):**已废弃**,全局水波动效(含导出完成动效)一律不再实现。

**改版工作约定**:每类交互改版前,先搜集一份「多风格真实参考站」菜单(能直接点开看效果)供挑方向,挑定再实装。参考站清单存档见 `docs/design/interaction-style-references.md`。

## 提交纪律

- **每完成一个独立工作单元立即提交**:一个 issue、一轮反馈的一层、一份文档定稿,做完即 commit,不要攒到会话结束;结束前检查 `git status`,不留未提交的完成品。
- **只 add 本次任务相关的文件**(明确列路径,禁止 `git add -A` / `git add .`):用户可能同时在改设计文档,混提会冲突。
- 提交信息:conventional commits 前缀 + 中文描述,与现有历史一致(如 `feat(dc): 反馈轮9-② AppData 共享 store`、`docs(dc-rebuild): 标记反馈轮9已推送线上`)。
