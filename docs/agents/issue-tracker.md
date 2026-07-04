# Issue tracker:GitHub

本仓库的 issue 和 PRD 记在 GitHub Issues(zodea/crm-new)。所有操作走 `gh` CLI。

## 常用操作

- **建 issue**:`gh issue create --title "..." --body "..."`,多行正文用 heredoc。
- **读 issue**:`gh issue view <number> --comments`,可用 `jq` 过滤评论并顺带取标签。
- **列 issue**:`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`,按需加 `--label` / `--state` 过滤。
- **评论**:`gh issue comment <number> --body "..."`
- **打/摘标签**:`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**:`gh issue close <number> --comment "..."`

仓库由 `git remote -v` 推断——在 clone 内运行时 `gh` 自动识别。

## 仓库已有的分类标签

建 issue 时可按需附加:

- 类型:`infra`(基础设施)/ `feat`(功能页面)/ `ui`(UI 组件)/ `bug` / `documentation`
- 优先级:`P1`(高)/ `P2`(中)/ `P3`(低)

## 当技能说「publish to the issue tracker」

创建一个 GitHub issue。

## 当技能说「fetch the relevant ticket」

运行 `gh issue view <number> --comments`。
