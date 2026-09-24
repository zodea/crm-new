# Triage 标签

每个经过分诊的 Issue 必须同时具有：

1. 恰好一个类别角色：`bug` 或 `enhancement`。
2. 恰好一个状态角色：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。

## 状态角色

| 标签 | 含义 |
| --- | --- |
| `needs-triage` | 尚未完成范围和验收判断 |
| `needs-info` | 缺少报告人才能提供的关键事实 |
| `ready-for-agent` | 规格、依赖和验收足够明确，可由 agent 领取 |
| `ready-for-human` | 需要人工判断、权限、外部协调或人工实现 |
| `wontfix` | 明确不处理，正文或评论必须写原因 |

状态迁移时移除旧状态标签，不能同时保留两个状态。

## 类别与附加标签

- `bug`：现有承诺行为错误、回归或缺陷。
- `enhancement`：新能力、重构、文档治理或体验改进。

`ui`、`documentation`、`infra`、`feat` 等是主题标签，可按需附加，但不能替代 `bug` / `enhancement` 类别角色。`P1` / `P2` / `P3` 是优先级，也不参与类别或状态计数。

`question` 只表示普通提问，不参与 triage 状态机。

`superseded` 表示旧工单已由正文指向的新任务承接；这类票以 `not_planned` 关闭并使用 `wontfix` 状态表示停止旧安排，不表示承接的功能取消或完成。历史决定与全部未满足验收义务仍须读取，具体替换规则见 [`issue-tracker.md`](./issue-tracker.md)。
