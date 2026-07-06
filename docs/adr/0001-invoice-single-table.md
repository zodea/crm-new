# 发票单表：invoices 即台账，废弃 ticket_registrations

> 状态：已采纳（2026-07-05）

红圈 CRM 用两个实体管进项发票（识别工作区 + 收票登记台账），DATABASE.md 最初照搬了 `ticket_registrations`。但设计稿反馈轮 7/9 定稿了「归档不是终态、归档后仍可改（弹二次确认）」与「项目详情进项票额 = Σ该项目归档发票」——两表方案意味着归档后每次编辑都要双写同步，且台账行会丢失原图/置信度等识别上下文。

**决策**：一张 `invoices` 表通吃识别中间态与归档台账态，靠状态机（ocr_status / review_status / account_status）区分阶段；归档那刻强制选归属（项目 或 个人开支）；项目详情「收票登记」Tab = 查已归档 invoices。`ticket_registrations` 从 DATABASE.md 删除。保留可选 `contract_id` 字段（红圈有合同的收票可挂支出合同，本期不做交互）。

**代价**：与红圈参照系偏离——未来对照红圈「收票登记」模块时，对应物是发票台账的已归档行，不是独立表。
