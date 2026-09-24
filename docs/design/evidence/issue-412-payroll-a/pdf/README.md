# A 工资切片使用指南 PDF 验收

Root 已逐页渲染并查看以下两份指南，共 12 页，正文、表格和跨页内容无裁切、重叠或乱码。版本边界区分浏览器验证实例中的 A 日常操作、C1/C2 后续实现，以及生产保存与部署关口。

| 指南 | 版本 | 页数 | 最终文件 |
| --- | --- | ---: | --- |
| 工资与考勤工作台 | V2.1 | 5 | [Markdown 指南](../../../../guides/payroll-attendance.md) |
| 本地核心身份数据迁移 | V2.7 | 7 | [Markdown 指南](../../../../guides/local-data-migration.md) |

[manifest.json](./manifest.json)记录最终 PDF 和每页 PNG 的 SHA-256、页次及人工检查结果。工资指南的签工完整性说明仅用于对应类型，A 不要求不适用的签工正文。

此目录保留使用指南验收证据及[实际工资打印页图](./frozen-a-payroll-1.png)；实际发放的 [Excel](../browser/frozen-a-payroll.xlsx) 和来源另见 [browser](../browser/)。旧 PDF 样本已移入 Windows 回收站，原始清单不倒改，恢复来源见[清理记录](../../../../research/guide-pdf-cleanup-2026-09-14.md)。组件夹具打印微验不能替代真实发放文件。
