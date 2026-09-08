# 中央写命令契约

> 本文档是浏览器中央写命令的权威源。数据实体与迁移看 [`DATABASE.md`](./DATABASE.md)，读 DTO 看 [`READ-MODELS.md`](./READ-MODELS.md)，浏览器权威边界看 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)。

下文“正式”表示来源身份与命令边界；当前后端仍是可重置内存实例，不构成生产持久化证明。前台优先的复核顺序与后置生产验收见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)；本契约不因顺序调整而允许本地正式双写，也不扩展完整审批或账号权限产品。

## 1. 当前落点

Issue #281、#293、#314—#316、#318、#320—#331 已完成正式项目、客户、分供方、班组、工人、项目分供方导入、三类核心合同、五类甲方单据、分包变洽签、分包结算、项目罚扣、两类辅助合同与其他支出结算的中央命令接缝。浏览器不再直接将这些正式事实写入本地 SQLite；页面只经领域 CommandStore、CommandRepository 和 HTTP adapter 调用。#329—#331 已包含在本次整合基线，不再按远端待接入描述。

- `GET /api/read/business-session`：取得当前服务端会话的 `workspaceId`、`actorId` 和 capability。
- `GET /api/read/projects/:id/form`：返回可编辑 draft、附件元数据、`version` 和服务端更新时间。
- `POST /api/commands/projects`：新建正式项目。
- `PUT /api/commands/projects/:id`：用当前 `baseVersion` 编辑正式项目。
- `GET /api/read/customers/:id/form`：返回正式客户可编辑 draft、附件元数据、`version` 和服务端更新时间。
- `POST /api/commands/customers`：新建正式客户。
- `PUT /api/commands/customers/:id`：用当前 `baseVersion` 编辑正式客户。
- `GET /api/read/suppliers/:id/form`：返回正式分供方可编辑主档、`version` 和服务端更新时间；普通附件恒为空，证照仍走证照专用边界。
- `POST /api/commands/suppliers`：新建正式分供方。
- `PUT /api/commands/suppliers/:id`：用当前 `baseVersion` 编辑正式分供方。
- `GET /api/read/project-suppliers/:projectId/import-context`：返回当前正式项目、可选正式分供方、已有合作关系和 `version`；路径项目 ID 与中央身份不一致时拒绝。
- `POST /api/commands/project-suppliers/import`：确认后原子新建或复用正式分供方与 ProjectSupplier，并写入该关系的文件元数据与正文；不创建合同、请款、发票、支付或结算单。
- `GET /api/read/crews/:id/form`、`GET /api/read/workers/:id/form`：返回正式班组/工人可编辑主档、`version` 和服务端更新时间；中央附件边界未接入时附件恒为空。
- `POST /api/commands/crews`、`POST /api/commands/workers`：新建正式班组/工人。
- `PUT /api/commands/crews/:id`、`PUT /api/commands/workers/:id`：用当前 `baseVersion` 编辑正式班组/工人；工人的 `crewId` 只接受同一正式来源中已存在的稳定 ID。
- `GET /api/read/material-contracts/form-context`、`GET /api/read/material-contracts/:id/form`：返回中央正式项目/分供方选项，或正式材料采购合同的可编辑 draft、附件元数据、`version` 与更新时间。
- `POST /api/commands/material-contracts`、`PUT /api/commands/material-contracts/:id`：新建或按 `baseVersion` 编辑正式材料采购合同；合同与明细 ID 均由服务端分配，项目和分供方只接受中央正式稳定 ID。
- `GET /api/read/construction-contracts/form-context`、`GET /api/read/construction-contracts/:id/form`：返回中央正式项目/甲方客户选项，或正式施工合同 draft、附件元数据、`version` 与更新时间。
- `POST /api/commands/construction-contracts`、`PUT /api/commands/construction-contracts/:id`：新建或按 `baseVersion` 编辑正式施工合同；服务端重验项目—客户关系，施工合同不接受采购明细或分供方关系。
- `GET /api/read/subcontract-contracts/form-context`、`GET /api/read/subcontract-contracts/:id/form`：返回正式项目/分供方选项，或正式分包合同 draft、附件、`version` 与更新时间。
- `POST /api/commands/subcontract-contracts`、`PUT /api/commands/subcontract-contracts/:id`：新建或按 `baseVersion` 编辑正式分包合同；服务端重验项目、分供方、劳务/专业类别，并拒绝客户关系与采购明细。
- `GET /api/commands/owner-documents/context`、`GET /api/commands/owner-documents/boq-lines`：按 kind 返回中央正式项目、施工合同，或项目、分供方、分包合同、班组与已确认结算选项；关系不匹配时拒绝。结算候选携版本与剩余可抵扣金额，BOQ 明细只服务甲方量价单据。
- `GET /api/commands/owner-documents/:kind/:id/form`：对 `owner_change` / `owner_report` / `acceptance` / `final_settlement` / `owner_penalty` / `sub_change` / `sub_settlement` / `project_penalty` 八类 kind 返回受控 draft、附件、`version` 与服务端更新时间；响应顶层 `kind + id`、draft ID 和每个附件的 `ownerType + ownerId` 必须与请求目标完全一致，HTTP adapter 拒绝身份错配或非法日期。
- `POST /api/commands/owner-documents`：新建或按每个表单页实例持有的 `baseVersion` 更新五类正式甲方 canonical 单据、分包变洽签、分包结算与项目罚扣，并承载各自草稿、提交、流转、删除与附件变更 action。`sub_change` 使用独立 `subcontract-document:write` capability，只接受同一正式来源中项目、分供方和分包合同的稳定 ID，附件 owner 类型固定为 `subcontract_change_order`；提交校验正数审批金额、合法日期和事由，状态只开放 `draft → submitted`，不补造审批 action，也不借分包结算或项目罚扣写链。甲方罚扣同样不创建申诉审批 action。附件 action 不把已提交单据伪装成可编辑草稿；服务端重验稳定关系、状态和版本，不信任客户端合计。

甲方变洽签调量/调价命令使用 BOQ canonical 计算规则：调减可为负，但有效量不得为负；调价按签证时间稳定排序后的有效量价计算，缺失的新单价不按零价处理。签证 action 只写签证日期，不覆盖申报日期；日期必须是真实存在的日历日，且新签证不得早于同合同既有签证时序尾；同日签证再按签证 action 写入的不可变、单调执行时间排序，不使用通用 `updatedAt` 或无业务含义的单据 ID 打破并列，后续附件维护不得改变签证顺序。月度报量命令按 `periodNo` 取精确快照，只在申报时固化取数基准、来源版本/更新时间、经办人和系统提交时间，草稿不充当审计事实；受控迁移随施工合同同步完整 BOQ 目录和尚未成单的月度完成量事实，历史单据量价只在目录确实缺行时兜底，不得覆盖同稳定 ID 的当前 canonical 名称、数量或单价；无对应期次快照时拒绝借用其他月份的数量。

项目/客户/分供方/班组/工人/核心合同删除、通用离线 outbox、自动合并、完整登录/RBAC 和其他实体的日常写命令不在当前落点。甲方变洽签与甲方报量的删除只是同一中央领域 action，必须服从受保护状态，不是列表快捷删除。已有正式记录只通过 #294 受控核心迁移进入中央，不另建平行导入源。Tauri 继续使用既有本地写路径，不消费浏览器中央命令。浏览器中央列表不提供并行本地删除或快捷编辑；正式编辑必须从中央只读详情显式进入。

## 2. 命令信封

```ts
interface ProjectCommandRequestDTO {
  id?: string                    // 只有编辑命令携带，必须与路由 ID 一致
  workspaceId: string            // 必须与服务端会话一致
  actorId: string                // 必须与服务端会话一致
  requiredCapability: 'project:write'
  commandId: string              // 客户端为一次用户保存意图生成
  baseVersion: string | null     // 新建为 null；编辑为预载版本
  action: 'draft' | 'save' | 'submit'
  draft: ProjectFormDraft
  attachments: FormAttachmentChanges
}

interface CustomerCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: 'customer:write'
  commandId: string
  baseVersion: string | null
  action: 'draft' | 'save' | 'submit'
  draft: CustomerFormDraft
  attachments: FormAttachmentChanges
}

interface SupplierCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: 'supplier:write'
  commandId: string
  baseVersion: string | null
  action: 'draft' | 'save' | 'submit'
  draft: SupplierFormDraft
  attachments: FormAttachmentChanges // 当前主档命令只接受空变更
}

interface ProjectSupplierImportCommandRequestDTO {
  projectId: string
  workspaceId: string
  actorId: string
  requiredCapability: 'project-supplier:write'
  commandId: string
  baseVersion: string
  groups: Array<{
    supplierId: string | null
    supplierName: string
    files: Array<{
      fileName: string
      fileSize: number
      mimeType: string
      category: string
      payloadBase64: string
    }>
  }>
}

interface CrewCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: 'crew:write'
  commandId: string
  baseVersion: string | null
  action: 'draft' | 'save' | 'submit'
  draft: CrewFormDraft
  attachments: FormAttachmentChanges // 当前只接受空变更
}

interface WorkerCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: 'worker:write'
  commandId: string
  baseVersion: string | null
  action: 'draft' | 'save' | 'submit'
  draft: WorkerFormDraft
  attachments: FormAttachmentChanges // 当前只接受空变更
}

interface MaterialContractCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: 'material-contract:write'
  commandId: string
  baseVersion: string | null
  action: 'draft' | 'save' | 'submit'
  draft: MaterialContractFormDraft
  attachments: FormAttachmentChanges
}

interface ConstructionContractCommandRequestDTO {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: 'construction-contract:write'
  commandId: string
  baseVersion: string | null
  action: 'draft' | 'save' | 'submit'
  draft: ProjectContractFormDraft
  attachments: FormAttachmentChanges
}

interface OwnerCommercialDocumentCommandRequestDTO {
  id?: string
  kind: 'owner_change' | 'owner_report' | 'acceptance' | 'final_settlement' | 'owner_penalty' | 'sub_change' | 'sub_settlement' | 'project_penalty'
  workspaceId: string
  actorId: string
  requiredCapability: 'owner-document:write' | 'subcontract-document:write'
  commandId: string
  baseVersion: string | null
  action: 'save' | 'submit' | 'approve' | 'audit' | 'transition-acceptance' | 'attachments' | 'delete' | 'deduct-penalty' | 'rectify-penalty'
  draft?: OwnerDocumentDraft
  attachments?: FormAttachmentChanges
  approvedAt?: string
  audit?: { lines: Array<{ boqLineId: string, auditedQty: number, auditedAmount: number }> }
  target?: 'accepted' | 'warranty' | 'expired'
  facts?: AcceptanceLifecycleFacts
  settlementId?: string          // deduct-penalty：真实已确认分包结算
  settlementVersion?: string     // deduct-penalty：同时校验结算版本
  amount?: number                // deduct-penalty：正数，最多两位小数
  deadline?: string | null        // rectify-penalty：整改期限
  note?: string                  // 两类项目罚扣 action 的说明
}
```

上方信封是公共字段概览；实际请求按 `action` 使用可辨识联合，不能任意组合 kind、action 和可选字段。`deduct-penalty` 与 `rectify-penalty` 只接受 `kind='project_penalty'`；精确类型见 `app/lib/owner-document/central-command-contract.ts`。

- 服务端重新解析会话并校验工作区、操作人及对应的 `project:write` / `customer:write` / `supplier:write` / `project-supplier:write` / `crew:write` / `worker:write` / `material-contract:write` / `construction-contract:write` / `subcontract-contract:write` / `owner-document:write` / `subcontract-document:write` / `auxiliary-contract:write` / `other-settlement:write`；客户端字段不是授权证据。项目分供方文件的上传人固定取本次服务端会话 `actorId`，命令体不接受客户端自报上传人。
- 新建 ID 由服务端分配不透明值；页面不使用时间戳、名称或本地 `draftId` 作正式主键。
- `version`、最终更新时间和命令结果由服务端生成。
- `draft` 允许缺少业务必填项；`save` / `submit` 同时经页面和服务端执行领域必填校验。客户统一社会信用代码在正式客户间重复时返回字段错误；分供方公司全称、类别、主要联系人必填，统一社会信用代码和内部编码分别唯一。

## 3. 幂等、冲突与读回

- 同一会话/工作区内按实体类型重放同一 `commandId` 返回第一次成功结果，不生成第二个实体或重复递增版本。
- 编辑命令的 `baseVersion` 与服务端当前版本不一致时返回 canonical `ProblemDTO(code='conflict')` 和 HTTP 409，禁止覆盖。界面允许用户选择保留本页内容或放弃本页内容后重读中央最新版，不自动前移其他页签的版本。
- 表单收到冲突后立即重读服务器表单，保留当前本地内容，并让用户显式选择“保留我的内容”后基于新版重试，或“改用服务器最新版”。
- 命令成功后使用返回的 ID/version 失效同实体详情缓存；列表和详情再从中央读模型取结果，不使用客户端 draft 伪造成功回显。已接入的主数据、核心合同、甲方变洽签和甲方报量保存后固定刷新同一实体 ID，并保留原列表、详情页签与合法聚焦上下文。
- 项目分供方导入成功后返回同一正式项目详情并重读中央反向关系；新建的分供方同时进入通用中央分供方详情和编辑链，不维护只能从导入页读到的平行主档。
- 项目分供方导入上下文返回工作区内完整、未分页的正式分供方稳定 ID 候选；服务端按该完整集合重验复用身份，不以列表页的前 100 条代替授权或身份校验。
- 项目分供方导入从不可降级的 canonical 关系读面重验已有 ProjectSupplier；关系读取为 `forbidden` / `unavailable` 时整条写命令失败，不把不可见或暂不可读误判为零关系。
- 项目分供方导入先校验文件分类属于“合同、请款、收票、付款、结算、资质、其他”，并要求每个 Base64 正文可解码且实际字节数与 `fileSize` 完全一致，再把新分供方主档、ProjectSupplier 关系、文件元数据与正文作为一个提交单元写入；任一中央接管失败时回滚全部事实与版本，同一 `baseVersion` 可直接重试。

## 4. 网络失败与本地草稿

- 用户点击保存时，浏览器先以 `project-draft-<uuid>` 暂存该次意图，再调用中央命令；成功后立即清除这份暂存。
- 会话或命令请求不可达时，正式读模型不改变，页面必须提示“仅保留本地草稿，未正式保存”。
- 本地草稿按新建/目标项目分区，保留原 `commandId` 和 `baseVersion`；重载表单可恢复。它不是正式项目、不进入列表/汇总，也不能被其他实体当作外键。
- 当前没有自动回放、后台 outbox 或自动冲突合并。用户回到表单后才能再次显式保存。

上述本地阶段草稿当前只适用于项目。客户、分供方、班组与工人中央命令失败时不改变正式读模型，并直接显示保存失败；这些实体尚未承诺离线草稿或自动重放。

## 5. 当前证明边界

材料采购合同命令由 #318 的可重置非生产后台实例证明权限、幂等、乐观锁、读回和浏览器交互。提交态由服务端复算“数量 × 含税单价”的明细合计，拒绝客户端篡改金额；演示合同没有写命令入口。

施工合同命令由 #320 的可重置非生产后台实例证明权限、幂等、乐观锁、项目—客户关系校验、附件读回和浏览器交互。`actualCompletionDate` 不是日常表单可写字段；受控迁移没有 canonical 事实时保持 `null`。

甲方变洽签与甲方报量命令由 #323 的可重置非生产后台实例证明权限、幂等、乐观锁、项目—施工合同关系、附件读回、受保护状态和量价重算。甲方变洽签的量价变更合计与审定含税金额分字段存储；纯金额签证提交可由审定含税或不含税任一正金额成立。提交只保留当时预览；签证命令必须基于当前已签证时序链再次校验并重算有效量价，防止并行待签单据将合同量降为负数或锁定过期金额。“新增”操作物化为稳定 BOQ 行，后续变更与报量均使用该结果；纯金额签证不改写 BOQ 或月度工程量快照版本。系统锁定台账与手录纯金额签证仍是同一 canonical 读面。甲方报量直接消费 `monthly_statements` 的自动/申报/审定事实，审定命令要求每行显式给出审定量（包括显式的 `0`）。验收—保修命令由 #324 在同一 `acceptance` ID 上证明单向状态链、追加审计和终态锁定。最终结算命令由 #325 在同一中央契约中证明草稿保存、提交、附件 owner 身份、关系重验与迁移读回；已提交记录的业务字段锁定。审定金额/日期只能来自已有持久化事实，当前未新增审定 action。甲方罚扣、分包变洽签、分包结算与项目罚扣已分别由 #326—#329 接入专属中央只读目标；#330/#331 的辅助合同与其他支出结算命令同样已进入当前基线。开票申请等尚未接入的目标仍按实际能力展示事实文本，不借编辑表单冒充详情。

当前中央项目、客户、分供方、班组、工人和项目分供方导入命令由可重置的非生产后台实例证明信封、权限、幂等、乐观锁、读回和浏览器交互。项目分供方命令还证明完整正式候选集、服务端上传人、正文实际字节长度和跨分供方主档/合作关系的原子提交；文件、版本或中央接管无效时不留分供方、关系、文件或版本半成品，重放同一 `commandId` 不重复写入。#294 在相同的 HTTP/Repository 边界补充核心身份迁移命令：`POST /api/migrations/core/preflight`、`POST /api/migrations/core/dry-run`、`POST /api/migrations/core/:batchId/import|confirm|rollback`，并以 `GET /api/migrations/core/snapshot` 读取中央权威快照。迁移命令要求 `core:migration:write`、稳定 `commandId`、服务端会话身份和批次状态机；后台会重算 canonical 来源哈希、校验备份证明结构与确定性 ID、按实际写入结果重新对账，并在确认时再次拒绝阻塞差异。本地适配器负责从不上传中央的 IndexedDB 备份字节重算摘要和来源，创建与恢复两端都拒绝篡改。它们只服务于显式迁移，不是客户、项目、分供方、班组或工人的日常保存接口。迁移端同样是可重置测试实例，不能把它或 `/api/testing/core-migration/reset` 描述为生产持久化业务库或业务命令。

### AX02 分包结算

`POST /api/commands/owner-documents` 接受 `kind=sub_settlement`，使用 `subcontract-document:write`、commandId、baseVersion；save 保存草稿，submit 确认同一支出结算并锁定。服务器重验项目/分供方/分包合同 ID、正金额、名称及日期，附件 owner 固定为 expenditure_settlement。候选只包含正式已确认结算，并按项目/分供方/合同过滤。#329 的独立抵扣事实已进入结算净额；未接入或无法精确归属的付款事实仍保持未知，见[页面蓝本](./pages/owner-documents.md#issue-328-分包结算中央只读链)。

## AX03 项目罚扣命令

#329 通过同一 `POST /api/commands/owner-documents` 和 `subcontract-document:write` 接入 `project_penalty` 的草稿保存、提交、附件，以及 `deduct-penalty` / `rectify-penalty`。普通编辑仅用于草稿；提交后的金额不经编辑表单修改。抵扣命令携罚扣 `baseVersion`、真实已确认分包结算的 `settlementId + settlementVersion`，服务端校验双方关系和剩余余额，追加独立抵扣记录并更新双方版本；重复请求不重复入账。整改命令追加期限、说明及操作者/时间，不伪造签认或审批事实。具体资格、金额和审计只见 [DATABASE](./DATABASE.md#ax03-中央项目罚扣与独立抵扣事实) 与 [页面蓝本](./pages/owner-documents.md#issue-329-项目罚扣中央执行链)。

## AX04 辅助合同命令

#330 浏览器正式写入经 `POST /api/commands/auxiliary-contracts`，使用 `auxiliary-contract:write`、commandId 与 baseVersion，接收 `other_expense` / `company_expense` 两类草稿的 `draft` / `save` / `submit`。表单上下文及回填从 `GET /api/read/auxiliary-contracts/context` 和 `GET /api/read/auxiliary-contracts/:id` 取得。两类合同共享原子头资料与附件元数据写入，保留专属关系边界；读面与命令同源。业务字段、状态和聚合不在此复制，见 [DATABASE](./DATABASE.md#ax04-辅助合同中央事实) 与 [页面蓝本](./pages/contract-forms.md#ax04-当前浏览器实现330)。旧浏览器本地写入口拒绝两类合同写入，Tauri 原路径保留。

## AX05 其他支出结算命令

#331 浏览器正式写入经 `POST /api/commands/other-settlements`，使用 `other-settlement:write`、commandId 与 baseVersion。`draft` 允许未完成业务字段；`save` 校验并保留当前状态，`submit` 进入待确认；仅待确认记录接受 `confirm`，确认后锁定。服务端重验同项目、同分供方、非草稿的真实其他支出合同并原子维护结算头和附件元数据；不写第二套结算明细或本地正式副本。表单上下文及回填使用 `GET /api/read/other-settlements/context` 和 `GET /api/read/other-settlements/:id`。

奖罚、申请、支付通过 `GET /api/read/other-settlements/:id/source` 独立读取中央源单；这不扩展为通用付款申请或支付记录写命令。#331 的受控迁移接管既有其他支出结算抵扣事实，不把 #329 当前只接受已确认分包结算的新增抵扣命令扩展到其他结算类型。金额、准确归属与迁移规则只见 [DATABASE](./DATABASE.md#ax05-其他支出结算中央事实) 和 [页面蓝本](./pages/contract-forms.md#ax05-当前浏览器实现331)。中央仍为可重置测试实例，附件正文服务与生产持久化不由这些命令入口宣告完成。
