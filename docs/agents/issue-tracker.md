# Issue tracker：GitHub

[GitHub Issues](https://github.com/zodea/crm-new/issues) 用于任务记录。定向查询条件与写入授权遵守 [AGENTS.md](../../AGENTS.md#开工与决策)，只读查询不包含发布、指派或改标签。

## 查询

```text
gh issue list --repo zodea/crm-new --state open --search "<关键词>"
gh issue view <number> --repo zodea/crm-new --comments
```

已知票号直接读取；需检索时限于当前问题。模块场景与验收方法见 [`module-review.md`](./module-review.md)，标签和历史关闭状态不作为完成证据。

## 常用写操作

```text
gh issue create --repo zodea/crm-new --title "<标题>" --body-file "<正文文件>"
gh issue comment <number> --repo zodea/crm-new --body-file "<证据或进度文件>"
gh issue edit <number> --repo zodea/crm-new --add-label "<标签>"
gh issue close <number> --repo zodea/crm-new
```

获授权后再执行对应写操作。多行正文使用当前项目专属 `.tmp` 目录中的临时 UTF-8 文件与 `--body-file`，按项目临时文件规则清理；关闭前回写实际完成证据。

## 每次提交的 show-me 图解

撰写正文、评论及关联提交反馈前加载 `show-me`，用一句结论、最小必要图表和简短验证说明。提交反馈标注 SHA，区分已实现、已验证、待验证与阻塞；仅改标签或指派无需刷评论。

| 要解释的内容 | 内嵌 Markdown 形式 |
| --- | --- |
| 流程、依赖、状态 | 简短 Mermaid |
| 改前/改后、验收结果 | 小型对照表 |
| 职责、调用或代码变化 | 浅层树或 `diff` |

只展示实际变化，详细证据链接到权威文档或提交；图解不替代验收。

## Issue 内容最低要求

- 目标与原因、范围与排除项、可验证的验收条件。
- 真实依赖、复现证据和相关权威源链接；字段表与长期规格不复制到票内，任务要求、待办和进度也不另抄成本地文档。

## 任务关系

地图使用 `wayfinder:map`，调查任务用 `wayfinder:task`，待用户裁定用 `wayfinder:grilling`；类型与状态标签分开。

父子关系和阻塞关系使用 GitHub 原生接口：

| 关系 | POST 路径 | JSON 参数 |
| --- | --- | --- |
| 子任务 | `/repos/zodea/crm-new/issues/<parent>/sub_issues` | `sub_issue_id` |
| 阻塞依赖 | `/repos/zodea/crm-new/issues/<dependent>/dependencies/blocked_by` | `issue_id` |

参数使用目标 Issue 的数据库 `id`，不是可见票号；重挂父级仅限获授权范围。接口细节见 [子任务](https://docs.github.com/en/rest/issues/sub-issues)与[依赖](https://docs.github.com/en/rest/issues/issue-dependencies)官方文档。

指派前核对开放状态、未完成阻塞和认领情况；只读采证可独立推进，实施须接齐真实依赖。调查完成不等于功能完成。

## 旧任务替换

获授权替换时保留旧票正文、评论和已采纳决定，顶部写明承接者及跨域入口；加 `superseded` 与 `wontfix`，以 `not_planned` 关闭，仅表示旧安排停止。

每项旧验收义务在承接票中标明：继续保留、已有证据满足、经依据修订或待用户裁定。替换任务不撤销业务义务，也不授权合并或删除工作树。
