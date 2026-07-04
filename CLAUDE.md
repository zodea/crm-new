# 瑞航 CRM(crm-new)

## Agent skills

### Issue tracker

Issue 记在 GitHub Issues(zodea/crm-new),通过 `gh` CLI 读写。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个 triage 角色全部使用规范默认名(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix)。见 `docs/agents/triage-labels.md`。

### Domain docs

单一上下文布局:根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

## 提交纪律

- **每完成一个独立工作单元立即提交**:一个 issue、一轮反馈的一层、一份文档定稿,做完即 commit,不要攒到会话结束;结束前检查 `git status`,不留未提交的完成品。
- **只 add 本次任务相关的文件**(明确列路径,禁止 `git add -A` / `git add .`):用户可能同时在改设计文档,混提会冲突。
- 提交信息:conventional commits 前缀 + 中文描述,与现有历史一致(如 `feat(dc): 反馈轮9-② AppData 共享 store`、`docs(dc-rebuild): 标记反馈轮9已推送线上`)。
