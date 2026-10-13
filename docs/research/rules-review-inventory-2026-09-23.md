# 文档分模块整理清单

> 更新：2026-10-04。此文件保留尚未完成的整理范围和定位；已收口的 A01–A03 只链接现行权威，不重复保存业务规则与整理过程。
>
> 本清单供用户逐项选择整理；A01、A02 已按用户授权推进文档整理，各项完成边界仍按对应行理解。本文是临时整理材料，不定义业务规则，也不复制 Issue 的任务状态。

## 1. 先看主要问题

### 1.1 A01：旧设计指令已收口，运行对比另行核对

设计规则、令牌、组件和参考来源的现行职责统一见[设计入口](../design/README.md)。旧毛玻璃、实体编辑抽屉和真实资料作为演示样本等冲突指令已移除；旧品味文件已退役，独有理由和规则对照并入 [DESIGN-SYSTEM](../rewrite/DESIGN-SYSTEM.md#a01-history)；[公开参考](../design/interaction-style-references.md)只保留独有来源，不发第二套实施指令。规则示意不代替运行验收，历史整理过程通过 Git 查询。

### 1.2 A02：实体定义已归并，未决政策单列

实体、字段、关系、迁移及计算统一见 [DATABASE](../rewrite/DATABASE.md)；公共读写协议分别见 [COMMANDS](../rewrite/COMMANDS.md) 和 [READ-MODELS](../rewrite/READ-MODELS.md)。已确认的业务取舍及实施缺口均留在直接权威章节，本清单不再复制规则、答复、测试数量或逐次整理过程。文档归并完成不表示数据库迁移、业务接线或生产验收完成。

### 1.3 大量重复：总流程复制了专题操作（B04 / B06）

下图表示建议的阅读关系：总指南说明前置条件和结果，详细步骤直接进入已有专题。

```mermaid
flowchart LR
  P["项目启动指南<br/>保留启动顺序与前置条件"]
  K["合同总指南<br/>保留合同主流程与任务入口"]
  P -->|"详细步骤直达"| Q["工程量录入指南"]
  P --> C["目标成本指南"]
  P --> D["送货归档指南"]
  K --> A["辅助合同指南"]
  K --> O["其他支出结算指南"]
```

待精简正文分别在 [项目启动](../guides/project-start-and-schedule.md)和[合同总指南](../guides/core-contract-and-boq.md)；合并后同步移除详细步骤副本，保留专题独有异常与恢复条件。

### 1.4 状态、历史与检查：先核对依赖，再清退

| 主要问题 | 已核实的例子 | 对应工作 |
| --- | --- | --- |
| 状态矛盾 | [工程量规格](../rewrite/pages/subcontract-quantity.md)称 P6 尚在验收，[工资规格](../rewrite/pages/subcontract-payroll.md)称已随 PR #448 合并 | A04 / B08 / B09：核实版本与环境，清除跨模块状态副本 |
| 历史转引过多 | [历史审阅目录](./issue-review-2026-09-11/)同时保留规格、实施票、JSON、HTML 与回执 | C01 / C02：有效内容回到现有权威，独有历史理由保留来源 |
| 生成器和测试绑定 | [工资登记测试](../../tests/ui/payroll-p6-registration.test.ts)固定检查旧报告结构/状态，覆盖索引来自生成器 | C02 / C05：从源数据和模板调整，保留必要验证 |
| 证据目标缺失 | [分供方验收](../design/evidence/issue-453-production-supplier/frontend.md)链接的结果文件及 6 张截图缺失；[P4 实施票](./issue-review-2026-09-11/payroll-tickets/04-central-adjustments-and-actual-payments.md)链接的提交日志缺失 | C08：查恢复来源或标明不可取得，不以删链接掩盖缺失 |

8 个缺失目标是局部核对结果，不是全仓断链总数。以下清单是整理方向，不代表所有文件已逐段复核或附件可直接删除。

## 2. 逐项推进方式

- 按 **A / B / C 编号**选择一个工作单元；状态统一从“待整理”开始，可改为“整理中 / 待核对 / 已完成”。“后续”表示优先级较低，不表示已经完成。
- 每项先核对最新文件和关联来源，再展示具体保留、压缩、合并与删除候选；完成后在原行补一句承接位置和验证结果。已有 Issue 承载的进度不在本文再复制。
- 同一共享文件可能服务多项：A02/A03 先定职责，各业务单元再原位整理对应章节；按当时最新内容串行修改，保护其他任务改动。
- 规格与操作指南可以并存；不同权限、数据事实、异常恢复和用户任务的区别应完整保留。合同、财务或法律规则的实际调整按根规则核实官方依据与适用事实。
- “合并/退役”均是建议：先确认独有内容、例外和未完义务的接收位置，再核对引用及恢复来源。目录项是审查集合，实际处置仍须列出具体文件。
- 本清单沿用已有文件，不自动创建 Issue、实施代码、提交、推送或触发 CI；授权边界以 [AGENTS.md](../../AGENTS.md) 为准。

建议按下面的依赖推进；每次只选择一个编号，独立项可以并行核对。

```mermaid
flowchart TD
  P["先修明显问题<br/>A01 设计 · A04 状态 · C08 证据"]
  R["确定公共职责<br/>A02 数据 · A03 读写"]
  B["选一个业务单元<br/>B01—B20"]
  H["核对历史和生成依赖<br/>C01—C07"]
  V["完成承接与引用检查<br/>再处理已核实的合并 / 删除"]
  P --> R --> B --> V
  R --> H --> V
```

## 3. 共享规范与入口

| 编号 / 状态 | 优先级 | 模块及涉及文件 | 主要问题与建议动作 |
| --- | --- | --- | --- |
| A01 · 文档范围已完成 | 优先 | **设计原则与参考**<br>[设计入口](../design/README.md) · [DESIGN-SYSTEM](../rewrite/DESIGN-SYSTEM.md) · [KitUI](../design/kit-ui-component-specs.md) | 现行职责见设计入口；旧品味文件已归并退役，独有规则图与理由见 DESIGN-SYSTEM；公开来源独立保留，运行对比另行验收。 |
| A02 · 文档范围已完成 | 优先 | **实体、字段与计算口径**<br>[DATABASE](../rewrite/DATABASE.md) | 重复实体定义已归并，字段/关系与公式各有权威章节；目标、当前实现和迁移缺口在该文档中说明，不在清单重复。 |
| A03 · 文档范围已完成 | 较高 | **架构、命令与读模型**<br>[ARCHITECTURE](../rewrite/ARCHITECTURE.md) · [COMMANDS](../rewrite/COMMANDS.md) · [READ-MODELS](../rewrite/READ-MODELS.md) | 已按用户确认原位重构；公共规则唯一、领域保留差异及历史证据，后续实施差距直达各文档的 implementation-gaps 章节。 |
| A04 · 待整理 | 优先 | **界面实现状态**<br>[ui-implementation-status.md](../design/ui-implementation-status.md) · [design/README.md](../design/README.md) | 逐日期堆叠状态；#479 同时出现已完成和继续验收；仍有固定任务入口及无条件写回 Issue 的旧指令。<br>**方向：**核实所选版本后，每模块只留当前边界与证据入口；开发过程留固定版本证据。清掉旧操作指令，保留生成块；设计入口只指路。 |
| A05 · 待整理 | 较高 | **ADR 及替代关系**<br>[adr/README.md](../adr/README.md) · [0007-unified-visual-style-rounded-cards.md](../adr/0007-unified-visual-style-rounded-cards.md) · [0011-redesign-application-shell.md](../adr/0011-redesign-application-shell.md) · [0019-delivery-export-source-preservation.md](../adr/0019-delivery-export-source-preservation.md) · [0004-export-interaction-model.md](../adr/0004-export-interaction-model.md) · [0013-align-all-ui-to-online-design.md](../adr/0013-align-all-ui-to-online-design.md) | 部分 ADR 已主要转引后续规则，仍维持独立入口；索引混入实现状态。<br>**方向：**0007 的独有原则/理由归 0013 或组件契约；0011 的独有外壳行为归公共契约；0019 的导出决策与原件规则分别归 0004、送货规格。完成承接、入链和恢复定位后才列删除候选。其他 ADR 有独立决策价值时保留。 |
| A06 · 待整理 | 较高 | **组件、表单与通用交互**<br>[kit-ui-component-specs.md](../design/kit-ui-component-specs.md) · [DESIGN-SYSTEM §8](../rewrite/DESIGN-SYSTEM.md#a01-business-patterns) · [0003-confirm-dialog-deletion-model.md](../adr/0003-confirm-dialog-deletion-model.md) · [0014-full-page-entity-forms.md](../adr/0014-full-page-entity-forms.md) · [0016-overlay-composition-contract.md](../adr/0016-overlay-composition-contract.md) | A01–A03 收尾已将旧 CRM-PATTERNS 的独有设计归入 DESIGN-SYSTEM；查询、写入和来源返回分别直达 READ-MODELS、COMMANDS、NAVIGATION，旧文件退役。<br>**方向：**继续核对组件正文的旧待办、调用快照与批次状态；ADR 保留取舍，KitUI 保留公开契约，页面只留领域差异，不因文档精简改变组件 API 或表单形态。 |
| A07 · 待整理 | 较高 | **公共导航、消息、页签与列表**<br>[NAVIGATION.md](../rewrite/NAVIGATION.md) · [PUBLIC-SURFACES.md](../rewrite/PUBLIC-SURFACES.md) · [guides/routes.md](../guides/routes.md) · [guides/tabs-and-recovery.md](../guides/tabs-and-recovery.md) · [guides/list-search-and-filters.md](../guides/list-search-and-filters.md) | 导航契约含实施顺序和工资阶段进度；公共能力也另维护“已有/待补齐”。<br>**方向：**契约只定义目标、返回、恢复及消息行为；操作指南保留实际步骤和异常处理；开发进度回到对应任务。上一轮已整理页签指南，本项只核交叉重复与状态。 |
| A08 · 待整理 | 后续 | **协作小文件与入口**<br>[domain.md](../agents/domain.md) · [triage-labels.md](../agents/triage-labels.md) · [issue-tracker.md](../agents/issue-tracker.md) · [skills-cheatsheet.md](../agents/skills-cheatsheet.md) · [agents/README.md](../agents/README.md) · [docs/README.md](../README.md) · [guides/README.md](../guides/README.md) | 来源映射和标签说明形成小型转引链；入口已精简，进一步收益有限。<br>**方向：**评估标签并入 Issue 规程、来源映射并入文档入口；保留独有术语使用约束，技能路由按实际可用能力精简。合并才删原文件并修直链。Git、CI、模块复核继续按独立任务保留。 |

## 4. 业务模块与用户指南

数据、命令、读模型共用 A02/A03 的文件，下面只列各业务专题；共同文件不在每行重复登记。

| 编号 / 状态 | 优先级 | 模块及涉及文件 | 主要问题与建议动作 |
| --- | --- | --- | --- |
| B01 · 待整理 | 较高 | **客户档案**<br>[base-customer.md](../rewrite/pages/base-customer.md) · [guides/customer-records.md](../guides/customer-records.md) | 规格、操作和本机保存说明需进一步厘清，不能把环境限制散写成多套规则。<br>**方向：**页面维护字段与关系，指南维护用户任务；本机差异与 B19 一起处理。可合并同一任务的说明，保留客户与项目关系的独有约束。 |
| B02 · 待整理 | 较高 | **分供方主档、证照及核验**<br>[base-supplier.md](../rewrite/pages/base-supplier.md) · [guides/supplier-records.md](../guides/supplier-records.md) · [guides/supplier-credential-review.md](../guides/supplier-credential-review.md) | 证照状态、人工采用和恢复说明散落在页面、指南及中央契约；主档与本机保存重复环境说明。<br>**方向：**状态定义、写动作与用户步骤各归其位；证照核验作为独立任务保留，主档只链接入口。与 B19 核对本机模式差异。 |
| B03 · 待整理 | 较高 | **班组、工人与私密名册**<br>[base-crew.md](../rewrite/pages/base-crew.md) · [base-worker.md](../rewrite/pages/base-worker.md) · [guides/crew-worker-records.md](../guides/crew-worker-records.md) · [guides/worker-roster-archive.md](../guides/worker-roster-archive.md) | “附件尚未接入”等泛化状态易混淆普通档案、私密照片和名册的不同能力。<br>**方向：**保留班组、工人实体差异及联合操作指南；把可用性说明限定到具体能力和环境。私密名册的权限、原件和归档流程继续独立。 |
| B04 · 待整理 | 较高 | **项目、启动与 Excel 导入**<br>[project-info.md](../rewrite/pages/project-info.md) · [guides/project-start-and-schedule.md](../guides/project-start-and-schedule.md) · [guides/project-excel-import.md](../guides/project-excel-import.md) | 启动指南重复工程量、成本、送货步骤；项目规格重复档案包说明并夹实现历程。<br>**方向：**启动指南保留先后顺序、前置条件、结果及直达专题链接；详细操作分别归 B08/B13/B15。归并档案包规则；项目文件导入继续独立于旧库迁移。 |
| B05 · 待整理 | 优先 | **项目×分供方工作台**<br>[project-supplier.md](../rewrite/pages/project-supplier.md) · [guides/project-supplier-workbench.md](../guides/project-supplier-workbench.md) | 聚合公式与 DATABASE 重复；请款 amount / approved_amount 差异已由 A02 依 #439 收口，未完成本项其余整理。<br>**方向：**沿已核实口径，不按篇幅或现有实现另选公式。计算归数据权威；工作台保留展示、来源、缺源及下钻；支出结算与合作终态继续区分。 |
| B06 · 待整理 | 较高 | **核心/辅助合同、清单与其他结算**<br>[core-contracts.md](../rewrite/pages/core-contracts.md) · [contract-forms.md](../rewrite/pages/contract-forms.md) · [boq-import.md](../rewrite/pages/boq-import.md) · [guides/core-contract-and-boq.md](../guides/core-contract-and-boq.md) · [guides/auxiliary-contracts.md](../guides/auxiliary-contracts.md) · [guides/other-expense-settlement.md](../guides/other-expense-settlement.md) | 合同总指南重复辅助合同/其他结算完整步骤；页面复制 DTO；BOQ 样本观察与通用规则混写。<br>**方向：**总指南只保留这些任务的入口及结果，详细步骤归已有专题；类型快照回到读模型/代码来源。分清样本与通用导入规则，保留尚无其他承接位置的材料采购结算内容。 |
| B07 · 待整理 | 较高 | **甲方单据、分包单据与罚扣**<br>[owner-documents.md](../rewrite/pages/owner-documents.md) · [guides/core-contract-and-boq.md](../guides/core-contract-and-boq.md) | 后续 Issue 的追加段与原单据章节并存，指南末尾又叠加结算和罚扣说明。<br>**方向：**按单据把字段、生命周期、异常和操作归回原章节；沿用合同指南承接用户步骤，无须为盘点补建新指南。 |
| B08 · 待整理 | 较高 | **工程量、责任与完成**<br>[subcontract-quantity.md](../rewrite/pages/subcontract-quantity.md) · [guides/quantity-central-workflow.md](../guides/quantity-central-workflow.md) · [guides/quantity-totals-and-export.md](../guides/quantity-totals-and-export.md) | 区域/模板操作在启动指南重复；工资 P6 进度叙述与工资页面不一致。<br>**方向：**保留矩阵、责任、完成和归档规则；工资只留关联来源，不复制阶段状态。录入完成与核对输出两种任务继续分开。 |
| B09 · 待整理 | 较高 | **工资主流程、考勤与签工**<br>[subcontract-payroll.md](../rewrite/pages/subcontract-payroll.md) · [guides/payroll-attendance.md](../guides/payroll-attendance.md) | P0—P7 进度流水与现行流程混排，跨模块文件继续复制不同时间的完成状态。<br>**方向：**按来源→配置→核对→发放→冻结组织；A/C1/C2 的来源、精度和输出差异完整保留。阶段号只作出处，状态核实时注明版本与环境。 |
| B10 · 待整理 | 较高 | **工资更正、费用与空鼓**<br>[guides/payroll-adjustments.md](../guides/payroll-adjustments.md) · [guides/payroll-fees.md](../guides/payroll-fees.md) · [guides/payroll-hollow.md](../guides/payroll-hollow.md) | 各专题反复解释原单冻结、实际收付、来源返回和输出；与 B08/B09 交叉。<br>**方向：**继续保留三个独立任务指南；共用规则直链对应数据/命令/页面章节，指南只保留本任务步骤、异常与特例。更正和真实补退不能混为同一动作。 |
| B11 · 待整理 | 较高 | **工资正式出具与完整工作簿**<br>[guides/payroll-official-numbering.md](../guides/payroll-official-numbering.md) · [guides/payroll-complete-workbook.md](../guides/payroll-complete-workbook.md) · [subcontract-payroll.md](../rewrite/pages/subcontract-payroll.md) | 编号、冻结、单份输出、整册归档之间有重复说明及多处阶段状态。<br>**方向：**先保留独立任务入口，明确出具与归档顺序、各自结果及权限；共用输出规则只维护一次。是否合并短指南需确认完整流程，不抹平编号、工作簿和私密名册差异。 |
| B12 · 待整理 | 较高 | **排程、工序库与首页进度**<br>[schedule-progress.md](../rewrite/pages/schedule-progress.md) · [homepage-dashboard.md](../rewrite/pages/homepage-dashboard.md) · [guides/home-project-progress.md](../guides/home-project-progress.md) · [guides/project-start-and-schedule.md](../guides/project-start-and-schedule.md) | 排程规格内有历史示例工序及首页布局副本；首页另复制测试文件清单。<br>**方向：**现行工序规则与历史样本分开；首页布局归首页规格，排程只定义提供的数据/入口。测试定位直达已有模块索引，本机工序库差异与 B19 配套。 |
| B13 · 待整理 | 较高 | **目标成本**<br>[target-cost.md](../rewrite/pages/target-cost.md) · [guides/target-cost.md](../guides/target-cost.md) | 项目、排程、成本文档交叉说明版本、基线与金额可用性。<br>**方向：**版本头、科目、基线和未知金额规则集中在对应权威；其他页面只保留来源及入口。规格与用户指南用途不同，继续分开。 |
| B14 · 待整理 | 后续 | **物资与材料价格**<br>[material-management.md](../rewrite/pages/material-management.md) · [guides/material-price-analysis.md](../guides/material-price-analysis.md) | 需核对材料登记、价格分析与合同结算之间的重复，尚未确认需要整份合并。<br>**方向：**保留材料对象和价格分析任务；材料结算继续指向合同专题，避免复制另一套结算规则。只清理已证实重复和历史状态。 |
| B15 · 待整理 | 较高 | **送货识别、归档、原件与 OCR**<br>[material-delivery.md](../rewrite/pages/material-delivery.md) · [guides/material-delivery.md](../guides/material-delivery.md) · [guides/ocr-settings.md](../guides/ocr-settings.md) · [delivery-recognition.md](../prd/delivery-recognition.md) | PRD 与页面重复识别、核对、归档及异常流程；项目启动指南又重述打印。<br>**方向：**稳定交互归页面，用户步骤归指南，OCR 设置单独保留；PRD 仅保留独有目标与未完验收义务，无独有内容后才候选退役。原件保真与 A05 协同。 |
| B16 · 待整理 | 较高 | **付款申请与实际支付**<br>[finance-payment.md](../rewrite/pages/finance-payment.md) · [finance-records.md](../rewrite/pages/finance-records.md) · [guides/finance-payment.md](../guides/finance-payment.md) | 页面含历史观察和跨域实现状态；申请、支付、工资边界已有正确直链需要保留。<br>**方向：**分别维护申请与支付事实，通用保存协议引用 COMMANDS；核对历史观察仍影响哪些规则，留结论和证据。业务金额及勾稽关系不在精简时自行改变。 |
| B17 · 待整理 | 较高 | **收款、往来、开票申请与报销**<br>[finance-receipt.md](../rewrite/pages/finance-receipt.md) · [finance-billing.md](../rewrite/pages/finance-billing.md) · [finance-reimbursement.md](../rewrite/pages/finance-reimbursement.md) · [guides/receipt-registration.md](../guides/receipt-registration.md) | 不同对象夹带共用保存规则及旧运行快照，容易误把历史缺口当当前状态。<br>**方向：**各对象继续独立；通用幂等/冲突说明直链命令契约，保留页面特有校验和操作。没有独立指南的对象不因本次盘点自动新增文件。 |
| B18 · 待整理 | 后续 | **发票、开票因子与 Excel 兼容**<br>[finance-invoice.md](../rewrite/pages/finance-invoice.md) · [real-ticket-excel-reference.md](../rewrite/pages/real-ticket-excel-reference.md) · [guides/finance-invoice.md](../guides/finance-invoice.md) · [guides/invoice-factor.md](../guides/invoice-factor.md) | 真实票据研究位于 pages，易与现行规格混用；样本、导入兼容与因子工具需要分工。<br>**方向：**发票台账、开票申请和因子工具保持区别；兼容规则归已有规格，独有样本分析保留来源。样本研究无独有价值后才退役，不仅搬目录。 |
| B19 · 待整理 | 较高 | **本机保存、备份与旧库迁移**<br>[guides/local-customer-storage.md](../guides/local-customer-storage.md) · [guides/local-project-storage.md](../guides/local-project-storage.md) · [guides/local-supplier-storage.md](../guides/local-supplier-storage.md) · [guides/local-process-library-storage.md](../guides/local-process-library-storage.md) · [guides/local-backup-and-restore.md](../guides/local-backup-and-restore.md) · [guides/local-data-migration.md](../guides/local-data-migration.md) | 多篇短指南重复环境、原提交核对和生产边界；各领域也有真实差异。<br>**方向：**公共运行配置归既有生产入口；领域保存差异可并入相应业务指南的环境章节。备份恢复、旧库身份迁移继续独立；逐项保留恢复条件、门禁和未接管范围。 |
| B20 · 待整理 | 后续 | **经营汇总、迁移对账与生产承接**<br>[project-operating-summary-index.md](../prd/project-operating-summary-index.md) · [project-operating-summary-and-import.md](../prd/project-operating-summary-and-import.md) · [summary-field-catalog.md](../migration/summary-field-catalog.md) · [ruijing-workbook-mapping.md](../migration/ruijing-workbook-mapping.md) · [ruijing-data-quality-and-reconciliation.md](../migration/ruijing-data-quality-and-reconciliation.md) · [ruijing-acceptance.md](../migration/ruijing-acceptance.md) · [project-operating-summary-work-breakdown.md](../implementation/project-operating-summary-work-breakdown.md) | 目标、公式、样本映射与实施入口多处交叉；部分入口已缩短，不能视作都需合并。<br>**方向：**数据契约维护通用计算；迁移材料分别维护字段映射、差异归因和验收。PRD 保留用户目标和未完义务。生产公共边界已归 ARCHITECTURE、COMMANDS、READ-MODELS 与 ADR 0021；生产子票及原生依赖直接见 #416/#450–#471，历史调查与探针定位见 [ARCHITECTURE](../rewrite/ARCHITECTURE.md#production-investigation-evidence)，不复建任务副本。 |

## 5. 历史材料、证据与检查工具

本组可能涉及生成器、测试或钩子；这些文件先列为配套核对范围，当前仅编制清单。

| 编号 / 状态 | 优先级 | 模块及涉及文件 | 主要问题与建议动作 |
| --- | --- | --- | --- |
| C01 · 已迁出 | — | **历史实施票与规格副本** | 由 [#502](https://github.com/zodea/crm-new/issues/502) 承接，范围、问题与进度以该票为准。 |
| C02 · 已迁出 | — | **历史交互报告及其登记测试** | 由 [#502](https://github.com/zodea/crm-new/issues/502) 承接，范围、问题与进度以该票为准。 |
| C03 · 待整理 | 较高 | **验收证据及附件**<br>[evidence](../design/evidence/) · [guide-pdf-cleanup-2026-09-14.md](./guide-pdf-cleanup-2026-09-14.md) | 工资等证据组保存多轮渲染、回执和原始载体；可能重复，尚未完成逐附件去留核对。<br>**方向：**优先核对工资 C2、C1、费用、A、空鼓、目标成本组。按验证事件保留版本/场景/结果/限制及必要原件；对候选附件列精确路径、用途、引用及恢复来源。现有 PDF 清理记录仍承担恢复指针，先保留。 |
| C04 · 待整理 | 后续 | **测试模块索引**<br>[testing/README.md](../testing/README.md) · [modules](../testing/modules/) | 28 个模块重复长导语；当前登记未发现漏项或重复，本次未发现专用生成器。<br>**方向：**共用归属和阅读规则只留 README，模块保留领域分组与定位价值。清理后核对全部登记路径、重复与漏项；不将测试名称索引当业务验收证明。 |
| C05 · 待整理 | 较高 | **生成覆盖索引与运行审计**<br>[module-review-coverage.md](../design/module-review-coverage.md) · [module-review-coverage.json](../design/module-review-coverage.json) · [design-coverage.json](../design/design-coverage.json) · [runtime-evidence-ledger.json](../design/runtime-evidence-ledger.json) · [runtime-reference-audit.md](../design/runtime-reference-audit.md) · [runtime-visual-regression.md](../design/runtime-visual-regression.md) · [sync-module-review-coverage.mjs](../../scripts/sync-module-review-coverage.mjs) · [sync-design-coverage.mjs](../../scripts/sync-design-coverage.mjs) · [sync-runtime-evidence-ledger.mjs](../../scripts/sync-runtime-evidence-ledger.mjs) · [module-review-obligations.mjs](../../scripts/module-review-obligations.mjs) · [module-review.md](../agents/module-review.md) | 生成索引体量大；运行方法、参考采证与逐页验收有重复，直接删生成块会被覆盖。<br>**方向：**保留防遗漏、设计对应、参考证据的不同职责。确需压缩输出时从现有生成源/模板改，验证再生成一致性；逐页复核方法集中，其他位置直链。 |
| C06 · 已迁出 | — | **研究、工具比较与流程方向** | 由 [#502](https://github.com/zodea/crm-new/issues/502) 承接，范围、问题与进度以该票为准。 |
| C07 · 已迁出 | — | **分支整合与交付流水** | 由 [#502](https://github.com/zodea/crm-new/issues/502) 承接，范围、问题与进度以该票为准。 |
| C08 · 待整理 | 优先 | **断链与文档检查缺口**<br>[frontend.md](../design/evidence/issue-453-production-supplier/frontend.md) · [payroll-tickets/04-central-adjustments-and-actual-payments.md](./issue-review-2026-09-11/payroll-tickets/04-central-adjustments-and-actual-payments.md) · [documentation-tooling.md](../testing/modules/documentation-tooling.md) · [git-hooks.mjs](../../scripts/git-hooks.mjs) · [.lintstagedrc](../../.lintstagedrc) · [pre-commit](../../.husky/pre-commit) | 本轮抽查发现 8 个文件目标缺失；已有专用契约测试不等于一般 Markdown 文件/锚点检查。<br>**方向：**先查缺失证据的提交或产物，恢复正确入口或明确不可取得；不得通过删链接伪称证据完整。若补长期检查，复用现有工具，区分历史原路径与阅读链接；钩子/测试行为变更另行审阅。 |

## 6. 暂时保留及配套承接位置

| 文件或类别 | 处理边界 |
| --- | --- |
| [根 README](../../README.md)、[CLAUDE](../../CLAUDE.md)、[AGENTS](../../AGENTS.md)、[CONTEXT](../../CONTEXT.md) | 上一轮已处理入口、协作规则及术语；先整理下层重复，不再把有效规则拆成更多入口 |
| [Git 工作流](../agents/git-workflow.md)、[CI 使用](../agents/ci-usage.md)、[模块复核](../agents/module-review.md) | 触发场景不同，保留独立；仅随实际引用变化同步 |
| [ADR 0001](../adr/0001-invoice-single-table.md)、[0002](../adr/0002-change-order-generates-ledger.md)、[0010](../adr/0010-quantity-matrix-and-construction-record-model.md)、[0012](../adr/0012-exact-factor-combination-solver.md)、[0017](../adr/0017-provisional-schedule-before-contract.md)、[0018](../adr/0018-versioned-schedule-process-library.md) | 有独立决策价值，按对应模块核对，不为减少数量强行合并 |
| [ADR 0005](../adr/0005-import-mapping-model.md)、[0006](../adr/0006-ocr-paddleocr-vl-single-model.md)、[0008](../adr/0008-adopt-shadcn-vue-on-unocss.md)、[0009](../adr/0009-vxe-table-as-datagrid-engine.md)、[0015](../adr/0015-form-persistence-and-payment-reconciliation.md)、[0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)、[0021](../adr/0021-single-operator-windows-production-storage.md) | 保留选型、读写与运行边界；业务或组件单元触及时收去重复字段、样本和历史状态，不自行改变方案 |
| 工资更正、费用、空鼓、名册；工程量录入与导出；文件导入、旧库迁移与备份 | 同组审查不代表合成一篇；每个任务仍能独立找到前置条件、操作结果和恢复办法 |
| 真实参考资料、数据库、密钥、其他任务改动、活动产物 | 仅按相关依赖核对；不得作为文档冗余批量清理，也不扩展修改用户全局规则 |

文件覆盖：上表涉及页面目录的 24 个 Markdown 文件（其中含真实票据样本研究），以及指南目录的全部 38 个文件：1 个 README 入口、36 篇操作专题和 1 篇路由索引。清单中的历史目录还需在相应工作单元逐文件核对，未声称完成全附件审查。

## 7. 每项完成标准

处理一个编号时，逐项核对以下条件；“保留”也需要检查正文，不能仅凭标题判定。

- [ ] 独有规则、例外、决策理由、退役业务仍有效的限制和未完验收义务都有明确承接。
- [ ] 现行规则、已定待开发、实际实现、历史观察表述清楚；未以代码现状直接覆盖已定规格。
- [ ] 受影响的文件链接、锚点、词条、代码/测试引用、生成源已核对；新增/并行修改已复扫。
- [ ] 证据保留固定版本、场景、操作、结果和限制；未凭相似截图、失败日志或旧日期作删除判断。
- [ ] 合并后的旧正文已移除，入口直接指向承接位置；删除候选有精确路径及恢复方式。未跟踪独有内容不假称可从 Git 恢复，外部历史链接的限制如实注明。
- [ ] 按改动运行必要检查：纯文档核对差异、链接和相关契约；改变生成器/测试再验证相应行为。无关应用全套测试和 CI 不自动运行。
- [ ] 用对应真实任务检查导航，例如找到页面规格、完成一次导入、查询工资概念或回看验收依据；没有增加不必要的跳转。
- [ ] 原行已简记处理动作、承接位置、验证结果和剩余限制；工作区已有改动保持完整。

每批交付只展示选定编号的差异和验证，不把整份清单视为一次性实施授权。全部整理完成后，将独有长期说明并回既有权威文件，清退本清单及临时输出；不再追加另一份重复总结。
