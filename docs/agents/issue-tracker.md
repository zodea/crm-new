# Issue tracker：GitHub

本仓库的任务、缺陷和 PRD 记录在 [zodea/crm-new GitHub Issues](https://github.com/zodea/crm-new/issues)，通过 `gh` CLI 读写。

本轮唯一任务入口为[瑞航 CRM 全模块复核与红圈对齐路线：前台交互和数据处理优先](https://github.com/zodea/crm-new/issues/402)。模块目录与当前范围放在该图；详细复核和规格门槛看 [`module-review.md`](./module-review.md)。

## 开工检查

```text
gh issue list --repo zodea/crm-new --state open --search "<关键词>"
gh issue view <number> --repo zodea/crm-new --comments
```

- 每个新工序都重新查询，不依赖文档里的状态快照。
- 有可执行 open Issue 时按其当前正文和评论工作，不重新设计。
- 领取实施票前按 `module-review.md` 检查场景、数据影响、异常和验收是否充分；标签不能代替规格。能由有效证据与现行规则补齐的直接作出判断并留依据；真实业务取舍才进入有文档记录的访谈。
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

## Wayfinding operations

地图使用 `wayfinder:map`，调查/前置任务使用 `wayfinder:task`，确需用户裁定的事项使用 `wayfinder:grilling`；外部研究和可交互原型按需使用各自类型。子票通过 GitHub 原生父子关系挂接，先创建 Issue，再建立原生阻塞关系。

```text
gh api repos/zodea/crm-new/issues/402/sub_issues --paginate
gh api repos/zodea/crm-new/issues/<number>/dependencies/blocked_by
gh api repos/zodea/crm-new/issues/<number> --jq .id
```

添加父子关系使用 `POST /repos/zodea/crm-new/issues/<parent>/sub_issues`，JSON 参数 `sub_issue_id` 是上面取得的数据库 ID；添加依赖使用 `POST /repos/zodea/crm-new/issues/<dependent>/dependencies/blocked_by`，`issue_id` 同样是阻塞票的数据库 ID，而非可见票号。按需传递 `replace_parent`，只重挂明确获授权的任务。接口说明见 [GitHub 子任务文档](https://docs.github.com/en/rest/issues/sub-issues)与[依赖文档](https://docs.github.com/en/rest/issues/issue-dependencies)。

可领取前沿为开放、无未完成阻塞、尚未认领的子票；开工前先指派给实际执行者。调查依赖与实施依赖分开：只读采证可并行，实施前必须接齐真实依赖的公共能力和上游事实。基线票不以修完全部历史问题为关闭条件；模块决定充分后即可发布规格和实施票。

## 旧任务替换

被替代的旧票保留正文、评论和已采纳决定，在正文顶部标明主要承接者及跨域协作入口，使用 `superseded` 标签并以 `not_planned` 关闭；该关闭只表示旧工单停止执行，不能作为功能完成证据。`wontfix` 在这类旧票上表示停止旧工作安排，业务义务继续由承接票处理。

每项旧验收义务必须在承接票中登记保留、已有证据满足、经依据修订或明确待裁定的去向。遇到旧链接先跟随承接指针，再读取现时规格。已关闭的历史领域决议、正在开发的代码和仅本地成果都保留；重组任务不自动授权合并、推送或删除工作树。
