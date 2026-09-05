# 用户使用指南

先查[功能与路由索引](./routes.md)定位页面，再按下表进入操作说明。[本轮审计与复现步骤](../research/browser-audit-2026-09-05.md)列出已确认问题；功能完整度仍以[实现状态](../design/ui-implementation-status.md)和当前 Issue 为准。

| 功能 | 常用入口 | 操作说明 |
| --- | --- | --- |
| 客户档案与业务关系 | `/base/customer` | [查看](./customer-records.md) |
| 分供方档案与真实事实 | `/base/supplier` | [查看](./supplier-records.md) |
| 班组与工人档案 | `/base/crew`、`/base/worker` | [查看](./crew-worker-records.md) |
| 新项目与施工排程 | `/project`、`/schedule` | [查看](./project-start-and-schedule.md) |
| 核心合同与工程量清单 | `/contract/construction`、`/contract/subcontract`、`/contract/material`、`/contract/boq` | [查看](./core-contract-and-boq.md) |
| 项目分供方工作台与导入 | `/project/:pid/supplier/:sid` | [查看](./project-supplier-workbench.md) |
| 分供方证照 | `/base/supplier/credential/:id` | [查看](./supplier-credential-review.md) |
| 材料单价分析 | `/material/price` | [查看](./material-price-analysis.md) |
| 工资与考勤 | `/subcontract/payroll`、`/subcontract/attendance`、`/subcontract/daywork` | [查看](./payroll-attendance.md) |
| OCR 设置 | `/settings/ocr` | [查看](./ocr-settings.md) |
| 发票识别、台账与导入导出 | `/finance/invoice`、`/finance/ledger` | [查看](./finance-invoice.md) |
| 付款申请与登记支付 | `/finance/payment`、`/finance/records`、`/finance/payment-management` | [查看](./finance-payment.md) |
| 送货单识别、归档与原件导出 | `/material/delivery`、`/material/delivery/archive` | [查看](./material-delivery.md) |
| 本地核心身份迁移 | `/settings/data-migration` | [查看](./local-data-migration.md) |

## 页签与未保存内容

主数据、合同、甲方单据、财务表单、材料表单、送货单归档及新建工资草稿支持页签草稿保护：切换页签保留输入；关闭、关闭其他/右侧/全部或刷新前先确认未保存内容。选择“取消”保留页面和输入；批量关闭中任一页面取消，本次整批都不关闭。

项目、客户、分供方、班组、工人与三类核心合同的每个编辑页独立保留记录身份和版本。先打开 A，再打开 B，切回 A 保存时只更新 A；版本冲突仍需显式选择保留本地内容或使用服务器最新版。

## 编写规范

- 每份指南只写适用范围、入口路由、必要前置条件、操作步骤和已知限制。
- 区分已可用与待开发；本轮发现的回归通过审计链接说明，不把页面能打开写成流程完成。
- 字段、状态机和架构依据链接到权威规格，不重复复制。
- 默认只维护 Markdown。原有 14 份生成 PDF 均有上述同源指南，本轮按用户要求清理；后续仅在用户明确需要时用现有 PDF 生成脚本导出。
