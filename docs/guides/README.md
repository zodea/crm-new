# 用户使用指南

按下表找操作说明，定位具体页面看[功能与路由索引](./routes.md)。指南统一使用 Markdown，复杂流程按需配内嵌图表；产品中的打印、原件及导出仍按业务规格验收。

## 版本与使用边界

“当前已可用”仅指各指南注明版本和验证环境内的行为，不表示本轮复验或正式上线。实现缺口看[界面实现状态](../design/ui-implementation-status.md)，具体待开发项看对应指南。

已登记的本机客户、项目、工序库和分供方切片见下表；其他中央能力仍受 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 的验证实例边界约束。持久化、备份恢复与部署须经[生产关口](../implementation/production-gate-work-breakdown.md)逐项验收。完整审批引擎、完整登录/RBAC 和 Tauri 正式交付不因指南列为“待开发”就自动进入当前任务范围。

## 当前指南

| 主题 | 操作说明 |
| --- | --- |
| 公共交互 | [列表搜索与筛选](./list-search-and-filters.md) · [页签与页面恢复](./tabs-and-recovery.md) |
| 基础档案 | [客户与业务关系](./customer-records.md) · [分供方与真实事实](./supplier-records.md) · [班组与工人](./crew-worker-records.md) · [工人私密资料与实名名册](./worker-roster-archive.md) |
| 本机保存 | [客户](./local-customer-storage.md) · [项目、原件与导入](./local-project-storage.md) · [工序库与旧版本](./local-process-library-storage.md) · [分供方与原提交](./local-supplier-storage.md) |
| 备份与迁移 | [本机备份与隔离恢复](./local-backup-and-restore.md) · [本地核心身份数据迁移](./local-data-migration.md) |
| 项目与成本 | [启动与施工排程](./project-start-and-schedule.md) · [目标成本预算](./target-cost.md) · [首页项目与施工进度](./home-project-progress.md) · [项目 Excel 导入](./project-excel-import.md) |
| 工程量与合同 | [工程量合计与台账导出](./quantity-totals-and-export.md) · [工程量区域、模板与完成](./quantity-central-workflow.md) · [核心合同与清单](./core-contract-and-boq.md) |
| 分供与物资 | [分供方工作台与文件导入](./project-supplier-workbench.md) · [证照与资料核验](./supplier-credential-review.md) · [材料单价分析](./material-price-analysis.md) · [送货单归档与原件包](./material-delivery.md) |
| 工资与考勤 | [工资与考勤工作台](./payroll-attendance.md) · [完整工作簿与按月归档](./payroll-complete-workbook.md) · [正式编号与单份出具](./payroll-official-numbering.md) |
| 工资更正与费用 | [更正与实际收付](./payroll-adjustments.md) · [房补、补贴与管理费](./payroll-fees.md) · [空鼓、整改与扣款](./payroll-hollow.md) |
| 其他支出 | [其他及公司支出合同](./auxiliary-contracts.md) · [其他支出结算](./other-expense-settlement.md) |
| 收支与发票 | [付款申请与登记支付](./finance-payment.md) · [收款登记](./receipt-registration.md) · [发票台账与 Excel](./finance-invoice.md) · [开票因子与税额](./invoice-factor.md) |
| 识别 | [OCR 设置](./ocr-settings.md) |
