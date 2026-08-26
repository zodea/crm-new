# 界面实现状态

> 核对日期：2026-08-25
>
> 视觉基准：`DC重构设计源码/app.dc.html`
>
> 实现基准：`app/pages/`、`app/lib/nav/nav-tree.ts` 与当前表单注册/路由
>
> 本文只回答“界面有没有”和“是否形成生产闭环”，不复制页面字段、历史完成评论或视觉规格。

## 1. 口径

界面状态分为四类，不能互相替代：

- **未实现**：设计稿存在可达界面，但 Nuxt 没有对应路由/入口，或路由正文是待实现占位。
- **已搭但未闭环**：路由和主要结构存在，但中央权威、领域专属只读行为、真实关系或运行证据仍由当前实施票承接。
- **当前已实现**：运行代码、数据/迁移、用户路径和测试同时满足当前 open 规格；页面能打开或历史 Issue 已关闭都不够。
- **待补设计**（`design-pending`）：实现路由存在，但没有当前设计权威落点。

页面文件、dev 路由、生产路由与设计覆盖只以下方生成表为准；不要在叙述段落另写一套手工数字。运行证据与 20 个页面域的同源核对见 [`runtime-evidence-ledger.json`](./runtime-evidence-ledger.json)。

## 2. 当前总数

下表由 `node scripts/sync-design-coverage.mjs` 从两侧注册表现算写入，逐条设计映射见 [`design-coverage.json`](./design-coverage.json)。

<!-- design-coverage:begin -->
| 口径 | 数量 |
| --- | ---: |
| 设计稿 PAGE 路由 | 69 |
| 设计稿整页表单路由 | 40 |
| 设计稿侧栏分组 / 叶子 | 9 / 50 |
| 实现页面文件（含 dev） | 137 |
| 开发预览路由 | 5 |
| 实现生产路由（排除 dev） | 132 |
| 实现侧栏叶子 | 51 |
| 已覆盖 | 130 |
| 待补设计（实现有、设计稿没有） | 2 |
| 已退役（设计稿有、实现不做） | 0 |
<!-- design-coverage:end -->

实现侧栏当前有 51 个叶子，设计稿为 50 个；新增的“本地数据迁移”属于下方显式登记的 `design-pending`，由 #294 的运行契约与四档视口证据暂时裁定，不把缺失设计静默算作覆盖。

## 3. 两向设计缺口

### 设计稿有、实现没有

**当前为 0。** `design-coverage.json` 的 `designOnly` 为空；历史落地提交只从 Git 追溯，不在本状态表保留易失效短哈希。

### 实现有、设计稿没有

**当前为 2。** `/finance/payment/:id/detail` 与 `/settings/data-migration` 已有生产路由，但没有一一对应的 DC 页面；分别由 [#305](https://github.com/zodea/crm-new/issues/305) 与 [#294](https://github.com/zodea/crm-new/issues/294) 承接。在补齐设计源码前保持 `design-pending`，不能写成设计已覆盖。

| 生产路由 | 当前设计状态 | 实施票 |
| --- | --- | --- |
| `/finance/payment/:id/detail` | `design-pending` | [#305](https://github.com/zodea/crm-new/issues/305) |
| `/settings/data-migration` | `design-pending` | [#294](https://github.com/zodea/crm-new/issues/294) |

编辑表单不等于详情页；能修改基础字段不能替代反向聚合、来源穿透和只读详情动作。

## 4. 已搭但未闭环

以下 20 个页面域与 [`READ-MODELS.md`](../rewrite/READ-MODELS.md) 使用同一稳定 code 和路由数，实施票由 `scripts/runtime-evidence-ledger.mjs` 的唯一映射生成。只有对应票写回提交、测试和运行证据并关闭后，相关范围才可移入“当前已实现”。

<!-- implementation-frontier:begin -->
| 页面域 | 路由数 | 当前实施票 |
| --- | ---: | --- |
| 首页 | 1 | [#278](https://github.com/zodea/crm-new/issues/278) |
| 项目 | 3 | [#288](https://github.com/zodea/crm-new/issues/288)、[#293](https://github.com/zodea/crm-new/issues/293)、[#294](https://github.com/zodea/crm-new/issues/294)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 基础主数据 | 9 | [#281](https://github.com/zodea/crm-new/issues/281)、[#316](https://github.com/zodea/crm-new/issues/316)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 分供方 | 4 | [#281](https://github.com/zodea/crm-new/issues/281)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 项目分供方 | 2 | [#281](https://github.com/zodea/crm-new/issues/281)、[#289](https://github.com/zodea/crm-new/issues/289)、[#317](https://github.com/zodea/crm-new/issues/317) |
| 核心合同 | 12 | [#277](https://github.com/zodea/crm-new/issues/277)、[#282](https://github.com/zodea/crm-new/issues/282)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 辅助合同与结算 | 12 | [#295](https://github.com/zodea/crm-new/issues/295)、[#298](https://github.com/zodea/crm-new/issues/298)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 甲方单据 | 4 | [#283](https://github.com/zodea/crm-new/issues/283)、[#323](https://github.com/zodea/crm-new/issues/323)、[#324](https://github.com/zodea/crm-new/issues/324)、[#325](https://github.com/zodea/crm-new/issues/325)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 分包单据 | 6 | [#295](https://github.com/zodea/crm-new/issues/295)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 自购材 | 12 | [#296](https://github.com/zodea/crm-new/issues/296)、[#297](https://github.com/zodea/crm-new/issues/297)、[#298](https://github.com/zodea/crm-new/issues/298)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 甲供材 | 15 | [#299](https://github.com/zodea/crm-new/issues/299)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 送货单闭环 | 4 | [#296](https://github.com/zodea/crm-new/issues/296)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 材料价格 | 1 | [#296](https://github.com/zodea/crm-new/issues/296)、[#298](https://github.com/zodea/crm-new/issues/298)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 收入财务 | 10 | [#302](https://github.com/zodea/crm-new/issues/302)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 支出财务 | 11 | [#303](https://github.com/zodea/crm-new/issues/303)、[#305](https://github.com/zodea/crm-new/issues/305)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 发票台账 | 4 | [#304](https://github.com/zodea/crm-new/issues/304)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 工程量与工资 | 9 | [#300](https://github.com/zodea/crm-new/issues/300)、[#301](https://github.com/zodea/crm-new/issues/301)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 项目进度成本 | 9 | [#300](https://github.com/zodea/crm-new/issues/300)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 导入导出 | 3 | [#278](https://github.com/zodea/crm-new/issues/278)、[#294](https://github.com/zodea/crm-new/issues/294) |
| 系统设置 | 1 | [#204](https://github.com/zodea/crm-new/issues/204) |
<!-- implementation-frontier:end -->

基础主数据仍由父规格统一承接；其中客户列表—只读详情—显式编辑子链已由 [#314](https://github.com/zodea/crm-new/issues/314) 闭合，分供方中央列表—详情—显式编辑及合同/结算/归档发票/确认付款四类事实子链已由 [#315](https://github.com/zodea/crm-new/issues/315) 闭合，班组—工人中央列表—详情—显式编辑及项目/责任/工资/扣罚稳定 ID 关系链已由 [#316](https://github.com/zodea/crm-new/issues/316) 闭合。父规格其他范围仍未因此完成。

核心合同中的材料采购子链已由 [#318](https://github.com/zodea/crm-new/issues/318) 闭合；施工合同子链由 [#320](https://github.com/zodea/crm-new/issues/320) 闭合；分包合同子链由 [#321](https://github.com/zodea/crm-new/issues/321) 闭合中央列表、七分区只读详情、演示只读边界、正式整页新增/编辑与中央读回。[#322](https://github.com/zodea/crm-new/issues/322) 进一步闭合两类补充协议的稳定 ID 聚焦、父子归属校验、正式迁移与列表来源恢复。未知实际竣工、结算/结清状态保持 `null`，材料领用缺少稳定外键时保留明确空态。

甲方单据中的变洽签/月度报量子链已由 [#323](https://github.com/zodea/crm-new/issues/323) 闭合；[#324](https://github.com/zodea/crm-new/issues/324) 进一步闭合验收/保修 canonical 双视图。[#325](https://github.com/zodea/crm-new/issues/325) 现已闭合最终结算专属只读链：列表与中央整页表单分路，详情只展示真实申报/审定事实，变更后合同金额与累计收款在查询时从合同、非草稿补充协议和活跃收款聚合；项目、甲方、施工合同、结算源单、补充协议和收款均按稳定 ID 往返。未记录的审定值保持 `null`，不创建假审定 action。甲方罚扣未因此扩大，仍由父规格下后续票闭合。

跨页面的项目—材料采购合同—分供方旅程已由 [#319](https://github.com/zodea/crm-new/issues/319) 闭合：项目详情按稳定 ID 与来源进入材采列表，真实 `0`、缺失、暂不可用和无权限分开表达；材采合同按稳定分供方 ID 进入合同/结算/收票/付款事实，并逐级恢复页签、筛选、分页、滚动与焦点。该旅程不扩展为交付、库存或结算核心实现，也不代表父规格其他合同链已完成。

不占独立页面域的公共依赖仍按原生 blocking 关系推进：正式/演示隔离 [#279](https://github.com/zodea/crm-new/issues/279)、财务集成 [#286](https://github.com/zodea/crm-new/issues/286)、服务器事件通知 [#290](https://github.com/zodea/crm-new/issues/290)、页签恢复 [#306](https://github.com/zodea/crm-new/issues/306)，最终由浏览器生产接缝 [#278](https://github.com/zodea/crm-new/issues/278) 验收全域。OCR 设置继续由既有专项 [#204](https://github.com/zodea/crm-new/issues/204) 承接。

## 5. 证据状态边界

- 历史关闭票只证明当前页面基础的来源，不推导 #292 的生产完成状态。
- 34 条历史证据和 9 条 `unverified-target` 保持原等级；没有新的安全直接证据不得升级。
- `direct`、`adjacent`、`local-authority`、权限状态和观测日期逐端点记录在生成账本；叙述结论只留在 [`runtime-reference-audit.md`](./runtime-reference-audit.md)，生成 JSON 只保存结构化键与权威源引用。
- 当前已实现数量不在本轮提前汇总；每张实施票关闭时按其真实路由范围更新，避免把“路由存在”再次统计成“业务闭环”。

## 6. 维护方式

界面、路由、页面域、证据等级或实施状态变化时，同一提交：

1. 更新设计稿可达界面或 Nuxt 路由；
2. 运行 `node scripts/sync-design-coverage.mjs` 与 `node scripts/sync-runtime-evidence-ledger.mjs`；
3. 更新受影响页面蓝本/ADR（若业务或架构规格变化）；
4. 将提交、测试和运行证据写回当前 GitHub Issue。

不要手改生成块，也不要再创建按反馈轮或会话命名的第二份状态表。
