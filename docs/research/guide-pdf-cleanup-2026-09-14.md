# 指南 PDF 副本清理记录

2026-09-14，按用户要求改为 Markdown 文档交付。以下 25 份指南 PDF 已从 `output/pdf/` 移入 Windows 回收站，共 6,595,493 字节。可从回收站恢复，也可从 Git 提交 `c5caede8` 取回当时副本；未永久删除。

逐份核对 Markdown 来源存在、完整路径在指定输出目录内、文件及祖先无重解析点、没有活动生成进程或独占占用，并在执行前再次比对 SHA-256。通用清理扫描器没有把指南识别为缓存，因此依据本次明确的指南清理授权逐份处理。业务原件与四份工资导出验收 PDF 样本仍在各自证据目录。

历史验收记录里的 PDF 页数、路径及哈希保留为当时证据；当前指南入口已切换到 Markdown，历史摘要不用于声称这些 PDF 仍存在。

| 已回收文件 | 当前 Markdown | 字节 |
| --- | --- | ---: |
| 瑞航CRM_班组与工人档案使用指南.pdf | [crew-worker-records](../guides/crew-worker-records.md) | 227121 |
| 瑞航CRM_本地核心身份数据迁移使用指南.pdf | [local-data-migration](../guides/local-data-migration.md) | 360823 |
| 瑞航CRM_材料单价分析使用说明.pdf | [material-price-analysis](../guides/material-price-analysis.md) | 223585 |
| 瑞航CRM_发票台账与Excel导入导出使用说明.pdf | [finance-invoice](../guides/finance-invoice.md) | 237763 |
| 瑞航CRM_分供方档案与真实事实使用指南.pdf | [supplier-records](../guides/supplier-records.md) | 352785 |
| 瑞航CRM_分供方证照与资料核验使用指南.pdf | [supplier-credential-review](../guides/supplier-credential-review.md) | 314798 |
| 瑞航CRM_付款申请与登记支付使用说明.pdf | [finance-payment](../guides/finance-payment.md) | 260384 |
| 瑞航CRM_工程量合计与台账导出使用说明.pdf | [quantity-totals-and-export](../guides/quantity-totals-and-export.md) | 193658 |
| 瑞航CRM_工程量中央流程使用指南.pdf | [quantity-central-workflow](../guides/quantity-central-workflow.md) | 295565 |
| 瑞航CRM_工资与考勤工作台使用说明.pdf | [payroll-attendance](../guides/payroll-attendance.md) | 336061 |
| 瑞航CRM_核心合同与工程量清单使用指南.pdf | [core-contract-and-boq](../guides/core-contract-and-boq.md) | 420339 |
| 瑞航CRM_开票因子与税额计算使用说明.pdf | [invoice-factor](../guides/invoice-factor.md) | 187594 |
| 瑞航CRM_客户档案与业务关系使用指南.pdf | [customer-records](../guides/customer-records.md) | 283443 |
| 瑞航CRM_列表搜索与筛选使用指南.pdf | [list-search-and-filters](../guides/list-search-and-filters.md) | 238299 |
| 瑞航CRM_目标成本预算使用指南.pdf | [target-cost](../guides/target-cost.md) | 275063 |
| 瑞航CRM_其他支出结算使用指南.pdf | [other-expense-settlement](../guides/other-expense-settlement.md) | 224104 |
| 瑞航CRM_其他支出与公司支出合同使用指南.pdf | [auxiliary-contracts](../guides/auxiliary-contracts.md) | 225149 |
| 瑞航CRM_收款登记使用指南.pdf | [receipt-registration](../guides/receipt-registration.md) | 225869 |
| 瑞航CRM_首页项目与施工进度使用指南.pdf | [home-project-progress](../guides/home-project-progress.md) | 217072 |
| 瑞航CRM_送货单归档与原件包导出使用说明.pdf | [material-delivery](../guides/material-delivery.md) | 246660 |
| 瑞航CRM_项目分供方工作台与文件导入使用说明.pdf | [project-supplier-workbench](../guides/project-supplier-workbench.md) | 286563 |
| 瑞航CRM_项目Excel导入使用指南.pdf | [project-excel-import](../guides/project-excel-import.md) | 218365 |
| 瑞航CRM_新项目启动与施工排程使用指南.pdf | [project-start-and-schedule](../guides/project-start-and-schedule.md) | 396136 |
| 瑞航CRM_页签与页面恢复使用指南.pdf | [tabs-and-recovery](../guides/tabs-and-recovery.md) | 199508 |
| 瑞航CRM_OCR设置使用说明.pdf | [ocr-settings](../guides/ocr-settings.md) | 148786 |

## 第二批：旧工资打印验收样本

2026-09-14，按用户后续“旧 PDF 都可清理，以 Markdown 即可”的授权，将第一批清理时保留的以下 4 份工资打印验收样本移入 Windows 回收站，共 **792,990 字节**。第一批记录中“四份工资导出验收 PDF 样本仍在”的表述仅记录当时状态；本批完成后，这 4 个原路径已不存在。未永久删除，也未生成新 PDF。同盘回收不作为磁盘可用空间增加的证明。

这 4 份均由仓库内浏览器验收脚本的 `page.pdf` 生成，已与原归档清单的文件名、大小及 SHA-256 核对。对应的 Markdown 验收说明及 **15 张页图（A 1 页、C1 2 页、C2 短表 2 页、长表 10 页）**仍保留；本次确认每张页图可解码，未以本次文件检查冒充重新逐页目检。各证据 README 的当前阅读入口已改为 Markdown 和页图，Excel 输出未改动。

执行前逐份解析完整路径，确认均位于 `D:\crm本地项目开发\docs\design\evidence\`，文件及所有祖先无重解析点；完整活动进程清单无匹配生成进程，独占读取检查未发现占用。普通权限读取进程清单被拒后，已通过完整权限检查取得结果，再次比对文件大小和 SHA-256 后使用 Windows 回收站接口处理，没有永久删除回退。未处理其他文件，也未创建临时清理文件。

恢复可使用 Windows 回收站中的原文件及原位置，或从 Git 提交 `85aa0b158eb7c1b1a7404e92b20373db3699b204` 按下列仓库相对路径取回；本次已只读核对该提交中四份文件的字节数及 SHA-256 全部相同。更新的五份 Markdown 共 132 个本地阅读链接均存在。原始 manifest、source-map、逐页复验记录中的 PDF 路径、大小和哈希不倒改；它们证明当时输出，不能用于声称旧 PDF 当前仍在工作区。

| 已回收原路径（相对于仓库根目录） | 字节 | SHA-256 | 当前阅读入口 |
| --- | ---: | --- | --- |
| `docs/design/evidence/issue-412-payroll-a/browser/frozen-a-payroll.pdf` | 177129 | `8320186ae99fe50757902154384bab204e5122b70d49b28e12c04c00f145499a` | [A 工资证据及页图](../design/evidence/issue-412-payroll-a/README.md) |
| `docs/design/evidence/issue-412-payroll-c1/browser/c1-paired-output.pdf` | 191952 | `7559e3f2c0a3e4b26c555aaf9a3007316fd67edf010238fd63b52e5cbfa78ed6` | [C1 工资与考勤证据及页图](../design/evidence/issue-412-payroll-c1/README.md) |
| `docs/design/evidence/issue-412-payroll-c2/interaction/main/c2-paired-output.pdf` | 186104 | `b257d2013361bc41fd9467b2121ca852e887d94bec1e36a7f0463604a410ca1c` | [C2 工资与签工证据及页图](../design/evidence/issue-412-payroll-c2/README.md) |
| `docs/design/evidence/issue-412-payroll-c2/interaction/long-output/c2-long-paired-output.pdf` | 237805 | `1894a4eaffd0c276b59d7595577d8b61ba3b09a8b417f0e5685bd1221fdc611c` | [C2 长表逐页复验说明](../design/evidence/issue-412-payroll-c2/checks/visual/long-output/review.md) |
