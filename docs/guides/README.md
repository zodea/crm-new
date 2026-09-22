# 用户使用指南

先查[功能与路由索引](./routes.md)定位页面，再按下表进入操作说明。[2026-09-05 历史审计与复现步骤](../research/browser-audit-2026-09-05.md)列出已确认问题；功能完整度仍以[实现状态](../design/ui-implementation-status.md)和当前 Issue 为准。

## 版本与使用边界

各指南的“当前已可用”指该指南注明版本和验证环境内的行为，不等同于本轮已经复验或正式上线。除明确登记的 [#450 客户](./local-customer-storage.md)与 [#452 项目](./local-project-storage.md)本机切片外，中央端仍按 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md) 的可重置验证实例边界使用；其他持久化、备份恢复和部署由 [#416 承接图](../implementation/production-gate-work-breakdown.md)逐项验收。

本轮按[全模块复核路线](https://github.com/zodea/crm-new/issues/402)逐份核实指南与实际界面。旧票号只用于解释版本来源；远程已合入、本地尚未整合与其他工作树进行中的能力分别登记，不能仅改文档就把它们写成当前版本可用。完整审批引擎、完整登录/RBAC 和 Tauri 正式交付继续是当前排除范围，不因旧指南列为“待开发”而自动纳入本轮。

## 当前指南

- [列表搜索与筛选使用指南](./list-search-and-filters.md)（跨模块公共交互）
- [页签与页面恢复使用指南](./tabs-and-recovery.md)
- [其他支出结算使用指南](./other-expense-settlement.md)

- [其他支出与公司支出合同使用指南](./auxiliary-contracts.md)
- [客户档案与业务关系使用指南](./customer-records.md)
- [本机客户保存与重新登录](./local-customer-storage.md)（#450 首条磁盘路径，正式写入等待备份与上线门禁）
- [本机项目保存、原件与 Excel 导入](./local-project-storage.md)（#452 项目及客户关系同库保存，正式写入门禁保持）
- [分供方档案与真实事实使用指南](./supplier-records.md)
- [班组与工人档案使用指南](./crew-worker-records.md)
- [工人私密资料与工资实名名册](./worker-roster-archive.md)（独立权限、两类照片、带日期不可变名册与原件 ZIP）
- [新项目启动与施工排程使用指南](./project-start-and-schedule.md)（中央 WBS、来源返回与受控接管见 [#444](../design/evidence/issue-444/README.md)，暂估后补合同与楼栋证据更正见 [#445](../design/evidence/issue-445/README.md)）
- [目标成本预算使用指南](./target-cost.md)（版本头、七类科目、基线、原件及完整迁移；来源缺口单独说明）
- [首页项目与施工进度使用指南](./home-project-progress.md)（首页只读入口与独立维护入口分别说明）
- [工程量合计与台账导出使用说明](./quantity-totals-and-export.md)
- [工程量区域、模板与完成使用指南](./quantity-central-workflow.md)
- [项目 Excel 导入使用指南](./project-excel-import.md)
- [核心合同与工程量清单使用指南](./core-contract-and-boq.md)
- [项目分供方工作台与文件导入使用指南](./project-supplier-workbench.md)
- [分供方证照与资料核验使用指南](./supplier-credential-review.md)（中央原件及人工核验见 [#446](../design/evidence/issue-446/README.md)，OCR 人工确认与税务核验见 [#447](../design/evidence/issue-447/README.md)）
- [材料单价分析使用说明](./material-price-analysis.md)
- [工资与考勤工作台使用说明](./payroll-attendance.md)（中央历史接管、A/C1/C2 配置、核对、实际发放及冻结输出；C1 配对考勤，C2 配对人工签工；更正与费用分期另述）
- [正式工资编号与单份出具](./payroll-official-numbering.md)（人工核对项目起点、原子正式编号、原提交恢复及冻结Excel/打印）
- [工资更正与实际收付](./payroll-adjustments.md)（P4 本地验收；核算差额、补退、后月处理与错记冲销分别留证）
- [房补、其他补贴与独立管理费](./payroll-fees.md)（明确完成量范围、多条费用、独立管理簿及负价清单；当前验收进度见指南首部）
- [户级空鼓、整改与工资扣款](./payroll-hollow.md)（原户记录、人工开始、冻结与独立更正；P6 当前验收进度见指南首部）
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

## 文档交付

指南以本目录 Markdown 为准。新增或改变流程时更新对应指南，检查链接、步骤及当前可用范围；流程图和必要的实际界面证据直接链接在 Markdown 中。

2026-09-14 起按用户要求停止例行生成指南 PDF，原 `output/pdf/` 的 25 份可重建副本及 4 份旧工资打印样本移入 Windows 回收站。旧验收记录中的 PDF 页数、摘要和路径只描述当时检查，当前阅读使用 Markdown 指南与保留的逐页图片。清理明细见[PDF 清理记录](../research/guide-pdf-cleanup-2026-09-14.md)。

需要纸质版或明确要求 PDF 时，可使用 `scripts/generate-project-guide-pdf.py` 从指定 Markdown 按需生成，并逐页核查；产品中的工资签名表、合同原件、打印与导出仍按相应业务规格验收。
