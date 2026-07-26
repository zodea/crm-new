# Issue tracker：GitHub

本仓库的任务、缺陷和 PRD 记录在 [zodea/crm-new GitHub Issues](https://github.com/zodea/crm-new/issues)，通过 `gh` CLI 读写。

## 开工检查

```text
gh issue list --repo zodea/crm-new --state open --search "<关键词>"
gh issue view <number> --repo zodea/crm-new --comments
```

- 每个新工序都重新查询，不依赖文档里的状态快照。
- 有可执行 open Issue 时按其当前正文和评论工作，不重新设计。
- 关闭 Issue 只代表历史工作结束；新需求需要新 Issue。
- 规格与现场冲突时先评论留证，再修改实现。

## 常用写操作

```text
gh issue create --repo zodea/crm-new --title "<标题>" --body "<正文>"
gh issue comment <number> --repo zodea/crm-new --body "<证据或进度>"
gh issue edit <number> --repo zodea/crm-new --add-label "<标签>"
gh issue close <number> --repo zodea/crm-new --comment "<完成证据>"
```

多行正文在 PowerShell 中使用任务专用变量或 here-string，避免把临时正文文件留在仓库。

## Issue 内容最低要求

- 问题或目标，以及为什么现在要做。
- 明确范围与不在范围内的事项。
- 可验证的验收条件。
- 已知依赖、相关 ADR/页面蓝本和复现证据。
- 不复制数据模型或长期规格；链接到权威源。

当技能要求“publish to the issue tracker”时，含义是创建或更新这里的 GitHub Issue。
