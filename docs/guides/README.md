# 用户使用指南

本目录保存面向最终用户的操作说明 Markdown 权威源。功能规格、数据字段和架构原因仍分别以 `docs/rewrite/pages/`、`docs/rewrite/DATABASE.md` 和 `docs/adr/` 为准；指南只负责把这些规则组织成可执行的用户流程。

## 当前指南

- [新项目启动与施工排程使用指南](./project-start-and-schedule.md)

## PDF 生成

运行：

```powershell
python scripts/generate-project-guide-pdf.py
```

生成文件：

```text
output/pdf/瑞航CRM_新项目启动与施工排程使用指南.pdf
```

每次改变最终用户可见流程时，先更新 Markdown，再重新生成并逐页渲染检查 PDF。指南必须明确区分“当前已可用”和“已定稿待开发”，不能把目标规格写成已经上线。
