# 用户使用指南

先查[功能与路由索引](./routes.md)定位页面，再按下表进入操作说明。[2026-09-05 历史审计与复现步骤](../research/browser-audit-2026-09-05.md)列出已确认问题；功能完整度仍以[实现状态](../design/ui-implementation-status.md)和当前 Issue 为准。

## 版本与使用边界

各指南的“当前已可用”指该指南注明版本和验证环境内的行为，不等同于本轮已经复验或正式上线。中央端仍按 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 的可重置验证实例边界使用；正式保存、服务重启后保留、备份恢复和部署由 [#416](https://github.com/zodea/crm-new/issues/416) 单独验收。

本轮按[全模块复核路线](https://github.com/zodea/crm-new/issues/402)逐份核实指南与实际界面。旧票号只用于解释版本来源；远程已合入、本地尚未整合与其他工作树进行中的能力分别登记，不能仅改文档就把它们写成当前版本可用。完整审批引擎、完整登录/RBAC 和 Tauri 正式交付继续是当前排除范围，不因旧指南列为“待开发”而自动纳入本轮。

## 当前指南

- [列表搜索与筛选使用指南](./list-search-and-filters.md)（跨模块公共交互）
- [页签与页面恢复使用指南](./tabs-and-recovery.md)
- [其他支出结算使用指南](./other-expense-settlement.md)

- [其他支出与公司支出合同使用指南](./auxiliary-contracts.md)
- [客户档案与业务关系使用指南](./customer-records.md)
- [分供方档案与真实事实使用指南](./supplier-records.md)
- [班组与工人档案使用指南](./crew-worker-records.md)
- [新项目启动与施工排程使用指南](./project-start-and-schedule.md)
- [首页项目与施工进度使用指南](./home-project-progress.md)
- [工程量合计与台账导出使用说明](./quantity-totals-and-export.md)
- [工程量区域、模板与完成使用指南](./quantity-central-workflow.md)
- [项目 Excel 导入使用指南](./project-excel-import.md)
- [核心合同与工程量清单使用指南](./core-contract-and-boq.md)
- [项目分供方工作台与文件导入使用指南](./project-supplier-workbench.md)
- [分供方证照与资料核验使用指南](./supplier-credential-review.md)（中央原件及人工核验见 [#446](../design/evidence/issue-446/README.md)，OCR 人工确认与税务核验见 [#447](../design/evidence/issue-447/README.md)）
- [材料单价分析使用说明](./material-price-analysis.md)
- [工资与考勤工作台使用说明](./payroll-attendance.md)
- [OCR 设置使用说明](./ocr-settings.md)
- [发票台账与 Excel 导入导出使用说明](./finance-invoice.md)
- [开票因子与税额计算使用说明](./invoice-factor.md)
- [付款申请与登记支付使用说明](./finance-payment.md)
- [收款登记使用指南](./receipt-registration.md)
- [送货单归档与原件包导出使用说明](./material-delivery.md)
- [本地核心身份数据迁移使用指南](./local-data-migration.md)

## 页签与未保存内容

浏览器刷新会恢复已登记的只读页签位置；新建、编辑、导入映射等写态及未保存内容不纳入恢复。页签内“刷新当前页”继续保留其他页面的会话状态；范围与失败处理见[页签与页面恢复指南](./tabs-and-recovery.md)。

主数据、合同、甲方单据、财务表单、材料表单、送货单归档及新建工资草稿支持页签草稿保护：切换页签保留输入；关闭、关闭其他/右侧/全部或刷新前先确认未保存内容。选择“取消”保留页面和输入；批量关闭中任一页面取消，本次整批都不关闭。

项目、客户、分供方、班组、工人与三类核心合同的每个编辑页独立保留记录身份和版本。先打开 A，再打开 B，切回 A 保存时只更新 A；版本冲突仍需显式选择保留本地内容或使用服务器最新版。

## PDF 生成与检查

```powershell
python scripts/generate-project-guide-pdf.py
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/tabs-and-recovery.md `
  --output output/pdf/瑞航CRM_页签与页面恢复使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/home-project-progress.md `
  --output output/pdf/瑞航CRM_首页项目与施工进度使用指南.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/quantity-totals-and-export.md `
  --output output/pdf/瑞航CRM_工程量合计与台账导出使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/quantity-central-workflow.md `
  --output output/pdf/瑞航CRM_工程量中央流程使用指南.pdf
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
  --source docs/guides/invoice-factor.md `
  --output output/pdf/瑞航CRM_开票因子与税额计算使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/finance-payment.md `
  --output output/pdf/瑞航CRM_付款申请与登记支付使用说明.pdf
python scripts/generate-project-guide-pdf.py `
  --source docs/guides/receipt-registration.md `
  --output output/pdf/瑞航CRM_收款登记使用指南.pdf
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
output/pdf/瑞航CRM_页签与页面恢复使用指南.pdf
output/pdf/瑞航CRM_首页项目与施工进度使用指南.pdf
output/pdf/瑞航CRM_工程量合计与台账导出使用说明.pdf
output/pdf/瑞航CRM_工程量中央流程使用指南.pdf
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
output/pdf/瑞航CRM_开票因子与税额计算使用说明.pdf
output/pdf/瑞航CRM_发票台账与Excel导入导出使用说明.pdf
output/pdf/瑞航CRM_付款申请与登记支付使用说明.pdf
output/pdf/瑞航CRM_收款登记使用指南.pdf
output/pdf/瑞航CRM_送货单归档与原件包导出使用说明.pdf
output/pdf/瑞航CRM_本地核心身份数据迁移使用指南.pdf
```

每次改变最终用户可见流程时，先更新 Markdown，再重新生成并逐页渲染检查 PDF。指南必须明确区分“当前已可用”和“已定稿待开发”，不能把目标规格写成已经上线。

公共列表指南生成方式：`python scripts/generate-project-guide-pdf.py --source docs/guides/list-search-and-filters.md --output output/pdf/瑞航CRM_列表搜索与筛选使用指南.pdf`。
