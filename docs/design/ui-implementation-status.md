# 界面实现状态

> 核对日期：2026-08-25
>
> 视觉基准：有直接对应页时采用红圈登录运行态证据；瑞航品牌、独有能力和无对应页采用 `DC重构设计源码/app.dc.html`，优先级见[设计入口](./README.md)。
>
> 实现基准：`app/pages/`、`app/lib/nav/nav-tree.ts` 与当前表单注册/路由
>
> 本文区分界面覆盖、已实现行为与尚未完成的链路，不复制页面字段或视觉规格。“前台功能已验证”与“生产可用”分别验收；历史页面落地记录不自动取得生产可用结论。

> 本轮任务入口：[全模块复核与红圈对齐路线](https://github.com/zodea/crm-new/issues/402)。下文原票号与计数是既有实现证据；被替代票已指向新的承接者，选定 SHA 后由[可信复核基线](https://github.com/zodea/crm-new/issues/403)校正。任务重组不提升完成状态；本轮分别验收规则定稿、前台功能、跨模块链和生产可用。

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
| 实现页面文件（含 dev） | 142 |
| 开发预览路由 | 5 |
| 实现生产路由（排除 dev） | 137 |
| 实现侧栏叶子 | 51 |
| 已覆盖 | 135 |
| 待补设计（实现有、设计稿没有） | 2 |
| 已退役（设计稿有、实现不做） | 0 |
<!-- design-coverage:end -->

实现侧栏当前有 51 个叶子，设计稿为 50 个；新增的“本地数据迁移”属于下方显式登记的 `design-pending`，由 #294 的运行契约与四档视口证据暂时裁定，不把缺失设计静默算作覆盖。

## 3. 两向设计缺口

### 设计稿有、实现没有

**当前为 0。** `design-coverage.json` 的 `designOnly` 为空；历史落地提交只从 Git 追溯，不在本状态表保留易失效短哈希。

### 实现有、设计稿没有

现有生成账本登记 **2 条**：`/finance/payment/:id/detail` 与 `/settings/data-migration` 已有生产路由，但没有一一对应的 DC 页面。本轮分别由 [#404](https://github.com/zodea/crm-new/issues/404) 联同 [#413](https://github.com/zodea/crm-new/issues/413)、以及 [#414](https://github.com/zodea/crm-new/issues/414) 复核；旧 #305/#294 仅保留来源含义。在补齐设计源码前保持 `design-pending`，不能写成设计已覆盖。

| 生产路由 | 当前设计状态 | 本轮复核承接 |
| --- | --- | --- |
| `/finance/payment/:id/detail` | `design-pending` | [#404](https://github.com/zodea/crm-new/issues/404)、[#413](https://github.com/zodea/crm-new/issues/413) |
| `/settings/data-migration` | `design-pending` | [#414](https://github.com/zodea/crm-new/issues/414) |

编辑表单不等于详情页；能修改基础字段不能替代反向聚合、来源穿透和只读详情动作。

## 4. 已搭但未闭环

以下既有页面域与 [`READ-MODELS.md`](../rewrite/READ-MODELS.md) 使用同一稳定 code；路由数从运行矩阵计算，表内旧实施票由 `scripts/runtime-evidence-ledger.mjs` 的历史映射生成。新图对应关系由 #403 在选定 SHA 后一并校正；当前执行入口使用 #402 的子票。只有对应实施范围具备提交、测试和运行证据后才可更新实现状态，旧票因“被替代”关闭不能作为完成依据。

<!-- implementation-frontier:begin -->
| 页面域 | 路由数 | 当前实施票 |
| --- | ---: | --- |
| 首页 | 1 | [#278](https://github.com/zodea/crm-new/issues/278) |
| 项目 | 3 | [#288](https://github.com/zodea/crm-new/issues/288)、[#293](https://github.com/zodea/crm-new/issues/293)、[#294](https://github.com/zodea/crm-new/issues/294)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 基础主数据 | 9 | [#281](https://github.com/zodea/crm-new/issues/281)、[#316](https://github.com/zodea/crm-new/issues/316)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 分供方 | 4 | [#281](https://github.com/zodea/crm-new/issues/281)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 项目分供方 | 2 | [#281](https://github.com/zodea/crm-new/issues/281)、[#289](https://github.com/zodea/crm-new/issues/289)、[#317](https://github.com/zodea/crm-new/issues/317) |
| 核心合同 | 12 | [#277](https://github.com/zodea/crm-new/issues/277)、[#282](https://github.com/zodea/crm-new/issues/282)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 辅助合同与结算 | 15 | [#295](https://github.com/zodea/crm-new/issues/295)、[#330](https://github.com/zodea/crm-new/issues/330)、[#331](https://github.com/zodea/crm-new/issues/331)、[#298](https://github.com/zodea/crm-new/issues/298)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 甲方单据 | 4 | [#283](https://github.com/zodea/crm-new/issues/283)、[#323](https://github.com/zodea/crm-new/issues/323)、[#324](https://github.com/zodea/crm-new/issues/324)、[#325](https://github.com/zodea/crm-new/issues/325)、[#326](https://github.com/zodea/crm-new/issues/326)、[#289](https://github.com/zodea/crm-new/issues/289) |
| 分包单据 | 8 | [#295](https://github.com/zodea/crm-new/issues/295)、[#327](https://github.com/zodea/crm-new/issues/327)、[#289](https://github.com/zodea/crm-new/issues/289) |
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

基础主数据仍由父规格统一承接；客户列表—只读详情—显式编辑子链已由 [#314](https://github.com/zodea/crm-new/issues/314) 闭合，分供方中央列表—详情—显式编辑及合同/结算/归档发票/确认付款四类事实子链已由 [#315](https://github.com/zodea/crm-new/issues/315) 闭合，班组—工人中央列表—详情—显式编辑及项目/责任/工资/扣罚稳定 ID 关系链已由 [#316](https://github.com/zodea/crm-new/issues/316) 闭合，项目×分供方六类事实工作台已由 [#317](https://github.com/zodea/crm-new/issues/317) 闭合。[#281](https://github.com/zodea/crm-new/issues/281) 已完成四条子链的父级联合验收，补齐客户→项目和工作台→项目/分供方的同源受限返回，并将项目详情反向关系、导入确认、导入后工作台与分供方编辑读回收敛到同一中央身份链；父规格其他页面域不因此提前标为完成。

核心合同中的材料采购子链已由 [#318](https://github.com/zodea/crm-new/issues/318) 闭合；施工合同子链由 [#320](https://github.com/zodea/crm-new/issues/320) 闭合；分包合同子链由 [#321](https://github.com/zodea/crm-new/issues/321) 闭合中央列表、七分区只读详情、演示只读边界、正式整页新增/编辑与中央读回。[#322](https://github.com/zodea/crm-new/issues/322) 进一步闭合两类补充协议的稳定 ID 聚焦、父子归属校验、正式迁移与列表来源恢复。[#282](https://github.com/zodea/crm-new/issues/282) 已完成施工/分包父级联合验收：列表项目与客户/分供方只在稳定 ID 和同源目标成立时下钻，补充协议与甲方业务单据按各自聚焦范围返回精确错误，未核验来源事实不生成死链接。未知实际竣工、结算/结清状态保持 `null`，材料领用缺少稳定外键时保留明确空态。

甲方单据中的变洽签/月度报量子链已由 [#323](https://github.com/zodea/crm-new/issues/323) 闭合；[#324](https://github.com/zodea/crm-new/issues/324) 进一步闭合验收/保修 canonical 双视图；[#325](https://github.com/zodea/crm-new/issues/325) 闭合最终结算；[#326](https://github.com/zodea/crm-new/issues/326) 现已闭合甲方罚扣专属只读链。罚扣编号从全局列表与施工合同事实行进入同一中央详情，独立展示金额、联系单、日期、事由、申诉、状态、项目/甲方/合同关系和真实附件；来源返回恢复原列表或合同分区与焦点。#283 已完成父级联合验收：项目详情按同一稳定项目 ID 同时提供变洽签、报量、验收、保修、最终结算与甲方罚扣六类入口，最终结算和罚扣穿过列表/详情后仍恢复原项目卡片锚点、滚动与焦点。正式保存、提交、迁移和读回只走中央源，申诉说明不扩展为审批流，也不混入项目罚扣或分包结算抵扣。

分包单据中的分包变洽签子链已由 [#327](https://github.com/zodea/crm-new/issues/327) 闭合。全局列表、项目详情第七张业务单据卡片与分包合同变洽签事实行按同一稳定 ID 进入专属只读详情；项目、分供方、分包合同、审批金额、变更面积、实际审定价、状态和签证单附件均来自 canonical `subcontract_change_orders`，返回恢复来源筛选、分区、行与焦点。正式保存、提交、受控迁移和读回只走中央源。随后 [#328](https://github.com/zodea/crm-new/issues/328) 已接入分包结算专属详情、显式编辑/确认、附件和迁移；尚未接入的付款、抵扣与完整生命周期由 [#410](https://github.com/zodea/crm-new/issues/410) 按选定基线复核，不再把分包结算整域列为未开发。后续 #329 的远程成果与本地基线差异由 #403 核实，完整审批引擎仍在本轮范围之外。

项目导航公共依赖 [#289](https://github.com/zodea/crm-new/issues/289) 已由 [#312](https://github.com/zodea/crm-new/issues/312) 与 [#313](https://github.com/zodea/crm-new/issues/313) 闭合并完成父级联合验收：项目名称只按稳定 ID、canonical variant、来源与 capability 经唯一 Target Registry 进入只读详情；合法 `returnTo` 恢复搜索、阶段、排序、列筛选、分页、应用页签、滚动与焦点，非法、过期或直达来源降级到规范项目列表。该闭合只确认项目往返基线，不把其他页面域尚未接入的关系入口提前标为完成。

跨页面的项目—材料采购合同—分供方旅程先由 [#319](https://github.com/zodea/crm-new/issues/319) 闭合子切片，并由 [#277](https://github.com/zodea/crm-new/issues/277) 完成父级联合验收：项目与分供方正式身份仍只由各自主档及 #294 核心迁移边界建立，材采合同迁入仅校验已存在的稳定 ID；合同表单候选、校验和只读投影不再使用平行静态身份。正式合同按同一 `supplier_id` 回流分供方合同事实，且能继续穿透同一中央项目；中央目标消失时不保留空标签死链，真实 `0` 结算仍进入专属空表。项目详情按稳定 ID 与来源进入材采列表，真实 `0`、缺失、暂不可用和无权限分开表达；混合来源列表按所点击行记录 `dataOrigin`，并逐级恢复页签、筛选、分页、操作锚点、滚动与焦点。该旅程不扩展为交付、库存或结算核心实现，也不代表父规格其他合同链已完成。

不占独立页面域的公共能力本轮归 [#404](https://github.com/zodea/crm-new/issues/404)（交互、通知、洞察、页签）、[#405](https://github.com/zodea/crm-new/issues/405)（数据处理与对账）、[#406](https://github.com/zodea/crm-new/issues/406)（文件、OCR、导入导出）。资金模块由 [#413](https://github.com/zodea/crm-new/issues/413) 复核，OCR 设置界面归 [#414](https://github.com/zodea/crm-new/issues/414)。旧 #279/#286/#290/#306/#278/#204 保留来源证据；全域实施与验收任务由 [#415](https://github.com/zodea/crm-new/issues/415) 汇总，生产上线另经 [#416](https://github.com/zodea/crm-new/issues/416)。

## 5. 证据状态边界

- 历史完成票只证明相应页面基础的来源；因替代而关闭的票不证明实现完成。两者均不能推导本轮前台复验或生产上线已经通过。
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

分包结算已由 [#328](https://github.com/zodea/crm-new/issues/328) 闭合全局/项目/分包合同到中央专属只读详情，保存确认、受控迁移、结算单附件与累计已确认结算使用统一事实源。付款来源未接入时保留缺口；项目罚扣执行已由 #329 闭合，独立抵扣事实进入结算净额。当前边界见[页面蓝本](../rewrite/pages/owner-documents.md#issue-328-分包结算中央只读链)。

项目罚扣已由 [#329](https://github.com/zodea/crm-new/issues/329) 闭合中央新建/提交、专属只读详情、整改历史与部分抵扣执行；来源合同、分供方、班组、项目及真实结算稳定 ID 往返，余额与审计同源。未实现的审批、签认金额和甲方结算转扣不以假动作/假数据补齐。详情与显式表单分路由；[页面权威](../rewrite/pages/owner-documents.md#issue-329-项目罚扣中央执行链)。

辅助合同中的其他支出与公司支出合同由 [#330](https://github.com/zodea/crm-new/issues/330) 闭合中央只读详情、显式编辑、真实来源往返和专属金额/附件/审计；[页面蓝本](../rewrite/pages/contract-forms.md#ax04-当前浏览器实现330) 与 [运行证据](./evidence/issue-330/README.md) 为准。其他支出结算由 [#331](https://github.com/zodea/crm-new/issues/331) 接入专属中央详情与完整往返，见 [AX05 证据](./evidence/issue-331/README.md)。材料采购结算与父规格其余工作不据此标记完成；可重置中央测试实例和文件正文缺口仍保留。
