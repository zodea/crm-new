# #426 客户收款中央来源验收

> 本页保留已完成切片的实测摘要及原验收边界；日期、数量和阶段状态属于当次记录。历史多轮图片、审查与归档流水统一由[固定 Git 原始材料](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-426)定位。当前规则以所引现行权威文档为准，保留的真实原件、源证明和产品打印不改写。

- 日期：2026-09-10；实施基线：`6ba156e96e89498f0394032656386a82e042d08c`。
- 任务：[实施票 #426](https://github.com/zodea/crm-new/issues/426)，承接 #407/#413/#405。
- 视觉沿用客户详情现有构图与通用组件；本次增加独立收款来源问题态、未知金额与统一收款状态标签。

## 失败复现与修复

原服务直接读取固定最终结算样例：隔离会话仅建客户身份，没有中央单据，也会出现 `receipt-real-325` 和 900,000.00 元。新增服务集成测试首先复现此错误。

现在从当前会话的最终结算中央事实及权限入口获取已有有效收款，按收款 ID 去重。来源版本透传；撤回源记录后，客户关系和收款详情均不再提供该记录。付款账户、收款方式等来源未提供字段保持未知，不用名称代填。

来源无权或不可用时，客户主数据与可读关系保留；收款记录不返回，收款数量/金额、关联项目/合同中的收款聚合与待收差额均为未知。恢复后可在问题态用键盘重试。

## 验证

- 全量测试：428 文件、2,438 测试通过；类型检查通过。
- 原客户/最终结算浏览器回归：7 场景通过；新增中央收款浏览器回归：2 场景通过。
- 新增服务测试涵盖会话隔离、源撤回、来源版本、ID 去重、无权/不可用、恢复与 DTO 拒收假零。
- 390/768/1024/1280/1440px：页面无横向溢出，密集表格独立横滚，收款入口可聚焦，恢复按钮可用 Enter 操作。
- 客户使用指南 PDF 已重新生成，5 页逐页渲染检查通过。

| 视口 | 证据 |
| --- | --- |
| 390 | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-426/customer-receipts-390.png) |
| 768 | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-426/customer-receipts-768.png) |
| 1024 | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-426/customer-receipts-1024.png) |
| 1280 | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-426/customer-receipts-1280.png) |
| 1440 | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-426/customer-receipts-1440.png) |

## 范围边界

双轴复核发现 1 项规范问题（收款状态配色）、2 项规格问题（客户关系权限、正式故障连带演示来源），均已修正并增加失败回归。同类项目/合同受限关联也补充回归：收款保持可读、关联保持权限态，不从其他可读关系补出隐藏身份。正式来源异常不再影响独立演示收款。

本切片仅修复已有中央最终结算收款事实的客户投影，不表示普通收款表单的中央保存、完整资金模块或生产持久化已完成。这些缺口继续由 #413/#416 承接。
