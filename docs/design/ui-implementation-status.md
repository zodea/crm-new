# 界面实现状态

> 核对日期：2026-08-25
>
> 上述日期是运行参考采证时点；当前源码覆盖由下方生成表和对应 JSON 按工作区实际注册关系核对。
>
> 视觉基准：有直接对应页时采用红圈登录运行态证据；瑞航品牌、独有能力和无对应页采用 `DC重构设计源码/app.dc.html`，职责见[设计入口](./README.md)。
>
> 实现基准：`app/pages/`、`app/lib/nav/nav-tree.ts` 与当前表单注册/路由。设计覆盖、限定功能验收与生产可用分别判断。

## 1. 口径

本页只维护当前设计覆盖、两向缺口和验收边界，不另存逐票进度、已答问题或历史测试数量。字段与业务动作直达[页面规格](../rewrite/pages/)，数据归属和真实实施差距直达 [ARCHITECTURE](../rewrite/ARCHITECTURE.md#implementation-gaps)、[COMMANDS](../rewrite/COMMANDS.md#implementation-gaps) 与 [READ-MODELS](../rewrite/READ-MODELS.md#implementation-gaps)。

动态单据类型、页面/子视图及运行环境按[模块复核规程](../agents/module-review.md)展开，需核验的完整集合见[覆盖索引](./module-review-coverage.md)。索引区分实际挂载、占位、只预检与正式存储未接；生成数量不是完成率。

- **未实现**：设计稿有可达界面，Nuxt 没有对应入口或正文仍为占位。
- **已搭但未闭环**：路由与结构存在，领域写读、真实关系、依赖来源或运行验收尚未满足确认范围。
- **当前已实现**：代码、持久化或迁移、实际路径和对应测试满足已确认规格；能打开页面或历史 Issue 关闭不足以证明。
- **待补设计**（`design-pending`）：实现路由存在，当前 DC 尚无实际设计落点；功能验证不能替代设计注册。

常驻说明、问号帮助和低频信息的目标只见 [DESIGN-SYSTEM](../rewrite/DESIGN-SYSTEM.md#a01-interface-information)，逐页布局、滚动、键盘和焦点仍须实际验收。

## 2. 当前总数

下表由 `node scripts/sync-design-coverage.mjs` 从两侧注册表现算写入，逐条映射见 [design-coverage.json](./design-coverage.json)。不得在文字中维护另一套数量。

<!-- design-coverage:begin -->
| 口径 | 数量 |
| --- | ---: |
| 设计稿 PAGE 路由 | 73 |
| 设计稿整页表单路由 | 40 |
| 设计稿侧栏分组 / 叶子 | 9 / 51 |
| 实现页面文件（含 dev） | 171 |
| 开发预览路由 | 5 |
| 实现生产路由（排除 dev） | 166 |
| 实现侧栏叶子 | 53 |
| 已覆盖 | 139 |
| 待补设计（实现有、设计稿没有） | 27 |
| 已退役（设计稿有、实现不做） | 0 |
<!-- design-coverage:end -->

侧栏同样以真实注册集合核对。DC 已注册本地数据迁移叶子，不能沿旧快照继续登记为缺设计。运行参考等级与日期另见 [runtime-evidence-ledger.json](./runtime-evidence-ledger.json)。

## 3. 两向设计缺口

### 设计稿有、实现没有

当前 `designOnly` 集合为空。新增差异须由实际设计注册与实现路由比较得出，历史落地顺序从 Git 查询。

### 实现有、设计稿没有

缺口完整集合直接见 [design-coverage.json 的 screenParity](./design-coverage.json)：仅 `status=design-pending` 的路由属于本节。工人私密资料、独立报价、我方主体设置、工资专属编辑/来源/更正/收付/名册/工作簿及户级空鼓等各自保留登记理由和真实承接；不得借相邻页面或通用原语标为覆盖。

### 本轮已补齐的对应页

以下设计注册与挂载已经核实，应从历史缺口中移出；它们不自动取得业务或生产验收结论。

| 实现路由 | DC 当前实际落点 | 限定职责 |
| --- | --- | --- |
| `/finance/payment/:id/detail` | `payApplyDetail`；已注册并挂载 | 付款详情设计；洞察完整能力另按 PUBLIC-SURFACES 核验 |
| `/settings/data-migration` | `dataMigration`；已注册并挂载 | 迁移界面设计；各 owner 的接管与恢复分别验收 |
| `/subcontract/quantity/stages` | `quantityStages`；已注册并挂载 | 工程量期次设计；保留既有历史运行证据 |
| `/schedule/process-library/:id` | `processLibraryDetail`；已注册并挂载 | 工序库版本详情；不能沿旧记录继续标待补设计 |

编辑表单不代替详情、反向聚合或来源穿透。设计映射及其余缺口只在现有生成源与 JSON 中维护。

## 4. 已搭但未闭环

以下页面域与 [READ-MODELS](../rewrite/READ-MODELS.md#domain-projections) 使用稳定 code；路由数来自真实运行矩阵。当前复核责任与历史实施来源分别登记，均不表示 Issue 已关闭或功能已通过。任务要求和进度留在获授权的 Issue，不在此重建逐票状态。

<!-- implementation-frontier:begin -->
| 页面域 | 路由数 | 当前复核承接 |
| --- | ---: | --- |
| 首页 | 1 | [#414](https://github.com/zodea/crm-new/issues/414) |
| 项目 | 3 | [#408](https://github.com/zodea/crm-new/issues/408) |
| 基础主数据 | 10 | [#407](https://github.com/zodea/crm-new/issues/407) |
| 分供方 | 4 | [#407](https://github.com/zodea/crm-new/issues/407) |
| 项目分供方 | 2 | [#408](https://github.com/zodea/crm-new/issues/408) |
| 核心合同 | 13 | [#409](https://github.com/zodea/crm-new/issues/409) |
| 辅助合同与结算 | 16 | [#409](https://github.com/zodea/crm-new/issues/409) |
| 甲方单据 | 4 | [#410](https://github.com/zodea/crm-new/issues/410) |
| 分包单据 | 8 | [#410](https://github.com/zodea/crm-new/issues/410) |
| 自购材 | 12 | [#411](https://github.com/zodea/crm-new/issues/411) |
| 甲供材 | 15 | [#411](https://github.com/zodea/crm-new/issues/411) |
| 送货单闭环 | 4 | [#411](https://github.com/zodea/crm-new/issues/411) |
| 材料价格 | 5 | [#411](https://github.com/zodea/crm-new/issues/411) |
| 收入财务 | 10 | [#413](https://github.com/zodea/crm-new/issues/413) |
| 支出财务 | 11 | [#404](https://github.com/zodea/crm-new/issues/404)、[#413](https://github.com/zodea/crm-new/issues/413) |
| 发票台账 | 4 | [#413](https://github.com/zodea/crm-new/issues/413)、[#414](https://github.com/zodea/crm-new/issues/414) |
| 工程量与工资 | 28 | [#412](https://github.com/zodea/crm-new/issues/412) |
| 项目进度成本 | 10 | [#412](https://github.com/zodea/crm-new/issues/412) |
| 导入导出 | 3 | [#406](https://github.com/zodea/crm-new/issues/406)、[#414](https://github.com/zodea/crm-new/issues/414) |
| 系统设置 | 3 | [#414](https://github.com/zodea/crm-new/issues/414) |
<!-- implementation-frontier:end -->

当前能力和差距按权威职责直接核对：

| 范围 | 当前边界与直接来源 |
| --- | --- |
| 单据、主档与合同 | 各页只采用真实身份和来源；Native 与本机正式路径分别验收，未接正式域不得借开发 owner 开放。见 [ARCHITECTURE](../rewrite/ARCHITECTURE.md#implementation-gaps) |
| F3 与无合同费用 | 既有费用、往来、申请、批复及实付沿现有中央事务与持久 owner；已接范围不代验全部外域。历史批复新支付策略已确认，现行核验及缺源阻断直见 [DATABASE 的 PAY-08](../rewrite/DATABASE.md#entity-payment-record)和[核验命令](../rewrite/COMMANDS.md#f3-finance-payment-verification) |
| 工程量、排程、工资与预算 | 各已验切片保留原冻结、来源与回执；完整持久参与者、成本来源和恢复另行验收，不把后续已完成能力重复记为待开发。见[工资页面](../rewrite/pages/subcontract-payroll.md)、[架构差距](../rewrite/ARCHITECTURE.md#implementation-gaps) |
| 公共洞察、消息与页签 | 现行挂载、事件来源、后台活动和恢复缺口只见 [PUBLIC-SURFACES](../rewrite/PUBLIC-SURFACES.md#6-当前实现差异与实施归属)；保留页签上限和非生产边界 |
| 文件、识别与输出 | 原件读取、冻结输出、实际下载及权限分别验证；合成 OCR 不证明真实外部质量，旧指南渲染不证明 Office/WPS 行为。见[文件与识别边界](../adr/0006-ocr-paddleocr-vl-single-model.md)和[发票指南](../guides/finance-invoice.md) |
| 正式上线 | 已登记存储切片不等于完整交付。基线备份、真实介质、全图恢复及部署遵守 [ADR 0021](../adr/0021-single-operator-windows-production-storage.md) |

## 5. 证据状态边界

- 历史完成票只证明其限定范围；替代关闭不证明实现完成。已有切片不推导全域前台复验或正式上线。
- `direct`、`adjacent`、`local-authority`、`historical`、`unverified-target`、权限与观测日期继续保留各自等级；未经新的安全直接采证不升级。
- 路由级结构与映射在生成账本，观测结论在 [runtime-reference-audit.md](./runtime-reference-audit.md)，逐场景固定提交及证据在 [module-review-coverage.md](./module-review-coverage.md)。
- 原件、迁移证明、冻结文档和必要实际输出按对应验收入口保留。历史数量及已清退过程材料只按其固定 Git 来源理解，不冒称当前全部可取得。
- 不把“路由存在”“设计已覆盖”“某一用例通过”汇总为业务闭环数量。

## 6. 维护方式

界面、路由、页面域或证据归属变化时，核对真实注册并运行现有设计覆盖与运行证据生成器；业务变化同步既有页面规格或 ADR。证据等级只按其实际验证范围更新，Issue 写入继续需要明确授权。

不要手改生成块、放宽缺口断言或另建会话状态表。历史日期流水、逐票发布数量及旧追加摘要从[固定 Git 版本](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/ui-implementation-status.md)查询；旧 PAY-08 待问和工序详情缺设计文字不再作为现行状态。
