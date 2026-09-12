# 中央写命令契约

> 本文档是浏览器中央写命令的权威源。数据实体与迁移看 [`DATABASE.md`](./DATABASE.md)，读 DTO 看 [`READ-MODELS.md`](./READ-MODELS.md)，浏览器权威边界看 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)。

下文“正式”表示来源身份与命令边界；当前后端仍是可重置内存实例，不构成生产持久化证明。前台优先的复核顺序与后置生产验收见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)；本契约不因顺序调整而允许本地正式双写，也不扩展完整审批或账号权限产品。

## 1. 当前落点

Issue #281、#293、#314—#316、#318、#320—#331 已完成正式项目、客户、分供方、班组、工人、项目分供方导入、三类核心合同、五类甲方单据、分包变洽签、分包结算、项目罚扣、两类辅助合同与其他支出结算的中央命令接缝。浏览器不再直接将这些正式事实写入本地 SQLite；写入统一通过领域 CommandStore action、CommandRepository 和 HTTP adapter 调用。#329—#331 已包含在本次整合基线，不再按远端待接入描述；#421 补充分供方表格映射导入的同源写入与回读，逐行导入由 SupplierCommandStore action 承接。

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
- `POST /api/commands/suppliers/import`：#421 接通分供方表格映射的逐行中央导入；按外部旧 ID 精确新建或更新主档，成功后由同一中央表单接口回读。
- `GET /api/read/project-suppliers/:projectId/import-context`：返回当前正式项目、可选正式分供方、已有合作关系和 `version`；路径项目 ID 与中央身份不一致时拒绝。
- `POST /api/commands/project-suppliers/import`：确认后原子新建或复用正式分供方与 ProjectSupplier，并写入该关系的文件元数据与正文；不创建合同、请款、发票、支付或结算单。
- `GET /api/read/crews/:id/form`、`GET /api/read/workers/:id/form`：返回正式班组/工人可编辑主档、`version` 和服务端更新时间；中央附件边界未接入时附件恒为空。
- `POST /api/commands/crews`、`POST /api/commands/workers`：新建正式班组/工人。
- `PUT /api/commands/crews/:id`、`PUT /api/commands/workers/:id`：用当前 `baseVersion` 编辑正式班组/工人；工人的 `crewId` 只接受同一正式来源中已存在的稳定 ID。
- `GET /api/read/material-contracts/form-context`、`GET /api/read/material-contracts/:id/form`：返回中央正式项目/分供方选项，或正式材料采购合同的可编辑 draft、附件元数据、`version` 与更新时间。
- `POST /api/commands/material-contracts`、`PUT /api/commands/material-contracts/:id`：新建或按 `baseVersion` 编辑正式材料采购合同；合同与明细 ID 均由服务端分配，项目和分供方只接受中央正式稳定 ID。
- `GET /api/read/construction-contracts/form-context`、`GET /api/read/construction-contracts/:id/form`：返回中央正式项目/甲方客户选项，或正式施工合同 draft、附件元数据、`version` 与更新时间。
- 施工合同每次进入表单重取当前会话可读的完整正式项目和客户候选，包含刚保存的记录；命令端按稳定 ID 重新验证候选存在、可读且项目当前主客户一致。历史合同归属及客户回读规则见[客户详情](./pages/base-customer.md)，不按项目后续变更自动改写已存合同甲方。
- `POST /api/commands/construction-contracts`、`PUT /api/commands/construction-contracts/:id`：新建或按 `baseVersion` 编辑正式施工合同；服务端重验项目—客户关系，施工合同不接受采购明细或分供方关系。
- `GET /api/read/subcontract-contracts/form-context`、`GET /api/read/subcontract-contracts/:id/form`：返回正式项目/分供方选项，或正式分包合同 draft、附件、`version` 与更新时间。
- `POST /api/commands/subcontract-contracts`、`PUT /api/commands/subcontract-contracts/:id`：新建或按 `baseVersion` 编辑正式分包合同；服务端重验项目、分供方、劳务/专业类别，并拒绝客户关系与采购明细。
- `GET /api/commands/owner-documents/context`、`GET /api/commands/owner-documents/boq-lines`：按 kind 返回中央正式项目、施工合同，或项目、分供方、分包合同、班组与已确认结算选项；关系不匹配时拒绝。结算候选携版本与剩余可抵扣金额，BOQ 明细只服务甲方量价单据。
- `GET /api/commands/owner-documents/:kind/:id/form`：对 `owner_change` / `owner_report` / `acceptance` / `final_settlement` / `owner_penalty` / `sub_change` / `sub_settlement` / `project_penalty` 八类 kind 返回受控 draft、附件、`version` 与服务端更新时间；响应顶层 `kind + id`、draft ID 和每个附件的 `ownerType + ownerId` 必须与请求目标完全一致，HTTP adapter 拒绝身份错配或非法日期。
- `POST /api/commands/owner-documents`：新建或按每个表单页实例持有的 `baseVersion` 更新五类正式甲方 canonical 单据、分包变洽签、分包结算与项目罚扣，并承载各自草稿、提交、流转、删除与附件变更 action。`sub_change` 使用独立 `subcontract-document:write` capability，只接受同一正式来源中项目、分供方和分包合同的稳定 ID，附件 owner 类型固定为 `subcontract_change_order`；提交校验正数审批金额、合法日期和事由，状态只开放 `draft → submitted`，不补造审批 action，也不借分包结算或项目罚扣写链。甲方罚扣同样不创建申诉审批 action。附件 action 不把已提交单据伪装成可编辑草稿；服务端重验稳定关系、状态和版本，不信任客户端合计。

甲方变洽签调量/调价命令使用 BOQ canonical 计算规则：调减可为负，但有效量不得为负；调价按签证时间稳定排序后的有效量价计算，缺失的新单价不按零价处理。签证 action 只写签证日期，不覆盖申报日期；日期必须是真实存在的日历日，且新签证不得早于同合同既有签证时序尾；同日签证再按签证 action 写入的不可变、单调执行时间排序，不使用通用 `updatedAt` 或无业务含义的单据 ID 打破并列，后续附件维护不得改变签证顺序。月度报量命令按 `periodNo` 取精确快照，只在申报时固化取数基准、来源版本/更新时间、经办人和系统提交时间，草稿不充当审计事实；受控迁移随施工合同同步完整 BOQ 目录和尚未成单的月度完成量事实，历史单据量价只在目录确实缺行时兜底，不得覆盖同稳定 ID 的当前 canonical 名称、数量或单价；无对应期次快照时拒绝借用其他月份的数量。

项目/客户/分供方/班组/工人/核心合同删除、通用离线 outbox、自动合并、完整登录/RBAC 和其他实体的日常写命令不在当前落点。甲方变洽签与甲方报量的删除只是同一中央领域 action，必须服从受保护状态，不是列表快捷删除。历史核心身份迁移仍走 #294 受控迁移；#421 的分供方表格映射写入同一中央主档，不另建本地或平行导入源。Tauri 继续使用既有本地写路径，不消费浏览器中央命令。浏览器中央列表不提供并行本地删除或快捷编辑；正式编辑必须从中央只读详情显式进入。

### 项目 Excel 导入（#423）

项目列表入口与历史 `/import/mapping/project` 使用同一 `ProjectCommandStore` 逐行 action，复用 `POST /api/commands/projects` 和 `GET /api/read/projects/:id/form`；不调用旧 `useProjectStore().add` 或本地 SQL 客户解析。行导入拥有独立请求缓存，不 hydrate 编辑表单、不改变编辑目标、草稿、版本或命令会话；成功通知只触发中央查询失效与重读。

文件解析后选择一个 Sheet，映射现行项目模板字段，人工预览后才提交。项目名称、客户和项目经理必填，日期沿现行表单 decoder；阶段沿现行导入归一规则，预览同时展示原值和采用值。客户/次客户从完整分页的中央正式候选解析：精确稳定 ID 优先，其次唯一名称/别名；缺失、歧义、明确 `inactive=停用`、失效或越权逐行拒绝，不创建临时客户。准备后的请求固定关系 ID，提交时服务端重验正式关系与权限，客户改名不能改接别的身份。列表/详情同样按稳定 ID 解析最新客户名称；无权时不泄露身份。

导入请求只允许无 `id`、`baseVersion=null`、`action=save`，附合法 `importSource`，成功后表单回读同一来源元数据。来源字段含义仅在 [DATABASE §10.7](./DATABASE.md#107-导入追溯与差异表) 维护。每个工作区内，同一文件摘要 + Sheet + 原始行，或本 Excel 链路已经保存的非空外部旧 ID，命中已保存回执时：相同规范内容返回原项目 ID；不同内容明确冲突，不能覆盖，修改须显式进入项目编辑。并发提交与响应丢失重试保持同一命令/回执。该外部旧 ID 规则不查询受控整库迁移 `legacyId → serverId` 映射，也不按名称自动合并；原文件变化且无外部旧 ID 视为新的来源。

业务拒绝保留原始行号并继续其他行；网络异常或写后回读失败停在当前行，重试复用原命令；已成功行不再创建。部分成功可下载来源定位和原因清单、进入成功项目详情或仅重试未导入行。导入前取消无写入；导入中停止等待当前行结束后返回列表，其余行停止；重新上传原文件可安全续导。来源切换沿全局确认后刷新契约，清空未保存的文件/映射/预览，中央已保存行仍可回读。原文件不作为附件上传。中央内存实例验证不表示 #416 的生产持久化、实际数据库迁移或备份恢复已经完成。

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
  importSource?: ProjectImportSource // 项目 Excel 新建来源；契约见下节和 DATABASE §10.7
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

interface SupplierImportCommandRequestDTO {
  workspaceId: string
  actorId: string
  requiredCapability: 'supplier:write'
  commandId: string              // 同一映射行的失败重试保持不变
  draft: SupplierImportDraft     // 仅主数据映射字段；不接受 id、审批或人工核验结论
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
- 分供方表格导入沿 [ADR 0005](../adr/0005-import-mapping-model.md) 的上传、映射、预览确认、逐行执行与失败续导。每行公司全称必填；首次建档沿既有最小导入默认值，未映射类别为“其他”、纳税人类型为“未核验”、资料状态为 `incomplete`，不伪造人工核验。完整字段含义与默认展示顺序仍以[分供方页面蓝本](./pages/base-supplier.md)和数据模型为准。
- 导入的 `externalRef` 是外部旧 ID / 匹配标识。服务端在同一正式集合中精确匹配：为空或未命中时新建，唯一命中时只覆盖明确映射字段；未映射字段保留，显式空值可清空选填字段，`laborScope` 与 `mainBusiness` 独立。多记录命中时拒绝，不扫描当前分页或按名称猜测身份。`uniqueCode` 是唯一识别码 / 内部编码，`taxNo` 是统一社会信用代码；二者独立映射并分别查重，不互相回填。
- 导入请求不携带主档 ID、`baseVersion`、附件、审批及人工核验结论；服务端在同一执行段中查找现有版本、合并映射字段并复用中央保存检查。已有 `qualified/rejected` 是否失效仍服从关键工商 / 银行字段变化规则，单独维护劳务范围不改变人工结论。每行保存与回读成功后才计入完成；响应丢失或回读失败沿用该行 `commandId` 重试，不重复新建。同一导入标识改换内容会被拒绝；命令权限与身份由服务端重新验证。
- 表格导入是一行一个提交单元，并非整批原子事务。可预期的空名称在行级拒绝清单中显示，其余业务或请求失败停在当前行，保留页签从该行续导；已经完成的行不重写。`SupplierCommandStore.importRow` 仅在中央回读成功后更新 `latestWrite` 通知缓存页面，不改变当前编辑目标、`baseVersion` 或待重试保存命令。完成后关闭导入页签，返回列表重新读取当前查询。当前不承诺刷新 / 关页后恢复内存中的重试状态、离线重放或生产持久化；浏览器实现仍服从本文第 5 节的非生产实例边界。

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

项目、客户、分供方、班组、工人与三类核心合同的中央表单命令按页面实例持有目标 ID、版本与失败重试意图。切换其他编辑页或执行 Excel 导入不覆盖该实例的保存目标、`baseVersion` 或待重试命令；成功后才发布共享写入版本以刷新读面。

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

### 核心迁移身份接管（#398）

确认批次时，项目、客户、分供方、班组和工人一起接入既有中央命令事实源，列表与普通编辑读写同一稳定 ID；迁移快照不作为第二份日常读源。同批再次同步保留已经编辑的主档；回滚撤回本批接管身份及其后续修改，不撤销其他独立创建的主档。迁入分供方缺少资料核验事实时保持“资料不全”，不得推断核验通过。新正式会话不预置测试身份，只有显式测试 reset 可注入合成样例。这些行为仍属于可重置内存实例，不构成 #416 的持久化验收。

### 工程量中央命令与迁移接管（#442）

`POST /api/commands/quantity` 的领域动作由当前会话、`projectId + origin`、`quantity:write`、稳定 `commandId` 和 `baseVersion` 约束。区域、模板、阶段映射、责任、完成和照片在同一事务中重验当前项目与祖先关系并追加审计；失败不发布部分写入。归档后编辑须显式确认，授权意图参与幂等指纹；取消不发送授权重试。模板复制来源只是审计引用，删除原模板不影响复制件编辑。

甲方月报的提交继续走既有 owner-document 命令，工程量服务提供串行读取窗口，并在持久化月报前重验中央 BOQ 版本。缺量或缺价不能由 `0` 补齐成完整申报；草稿不提前冻结提交人、提交时间或假来源版本。三量读取与快照规则见 [READ-MODELS](./READ-MODELS.md#工程量中央读取与甲方月报442)。

受控迁移先异步准备不可见的数据库候选及各域候选，全部成功后才同步切换工程量、其他领域与主档权威来源；任一准备失败均中止候选，保留原活动实例。外部 BOQ 只迁身份关系，不造本地施工合同或复制量价。回滚若会撤去独立新业务正在引用的祖先，必须返回明确冲突并阻止整批回滚；其他独立新建主档不得一并撤销。该机制仍只证明可重置后台实例，不构成生产数据库迁移或持久化上线验收。

### AX02 分包结算

`POST /api/commands/owner-documents` 接受 `kind=sub_settlement`，使用 `subcontract-document:write`、commandId、baseVersion；save 保存草稿，submit 确认同一支出结算并锁定。服务器重验项目/分供方/分包合同 ID、正金额、名称及日期，附件 owner 固定为 expenditure_settlement。候选只包含正式已确认结算，并按项目/分供方/合同过滤。#329 的独立抵扣事实已进入结算净额；未接入或无法精确归属的付款事实仍保持未知，见[页面蓝本](./pages/owner-documents.md#issue-328-分包结算中央只读链)。

## AX03 项目罚扣命令

#329 通过同一 `POST /api/commands/owner-documents` 和 `subcontract-document:write` 接入 `project_penalty` 的草稿保存、提交、附件，以及 `deduct-penalty` / `rectify-penalty`。普通编辑仅用于草稿；提交后的金额不经编辑表单修改。抵扣命令携罚扣 `baseVersion`、真实已确认分包结算的 `settlementId + settlementVersion`，服务端校验双方关系和剩余余额，追加独立抵扣记录并更新双方版本；重复请求不重复入账。整改命令追加期限、说明及操作者/时间，不伪造签认或审批事实。具体资格、金额和审计只见 [DATABASE](./DATABASE.md#ax03-中央项目罚扣与独立抵扣事实) 与 [页面蓝本](./pages/owner-documents.md#issue-329-项目罚扣中央执行链)。

## AX04 辅助合同命令

#330 浏览器正式写入经 `POST /api/commands/auxiliary-contracts`，使用 `auxiliary-contract:write`、commandId 与 baseVersion，接收 `other_expense` / `company_expense` 两类草稿的 `draft` / `save` / `submit`。表单上下文及回填从 `GET /api/read/auxiliary-contracts/context` 和 `GET /api/read/auxiliary-contracts/:id` 取得。两类合同共享原子头资料与附件元数据写入，保留专属关系边界；读面与命令同源。业务字段、状态和聚合不在此复制，见 [DATABASE](./DATABASE.md#ax04-辅助合同中央事实) 与 [页面蓝本](./pages/contract-forms.md#ax04-当前浏览器实现330)。旧浏览器本地写入口拒绝两类合同写入，Tauri 原路径保留。

## AX05 其他支出结算命令

#331 浏览器正式写入经 `POST /api/commands/other-settlements`，使用 `other-settlement:write`、commandId 与 baseVersion。`draft` 允许未完成业务字段；`save` 校验并保留当前状态，`submit` 进入待确认；仅待确认记录接受 `confirm`，确认后锁定。服务端重验同项目、同分供方、非草稿的真实其他支出合同并原子维护结算头和附件元数据；不写第二套结算明细或本地正式副本。表单上下文及回填使用 `GET /api/read/other-settlements/context` 和 `GET /api/read/other-settlements/:id`。

奖罚、申请、支付通过 `GET /api/read/other-settlements/:id/source` 独立读取中央源单；这不扩展为通用付款申请或支付记录写命令。#331 的受控迁移接管既有其他支出结算抵扣事实，不把 #329 当前只接受已确认分包结算的新增抵扣命令扩展到其他结算类型。金额、准确归属与迁移规则只见 [DATABASE](./DATABASE.md#ax05-其他支出结算中央事实) 和 [页面蓝本](./pages/contract-forms.md#ax05-当前浏览器实现331)。中央仍为可重置测试实例，附件正文服务与生产持久化不由这些命令入口宣告完成。

PAY-07 的付款批复来源由现有本地付款保存域验证，中央关联源单只投影该事实；本切片不新增通用付款写命令。后续接管必须继续遵守 [DATABASE §10.2](./DATABASE.md#102-支付记录及付款申请分摊) 的明确输入、事务回滚与历史未知兼容边界，不能凭读 DTO 的来源标签确认历史批复。

## 普通收款登记命令（#436）

浏览器正式收款使用 `POST /api/commands/receipts`，要求服务端会话、`receipt:write`、工作区/操作人、稳定 `commandId`、来源 `real` 和编辑时的 `baseVersion`；`GET /api/read/receipts/context` 与 `GET /api/read/receipts/:id/record` 提供候选和完整回填。动作仅 `draft` / `save` / `submit`，业务校验和状态结果见[收款页面契约](./pages/finance-receipt.md)。旧浏览器本地保存入口拒绝收款写入，Tauri 原适配保留。

命令先重验现有与请求中的项目、主客户、可选施工合同的读权及真实归属，再校验全部字段、非空流水号唯一性和文件正文。附件新增、删除、恢复与收款头、审计和版本构成原子提交；文件归属不能由客户端跨记录指定。相同命令 ID 必须携相同完整请求，正文或动作变化也不能借重放覆盖第一次结果；旧版本返回冲突，不自动覆盖。保存失败保留当前页实例的输入、附件和待重试意图，成功后从同一实体读回；不承诺刷新后恢复未保存草稿或自动离线重放。

重新激活缓存编辑页时重新验证权限和来源，保留未保存内容及原版本；读取失败时禁写，恢复后再核对保存。详情/列表重新读取不沿用旧金额作成功结果。附件读取使用 `GET /api/read/receipts/:id/files/:fileId`，复验当前来源、收款与附件归属，并校验正文大小/哈希；保存位置选择先于异步正文读取。

受控迁移在既有核心迁移 prepare/commit 边界接管全部原字段、附件元数据和已存正文；相同迁移同步保留中央更正，回滚仅撤销所属批次，独立新建记录保留。数据定义见 [DATABASE](./DATABASE.md)，本节不扩展为生产持久化或新的收款审批流程。
