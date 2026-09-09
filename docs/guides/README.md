# 用户使用指南

本目录保存面向最终用户的操作说明 Markdown 权威源。功能规格、数据字段和架构原因仍分别以 `docs/rewrite/pages/`、`docs/rewrite/DATABASE.md` 和 `docs/adr/` 为准；指南只负责把这些规则组织成可执行的用户流程。

新增功能入口见[功能路由索引](./routes.md)。

## 版本与使用边界

各指南的“当前已可用”指该指南注明版本和验证环境内的行为，不等同于本轮已经复验或正式上线。中央端仍按 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 的可重置验证实例边界使用；正式保存、服务重启后保留、备份恢复和部署由 [#416](https://github.com/zodea/crm-new/issues/416) 单独验收。

本轮按[全模块复核路线](https://github.com/zodea/crm-new/issues/402)逐份核实指南与实际界面。旧票号只用于解释版本来源；远程已合入、本地尚未整合与其他工作树进行中的能力分别登记，不能仅改文档就把它们写成当前版本可用。完整审批引擎、完整登录/RBAC 和 Tauri 正式交付继续是当前排除范围，不因旧指南列为“待开发”而自动纳入本轮。

## 当前指南

- [列表搜索与筛选使用指南](./list-search-and-filters.md)（跨模块公共交互）
- [其他支出结算使用指南](./other-expense-settlement.md)

- [其他支出与公司支出合同使用指南](./auxiliary-contracts.md)
- [客户档案与业务关系使用指南](./customer-records.md)
- [分供方档案与真实事实使用指南](./supplier-records.md)
- [班组与工人档案使用指南](./crew-worker-records.md)
- [新项目启动与施工排程使用指南](./project-start-and-schedule.md)
- [项目 Excel 导入使用指南](./project-excel-import.md)
- [核心合同与工程量清单使用指南](./core-contract-and-boq.md)
- [项目分供方工作台与文件导入使用指南](./project-supplier-workbench.md)
- [分供方证照与资料核验使用指南](./supplier-credential-review.md)
- [材料单价分析使用说明](./material-price-analysis.md)
- [工资与考勤工作台使用说明](./payroll-attendance.md)
- [OCR 设置使用说明](./ocr-settings.md)
- [发票台账与 Excel 导入导出使用说明](./finance-invoice.md)
- [付款申请与登记支付使用说明](./finance-payment.md)
- [送货单归档与原件包导出使用说明](./material-delivery.md)
- [本地核心身份数据迁移使用指南](./local-data-migration.md)

## PDF 生成

运行：

```powershell
python scripts/generate-project-guide-pdf.py
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/project-excel-import.md `
  --output output/pdf/瑞航CRM_项目Excel导入使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/customer-records.md `
  --output output/pdf/瑞航CRM_客户档案与业务关系使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/supplier-records.md `
  --output output/pdf/瑞航CRM_分供方档案与真实事实使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/crew-worker-records.md `
  --output output/pdf/瑞航CRM_班组与工人档案使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/core-contract-and-boq.md `
  --output output/pdf/瑞航CRM_核心合同与工程量清单使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/project-supplier-workbench.md `
  --output output/pdf/瑞航CRM_项目分供方工作台与文件导入使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/supplier-credential-review.md `
  --output output/pdf/瑞航CRM_分供方证照与资料核验使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/material-price-analysis.md `
  --output output/pdf/瑞航CRM_材料单价分析使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/payroll-attendance.md `
  --output output/pdf/瑞航CRM_工资与考勤工作台使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/ocr-settings.md `
  --output output/pdf/瑞航CRM_OCR设置使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/finance-invoice.md `
  --output output/pdf/瑞航CRM_发票台账与Excel导入导出使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/finance-payment.md `
  --output output/pdf/瑞航CRM_付款申请与登记支付使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/material-delivery.md `
  --output output/pdf/瑞航CRM_送货单归档与原件包导出使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/local-data-migration.md `
  --output output/pdf/瑞航CRM_本地核心身份数据迁移使用指南.pdf
```

生成文件：

```text
output/pdf/瑞航CRM_新项目启动与施工排程使用指南.pdf
output/pdf/瑞航CRM_项目Excel导入使用指南.pdf
output/pdf/瑞航CRM_客户档案与业务关系使用指南.pdf
output/pdf/瑞航CRM_分供方档案与真实事实使用指南.pdf
output/pdf/瑞航CRM_班组与工人档案使用指南.pdf
output/pdf/瑞航CRM_核心合同与工程量清单使用指南.pdf
output/pdf/瑞航CRM_项目分供方工作台与文件导入使用说明.pdf
output/pdf/瑞航CRM_分供方证照与资料核验使用指南.pdf
output/pdf/瑞航CRM_材料单价分析使用说明.pdf
output/pdf/瑞航CRM_工资与考勤工作台使用说明.pdf
output/pdf/瑞航CRM_OCR设置使用说明.pdf
output/pdf/瑞航CRM_发票台账与Excel导入导出使用说明.pdf
output/pdf/瑞航CRM_付款申请与登记支付使用说明.pdf
output/pdf/瑞航CRM_送货单归档与原件包导出使用说明.pdf
output/pdf/瑞航CRM_本地核心身份数据迁移使用指南.pdf
```

每次改变最终用户可见流程时，先更新 Markdown，再重新生成并逐页渲染检查 PDF。指南必须明确区分“当前已可用”和“已定稿待开发”，不能把目标规格写成已经上线。

公共列表指南生成方式：`python scripts/generate-project-guide-pdf.py --source docs/guides/list-search-and-filters.md --output output/pdf/瑞航CRM_列表搜索与筛选使用指南.pdf`。
