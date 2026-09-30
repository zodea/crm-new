# Triage 标签

获授权分诊时，每个 Issue 保留一个类别角色（`bug` 或 `enhancement`）和一个下表状态；迁移时移除旧状态。

## 状态角色

| 标签 | 含义 |
| --- | --- |
| `needs-triage` | 尚未完成范围和验收判断 |
| `needs-info` | 缺少报告人才能提供的关键事实 |
| `ready-for-agent` | 规格、依赖和验收足够明确，可由 agent 领取 |
| `ready-for-human` | 需要人工判断、权限、外部协调或人工实现 |
| `wontfix` | 明确不处理，正文或评论必须写原因 |

## 类别与附加标签

- `bug`：现有承诺行为错误、回归或缺陷。
- `enhancement`：新能力、重构、文档治理或体验改进。

`ui`、`documentation`、`infra`、`feat` 是主题，`P1` / `P2` / `P3` 是优先级，`question` 是普通提问；均不替代类别或状态角色。

`superseded` 表示旧工单已由新任务承接，不表示功能取消或完成；关闭方式与验收义务去向见 [旧任务替换](./issue-tracker.md#旧任务替换)。
