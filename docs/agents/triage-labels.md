# Triage 标签

技能以五个规范 triage 角色描述 issue 状态。本文件把角色映射到本仓库实际使用的标签字符串——全部使用规范默认名,五个标签在 GitHub 上均存在。

| 技能中的角色 | 本仓库标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 待维护者评估 |
| `needs-info` | `needs-info` | 等报告人补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已定稿,AFK agent 可直接领取 |
| `ready-for-human` | `ready-for-human` | 需人工实现 |
| `wontfix` | `wontfix` | 不做 |

技能提到某个角色时(如「apply the AFK-ready triage label」),使用表中对应的标签字符串。

注:已有的 `question` 标签保留「普通提问」原始用途,不参与 triage 状态机。

## Category(类型)标签

规范角色里的 category 是 `bug` / `enhancement`;本仓库用更细的类型词汇,`enhancement` 按内容对应三个细分:

- `bug` → `bug`
- `enhancement` → `infra`(基础设施)/ `feat`(功能页面)/ `ui`(UI 组件)之一;纯文档任务用 `documentation`

triage 时每个 issue 打恰好一个类型标签 + 一个状态标签;优先级 `P1`/`P2`/`P3` 是独立维度,另加。
