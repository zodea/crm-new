# A 工资真实打印证据

本目录保留真实发放的[工资打印页图](./frozen-a-payroll-1.png)。原工资指南 5 页及迁入指南 7 页属于旧版指南渲染，已清退；当次逐页检查及原图通过[固定 Git 目录](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-412-payroll-a/pdf)查阅。

| 指南 | 版本 | 页数 | 最终文件 |
| --- | --- | ---: | --- |
| 工资与考勤工作台 | V2.1 | 5 | [Markdown 指南](../../../../guides/payroll-attendance.md) |
| 本地核心身份数据迁移 | V2.7 | 7 | [Markdown 指南](../../../../guides/local-data-migration.md) |

[manifest.json](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-412-payroll-a/pdf/manifest.json)记录最终 PDF 和每页 PNG 的 SHA-256、页次及人工检查结果。工资指南的签工完整性说明仅用于对应类型，A 不要求不适用的签工正文。

实际发放的 [Excel](../browser/frozen-a-payroll.xlsx) 和来源另见 [browser](../browser/)。`manifest.json` 为当次原始清单，其中退役指南的路径按上述固定 Git 查阅，不倒改历史摘要。旧 PDF 样本已移入 Windows 回收站，恢复来源见[清理记录](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/research/guide-pdf-cleanup-2026-09-14.md)。组件夹具打印微验不能替代真实发放文件。
