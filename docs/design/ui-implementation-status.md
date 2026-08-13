# 界面实现状态

> 核对日期：2026-08-13
>
> 视觉基准：`DC重构设计源码/app.dc.html`
>
> 实现基准：`app/pages/`、`app/lib/nav/nav-tree.ts` 与当前表单注册/路由
>
> 本文只回答“界面有没有”和“是否闭环”，不复制页面字段或视觉规格。

## 1. 口径

界面分两级：

- **未实现**：设计稿存在可达界面，但 Nuxt 没有对应路由/入口，或路由正文明确是“待实现”占位。
- **已搭但未闭环**：路由和主要结构存在，但关键数据仍是 mock/静态值、主要动作没有真实写路径，或已由 open Issue 明确继续完善。

“已搭但未闭环”不能被统计成“未实现”，也不能因为页面能打开就宣称完成。

缺口有两个方向，必须分开统计，不得互相抵消：

- **设计稿有、实现没有**（本文原有口径「未实现」）。
- **实现有、设计稿没有**（`design-pending`）。实现跑到设计稿前面同样是缺口 —— 它让 ADR 0013 第 3 级权威源失效，评审时无据可对。

三个路由数字口径不同，不得相加：`git ls-files app/pages` 的 **131** 是页面文件数（含 5 个 `app/pages/dev/` 调试页）；**126** 是排除 dev 后的生产路由，与 [`runtime-reference-audit.md`](./runtime-reference-audit.md) §5 矩阵同口径；**109** 是设计稿可达业务屏幕（69 常规 + 40 整页表单，#244 回填 7 屏 + 3 表单后的口径，此前为 99）。#181 / #206 正文的 115 是过期数字。

## 2. 当前总数

下表由 `pnpm design:sync-coverage` 从两侧注册表现算写入，逐条明细见 [`design-coverage.json`](./design-coverage.json)；**不要手改**，改了会被 `tests/ui/design-token-contract.test.ts` 的「设计覆盖契约」判红。

<!-- design-coverage:begin -->
| 口径 | 数量 |
| --- | ---: |
| 设计稿 PAGE 路由 | 69 |
| 设计稿整页表单路由 | 40 |
| 设计稿侧栏分组 / 叶子 | 9 / 50 |
| 实现生产路由（排除 dev） | 128 |
| 实现侧栏叶子 | 50 |
| 已覆盖 | 127 |
| 待补设计（实现有、设计稿没有） | 1 |
| 已退役（设计稿有、实现不做） | 0 |
<!-- design-coverage:end -->

侧栏 IA 已 1:1：实现与设计稿各 50 个叶子、key 与 label 逐条一致，且实现侧每个叶子都已填 `to`（无灰显占位）。

## 3. 设计稿有、实现没有

**当前为 0。** 上一版本文列出的两个「未实现」均已落地，本文当时未同轮更新：

| 设计界面 | 落地提交 | 现状 |
| --- | --- | --- |
| 付款管理 | `c61465a` | `/finance/payment-management`，侧栏 `payManage` 已填 `to` |
| 请款簿详情 | `fda6c38` | `/subcontract/payroll/:id`，走统一详情壳 |

此前唯一不映射到实现的设计屏是不可达的 `detail`（「施工明细」，头注 2026-07-19 自标待删，能力已由 `quantityUnit` 户详情承接），已连同 `AppShell` / `QuantityScreen`（v1）/ `SettingsDialog` / `WageSlipScreen` 四个未挂载文件一并从设计源码删除，历史查 Git。`design-coverage.json` 的 `designOnly` 现为空。

编辑表单不等于详情页；能修改基础字段不能替代反向聚合、来源穿透和详情动作。

## 3b. 实现有、设计稿没有

**当前为 0。** [#244](https://github.com/zodea/crm-new/issues/244) 已把此前 10 条无落点的生产路由全部补进设计源码。#198 新增的工资整页建单继续映射既有 `payroll` 设计源：字段、状态与业务构图沿用该屏，只有承载方式按 ADR 0014 从列表内嵌区域迁为独立路由，不构成无设计来源页面。

| 生产路由 | 设计稿落点 | 依据 |
| --- | --- | --- |
| `/schedule/process-library` | `processLibrary`（`ScheduleProcessLibraryScreen.jsx`） | ADR 0018 不可变版本、建组冻结快照 |
| `/schedule/process-library/form` | `processLibraryForm`（`kit/forms/ScheduleForms.jsx`） | 已发布版本只读，沿用原 `code` 新建下一版 |
| `/schedule/:pid/bind/:gid` | `scheduleBind`（`ScheduleBindScreen.jsx`） | ADR 0017 楼栋覆盖 / 分项映射 / 数量差异三段校验，未覆盖楼栋阻断绑定 |
| `/subcontract/attendance` | `attendance`（`AttendanceScreen.jsx`） | 工人 × 日期矩阵、已发放月份封锁、矩阵只在自身容器横滚 |
| `/subcontract/daywork` | `daywork`（`DayworkScreen.jsx`） | 仅已签字记录参与 C2 取数 |
| `/subcontract/quantity/region` | `quantityRegionForm` | 楼栋→楼层区间→户号规则，无合同项目也可先配 |
| `/subcontract/quantity/template` | `quantityTemplateForm` | 按 ADR 0014 + #198 从大 Dialog 迁为独立路由整页表单 |
| `/export/config/:jobId` | `exportConfig`（`ExportConfigScreen.jsx`） | ADR 0004 独立配置页签 + 三步步骤条，写盘 ≠ 业务完成 |
| `/import/mapping/:entity` | `importMapping`（`ImportMappingScreen.jsx`） | ADR 0005 三步向导 + 行级拒绝清单不静默丢弃 |
| `/project/:pid/supplier/import` | `projectSupplierImport`（`ProjectSupplierImportScreen.jsx`） | 重复关系跳过、新分供方须人工指定七类后才建 |

新增三仓 `processLibraries` / `quantityRegions` / `houseTypeTemplates` 已入 `AppData.jsx` 的 `PLAIN_COLLS`，演示数据在 `kit/data.js`（值全部匿名虚构，ADR 0014 §9）。

## 4. 已搭但未闭环

以下是当前 open Issue 已明确的主要缺口，不是完整的页面逐项验收副本：

| 范围 | 现有基础 | 未闭环权威 |
| --- | --- | --- |
| 施工进度 / 目标成本 | #191 已闭环目标成本专用列表、版本详情、科目明细事务编辑与逐格错误；施工进度已闭环 WBS、合同/内部暂估三步建组、逐栋范围阻断、区域往返草稿恢复、标准工序库、依赖冲突保护、冻结暂估快照和合同后绑定。首页与施工进度页共用真实排程数据与 WBS 甘特核心；#244 已合入工序库/绑定等缺口路由落点，并把依赖摘要行、单层 FS + lag 设置视图、日期预览与冲突 warning、候选限制与环检测、调期冲突的灰色虚线保留与恢复入口回填进 `SchedulePlanScreen.jsx`（`docs/design/README.md` 的「当前待补设计」已清空），仅剩设计稿四档视口实机截图验收 | 已闭环 |
| 分供方主数据 | #193 已闭环参考式列表、真实聚合筛选、ProjectSupplier 关联、统一七类新建、整页主数据表单、脱敏详情、6 类汇总穿透和分类文件区；[#13](https://github.com/zodea/crm-new/issues/13) 提供真实证照、OCR、有效期与人工审核；#192 提供项目维度合作工作台和文件导入 | 已闭环 |
| 客户 / 班组 / 工人 | #194 已闭环三类真实数据列表、整页表单与详情：领域搜索筛选、脱敏、软删除撤回、深链/下钻、真实人数与项目聚合、档案/在场状态分离，以及 390 / 768 / 1024 / 1440px 局部横滚与键盘验收 | 已闭环 |
| 核心合同 / 工程量清单 | #195 已闭环施工、分包、材料采购三类真实筛选列表与分页、通用合同详情、材料采购共享明细编辑网格、合同清单/变更/月度报量工作台和逐 sheet 导入错误恢复；金额及来源单据只按真实外键聚合，并完成四档局部横滚与键盘验收 | 已闭环 |
| 辅助合同 / 结算 | 四类列表和整页表单已有 canonical 数据与真实 lookup 基础；#196 按 `CompanyExpScreen`、`OtherExpScreen`、`OtherSettleScreen`、`MatSettleScreen` 及对应表单直接源码收拢公司/项目边界、状态筛选、金额汇总、分页、空错状态和结算来源回填。公司/其他支出合同及两类结算均无持久化业务明细实体，`KitEditGrid` 不适用 | 已闭环 |
| 甲方 / 分包单据与罚扣 | #197 已闭环 8 类真实数据列表与整页表单：动态标题、专属列/筛选/分页、来源 query、业务空错态、首错聚焦和四档局部横滚。甲方变洽签/报量复用量价子表，其余 6 类不补造明细；状态、附件和项目罚扣抵扣继续走本地真实事务 | 已闭环 |
| 工程量 / 工资 / 考勤 | #198 已闭环工程量矩阵、量差总表、户型模板整页、单元直达详情、工资独立整页建单、真实考勤汇总与 31 日矩阵，以及 A/C1/C2 核对、组内分配、发放冻结和 A4/Excel 输出；B 合同清单工资因合同责任归属和成本防双计关系仍未具备而继续多层禁用，不冒充 A 类接线 | 已闭环 |
| 乙供 / 甲供 / 送货归档 | #199 已闭环乙供/甲供表单与库存事务基础；#284、#285 的新运行态直接证据确认乙供与甲供列表仍全部共用“材料/对象”通用列，名称和查看动作直接进入编辑态，缺专属只读详情、关系蓝链和返回上下文。甲供五类无运行种子；参考空表仍分别保留总计划、需用、到货、领用、直入直出的专属列，当前本地项目“物资管理”又只有一张送货归档表，缺参考的总计划/需用计划/入库单三组读模型。仓库仍为文本，甲供供货单位身份未裁定；归档库已有 3 头/4 明细和真实详情下钻，但到货—送货归档 canonical 关系仍未建立 | [#201](https://github.com/zodea/crm-new/issues/201)、[#275](https://github.com/zodea/crm-new/issues/275)、[#284](https://github.com/zodea/crm-new/issues/284)、[#285](https://github.com/zodea/crm-new/issues/285) |
| 收入 / 支出 / 发票 | 24 条生产路由、整页表单、SQLite 实体与票款勾稽基础均已存在；当前运行数据为开票 1、收款 1、往来 2、付款申请 3、支付记录 3、发票 8（台账归档态 4），费用报销与结算/发票分摊 seed 为 0。#286 直接证据确认开票、收款、往来、付款申请、报销和支付记录不能继续共用通用财务列：需补专属状态树/列/页尾汇总、名称/编号只读详情、项目/客户/分供方/合同/来源单据蓝链与返回上下文。付款管理和发票识别/台账已是独立工作台，前者需补合同/来源/部门列，后者继续按 ADR 0001 的单表状态机和本地 OCR/打印规格，不把参考“收票登记”空表误当 OCR 页面。参考保证金/备用金四页只记录布局，因本地无路由/实体不在本轮扩张 | [#202](https://github.com/zodea/crm-new/issues/202)、[#203](https://github.com/zodea/crm-new/issues/203)、[#204](https://github.com/zodea/crm-new/issues/204)、[#251](https://github.com/zodea/crm-new/issues/251)、[#275](https://github.com/zodea/crm-new/issues/275)、[#286](https://github.com/zodea/crm-new/issues/286) |
| 导入 / 导出工具 | 配置页和映射工作台已存在 | [#205](https://github.com/zodea/crm-new/issues/205) |
| 全站视觉与交互 | 已使用共享原语并完成部分响应式；#112 已关闭 | [#181](https://github.com/zodea/crm-new/issues/181)、[#206](https://github.com/zodea/crm-new/issues/206) |
| 材料价格分析 | 页面结构、来源追溯、材采合同历史和已核实的广州 BV 2.5 mm² 官方信息价已实现；#284 实测发现现有 3 个归档头/4 条明细会因 `ocr_status='reviewed'` 与分析器要求 `done` 的状态词汇冲突全部被过滤，当前运行页错误显示无可分析数据。修复应统一识别/人工核对状态并复用真实归档事实，不补 Mock；其他官方材料继续保持“暂无核实价格” | [#207](https://github.com/zodea/crm-new/issues/207)、[#275](https://github.com/zodea/crm-new/issues/275)、[#284](https://github.com/zodea/crm-new/issues/284) |
| OCR 设置 | `/settings/ocr` 已完成紧凑纵向工作台：脱敏运行状态、单据接入矩阵、7 项 PaddleOCR-VL 文档能力、有界请求/轮询超时、本机 SQLite 保存及发票/送货单请求接线；传统 PP-OCRv6 参数、服务端密钥和未接线阈值不做假配置 | [#204](https://github.com/zodea/crm-new/issues/204)、[ADR 0006](../adr/0006-ocr-paddleocr-vl-single-model.md) |

应用外壳已在 #188 完成导航精确过滤、路由页签显式翻屏、通知 Sheet 四档响应式、键盘/Esc/焦点返回/滚动锁和脱敏视觉基线；后续全站票只处理各业务页面，不再重复改写外壳状态机。首页已在 #189 完成严格只读参考核对、真实项目切换、单一施工进度甘特、切换失败回退、加载/空/部分数据/错误状态和四档视觉回归，因此不再列入“已搭但未闭环”；施工进度与目标成本也已由 #191 完成逐栋暂估校验、冻结快照、合同后绑定、目标成本明细事务编辑和四档运行态验收。项目详情已在 [#173–#180](https://github.com/zodea/crm-new/issues/180) 完成真实业务子表与来源穿透，并在 #190 进一步完成项目列表左侧状态树、紧凑宽表、详情双栏信息流、十个页签复用和项目整页表单的五档响应式验收；#248 又将阶段时间线提升为详情主内容首块，补齐按真实 owner 关系组织的项目档案包多选树、甲供材/乙供材目录、可查看但暂不导出原件的证照清单、缺失原件清单和稳定 ZIP 导出；甲供材当前以 `甲供材供货单位待配置` 作为临时目录名，保留 `99_待归类`，名称自定义和原件下载权限后续配置。项目列表、表单、档案包及详情核心框架不再列入“已搭但未闭环”，但 #285 已确认详情“物资管理”仍只有项目到货归档，缺参考的总计划/需用计划/入库单三组读模型，因此该子页继续在物资域登记。项目×分供方已在 #192 接入项目详情入口，完成真实合同/请款/收票/支付分摊/两类结算聚合、源单穿透、合作文件预览下载、合作终态结算，以及“选择文件—文件名分类与人工调整—确认生成”的本地事务导入；该范围也不再列入未闭环。以上结论不改变路由总数，只改变闭环状态。

## 5. 维护方式

界面新增、删除或从占位升级时，同一提交更新：

1. 设计稿可达界面或 Nuxt 路由；
2. 本文总数和对应行；
3. 相关页面蓝本/ADR（若业务或架构规格也变化）；
4. GitHub Issue 的完成证据。

不要再创建按“反馈轮”或某次会话命名的第二份状态表。
