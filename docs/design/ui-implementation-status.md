# 界面实现状态

> 核对日期：2026-07-29
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

三个路由数字口径不同，不得相加：`git ls-files app/pages` 的 **131** 是页面文件数（含 5 个 `app/pages/dev/` 调试页）；**126** 是排除 dev 后的生产路由，与 [`runtime-reference-audit.md`](./runtime-reference-audit.md) §5 矩阵同口径；**99** 是设计稿可达业务屏幕（62 常规 + 37 整页表单）。#181 / #206 正文的 115 是过期数字。

## 2. 当前总数

下表由 `pnpm design:sync-coverage` 从两侧注册表现算写入，逐条明细见 [`design-coverage.json`](./design-coverage.json)；**不要手改**，改了会被 `tests/ui/design-token-contract.test.ts` 的「设计覆盖契约」判红。

<!-- design-coverage:begin -->
| 口径 | 数量 |
| --- | ---: |
| 设计稿 PAGE 路由 | 62 |
| 设计稿整页表单路由 | 37 |
| 设计稿侧栏分组 / 叶子 | 9 / 50 |
| 实现生产路由（排除 dev） | 126 |
| 实现侧栏叶子 | 50 |
| 已覆盖 | 116 |
| 待补设计（实现有、设计稿没有） | 10 |
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

## 3b. 实现有、设计稿没有（待补设计 10 条）

由 [#244](https://github.com/zodea/crm-new/issues/244) 统一补齐；每条的原因与归属票在 `design-coverage.json` 的 `screenParity` 内登记，缺原因或缺归属票会让契约测试变红。

| 生产路由 | 缺什么 | 归属票 |
| --- | --- | --- |
| `/schedule/process-library` · `/schedule/process-library/form` | 标准工序库列表与版本编辑（ADR 0018） | [#191](https://github.com/zodea/crm-new/issues/191) |
| `/schedule/:pid/bind/:gid` | 暂估排程绑定施工合同复核（ADR 0017） | [#191](https://github.com/zodea/crm-new/issues/191) |
| `/subcontract/attendance` · `/subcontract/daywork` | 工资考勤网格、逐日签工录入 | [#198](https://github.com/zodea/crm-new/issues/198) |
| `/subcontract/quantity/region` · `/subcontract/quantity/template` | 区域配置整页表单；户型模板在设计稿仍是大 Dialog，违反 ADR 0014 | [#198](https://github.com/zodea/crm-new/issues/198) |
| `/export/config/:jobId` · `/import/mapping/:entity` | 设计稿只有 `KitUI.exportModal` / `importModal` 弹窗，违反 ADR 0004 / 0005 | [#205](https://github.com/zodea/crm-new/issues/205) |
| `/project/:pid/supplier/import` | 项目×分供方导入向导 | [#192](https://github.com/zodea/crm-new/issues/192) |

## 4. 已搭但未闭环

以下是当前 open Issue 已明确的主要缺口，不是完整的页面逐项验收副本：

| 范围 | 现有基础 | 未闭环权威 |
| --- | --- | --- |
| 施工进度 / 目标成本 | WBS、合同/内部暂估排程、独立标准工序库列表与整页版本表单、三步建组、模板甘特/精确表格同源编辑、前置轻量弹窗和冲突软禁用、项目区域配置，以及目标成本版本详情与正式成本对比已实现；首页与施工进度页已共用 Reka WBS Tree + 甘特核心，默认首组展开、按项目会话记忆且写操作仅留在施工进度页；暂估分组可在独立页面复核差异后绑定同项目施工合同 | [#191](https://github.com/zodea/crm-new/issues/191)、[ADR 0017](../adr/0017-provisional-schedule-before-contract.md)、[ADR 0018](../adr/0018-versioned-schedule-process-library.md) |
| 项目×分供方 / 分供方 | 工作台、列表、详情与表单基础已存在 | [#192](https://github.com/zodea/crm-new/issues/192)、[#193](https://github.com/zodea/crm-new/issues/193) |
| 客户 / 班组 / 工人 | 列表、整页表单和详情均已存在；详情只按真实外键聚合项目、合同/收款、工程量、工资、考勤、签工和扣罚，具体参考同屏差异仍待验收 | [#194](https://github.com/zodea/crm-new/issues/194) |
| 核心合同 / 辅助合同 / 结算 | 列表、详情和整页表单基础已存在 | [#195](https://github.com/zodea/crm-new/issues/195)、[#196](https://github.com/zodea/crm-new/issues/196) |
| 甲方 / 分包单据与罚扣 | 动态单据列表和表单基础已存在 | [#197](https://github.com/zodea/crm-new/issues/197) |
| 工程量 / 工资 / 考勤 | 无合同项目区域、工程量三量与责任配置、C1 月考勤、C2 逐日签工、A/C1/C2 工资核对、组内分配、发放冻结及 A4/Excel 输出已实现；B 合同清单工资仍因合同责任归属和成本防双计规则未定而禁用 | [#198](https://github.com/zodea/crm-new/issues/198) |
| 乙供 / 甲供 / 送货归档 | 物资单据、库存与识别归档基础已存在 | [#199](https://github.com/zodea/crm-new/issues/199)、[#200](https://github.com/zodea/crm-new/issues/200)、[#201](https://github.com/zodea/crm-new/issues/201) |
| 收入 / 支出 / 发票 | 票款列表、表单、识别和台账基础已存在 | [#202](https://github.com/zodea/crm-new/issues/202)、[#203](https://github.com/zodea/crm-new/issues/203)、[#204](https://github.com/zodea/crm-new/issues/204) |
| 导入 / 导出工具 | 配置页和映射工作台已存在 | [#205](https://github.com/zodea/crm-new/issues/205) |
| 全站视觉与交互 | 已使用共享原语并完成部分响应式；#112 已关闭 | [#181](https://github.com/zodea/crm-new/issues/181)、[#206](https://github.com/zodea/crm-new/issues/206) |
| 材料价格分析 | 已接真实归档送货单价格、材料搜索选择、趋势/厂家比较、来源追溯、材采合同历史，以及已核实的广州 BV 2.5 mm² 2026 年 2–6 月官方信息价趋势/偏差；其他官方材料仍须逐项核实编码规格单位 | [#207](https://github.com/zodea/crm-new/issues/207) |
| OCR 设置 | `/settings/ocr` 已完成紧凑纵向工作台：脱敏运行状态、单据接入矩阵、7 项 PaddleOCR-VL 文档能力、有界请求/轮询超时、本机 SQLite 保存及发票/送货单请求接线；传统 PP-OCRv6 参数、服务端密钥和未接线阈值不做假配置 | [#204](https://github.com/zodea/crm-new/issues/204)、[ADR 0006](../adr/0006-ocr-paddleocr-vl-single-model.md) |

应用外壳已在 #188 完成导航精确过滤、路由页签显式翻屏、通知 Sheet 四档响应式、键盘/Esc/焦点返回/滚动锁和脱敏视觉基线；后续全站票只处理各业务页面，不再重复改写外壳状态机。首页已在 #189 完成严格只读参考核对、真实项目切换、单一施工进度甘特、切换失败回退、加载/空/部分数据/错误状态和四档视觉回归，因此不再列入“已搭但未闭环”；后续施工进度领域能力仍由 #191 继续完善。项目详情已在 [#173–#180](https://github.com/zodea/crm-new/issues/180) 完成只读子表、阶段文件、成本/合同/资金/物资/验收关系、正式事实口径、来源穿透及四档响应式验收，因此不再列入“已搭但未闭环”。这些结论不改变路由总数，只改变闭环状态。

## 5. 维护方式

界面新增、删除或从占位升级时，同一提交更新：

1. 设计稿可达界面或 Nuxt 路由；
2. 本文总数和对应行；
3. 相关页面蓝本/ADR（若业务或架构规格也变化）；
4. GitHub Issue 的完成证据。

不要再创建按“反馈轮”或某次会话命名的第二份状态表。
