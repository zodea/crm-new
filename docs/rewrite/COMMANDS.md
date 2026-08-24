# 中央写命令契约

> 本文档是浏览器中央写命令的权威源。数据实体与迁移看 [`DATABASE.md`](./DATABASE.md)，读 DTO 看 [`READ-MODELS.md`](./READ-MODELS.md)，浏览器权威边界看 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)。

## 1. 当前落点

Issue #293、#314、#315、#316、#318 与 #320 已完成正式项目、正式客户、正式分供方、班组、工人、材料采购合同和施工合同的新建、编辑和表单预载中央写链。浏览器不再直接将这些表单写入本地 SQLite；页面只经领域 CommandStore、CommandRepository 和 HTTP adapter 调用。

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
- `GET /api/read/crews/:id/form`、`GET /api/read/workers/:id/form`：返回正式班组/工人可编辑主档、`version` 和服务端更新时间；中央附件边界未接入时附件恒为空。
- `POST /api/commands/crews`、`POST /api/commands/workers`：新建正式班组/工人。
- `PUT /api/commands/crews/:id`、`PUT /api/commands/workers/:id`：用当前 `baseVersion` 编辑正式班组/工人；工人的 `crewId` 只接受同一正式来源中已存在的稳定 ID。
- `GET /api/read/material-contracts/form-context`、`GET /api/read/material-contracts/:id/form`：返回中央正式项目/分供方选项，或正式材料采购合同的可编辑 draft、附件元数据、`version` 与更新时间。
- `POST /api/commands/material-contracts`、`PUT /api/commands/material-contracts/:id`：新建或按 `baseVersion` 编辑正式材料采购合同；合同与明细 ID 均由服务端分配，项目和分供方只接受中央正式稳定 ID。
- `GET /api/read/construction-contracts/form-context`、`GET /api/read/construction-contracts/:id/form`：返回中央正式项目/甲方客户选项，或正式施工合同 draft、附件元数据、`version` 与更新时间。
- `POST /api/commands/construction-contracts`、`PUT /api/commands/construction-contracts/:id`：新建或按 `baseVersion` 编辑正式施工合同；服务端重验项目—客户关系，施工合同不接受采购明细或分供方关系。

项目/客户/分供方/班组/工人/材料采购合同/施工合同删除、通用离线 outbox、自动合并、完整登录/RBAC 和其他实体的日常写命令不在当前落点。施工合同的既有正式记录只通过 #294 受控核心迁移进入中央，不另建平行导入源。Tauri 继续使用既有本地写路径，不消费浏览器中央命令。浏览器中央列表不提供并行本地删除或快捷编辑；正式编辑必须从中央只读详情显式进入。

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
```

- 服务端重新解析会话并校验工作区、操作人及对应的 `project:write` / `customer:write` / `supplier:write` / `crew:write` / `worker:write` / `material-contract:write` / `construction-contract:write`；客户端字段不是授权证据。
- 新建 ID 由服务端分配不透明值；页面不使用时间戳、名称或本地 `draftId` 作正式主键。
- `version`、最终更新时间和命令结果由服务端生成。
- `draft` 允许缺少业务必填项；`save` / `submit` 同时经页面和服务端执行领域必填校验。客户统一社会信用代码在正式客户间重复时返回字段错误；分供方公司全称、类别、主要联系人必填，统一社会信用代码和内部编码分别唯一。

## 3. 幂等、冲突与读回

- 同一会话/工作区内按实体类型重放同一 `commandId` 返回第一次成功结果，不生成第二个项目、客户、分供方、班组、工人、材料采购合同或施工合同，也不重复递增版本。
- 编辑命令的 `baseVersion` 与服务端当前版本不一致时返回 canonical `ProblemDTO(code='conflict')` 和 HTTP 409，禁止覆盖。
- 表单收到冲突后立即重读服务器表单，保留当前本地内容，并让用户显式选择“保留我的内容”后基于新版重试，或“改用服务器最新版”。
- 命令成功后使用返回的 ID/version 失效同实体详情缓存；列表和详情再从中央读模型取结果，不使用客户端 draft 伪造成功回显。客户、分供方、班组、工人、材料采购合同与施工合同保存后固定刷新同一实体 ID，并保留原列表、详情页签与合法聚焦上下文。

## 4. 网络失败与本地草稿

- 用户点击保存时，浏览器先以 `project-draft-<uuid>` 暂存该次意图，再调用中央命令；成功后立即清除这份暂存。
- 会话或命令请求不可达时，正式读模型不改变，页面必须提示“仅保留本地草稿，未正式保存”。
- 本地草稿按新建/目标项目分区，保留原 `commandId` 和 `baseVersion`；重载表单可恢复。它不是正式项目、不进入列表/汇总，也不能被其他实体当作外键。
- 当前没有自动回放、后台 outbox 或自动冲突合并。用户回到表单后才能再次显式保存。

上述本地阶段草稿当前只适用于项目。客户、分供方、班组与工人中央命令失败时不改变正式读模型，并直接显示保存失败；这些实体尚未承诺离线草稿或自动重放。

## 5. 当前证明边界

材料采购合同命令由 #318 的可重置非生产后台实例证明权限、幂等、乐观锁、读回和浏览器交互。提交态由服务端复算“数量 × 含税单价”的明细合计，拒绝客户端篡改金额；演示合同没有写命令入口。

施工合同命令由 #320 的可重置非生产后台实例证明权限、幂等、乐观锁、项目—客户关系校验、附件读回和浏览器交互。`actualCompletionDate` 不是日常表单可写字段；受控迁移没有 canonical 事实时保持 `null`。甲方单据和开票申请尚无中央只读目标时只展示事实文本，不借现有编辑表单冒充详情。

当前中央项目、客户、分供方、班组和工人命令由可重置的非生产后台实例证明信封、权限、幂等、乐观锁、读回和浏览器交互。#294 在相同的 HTTP/Repository 边界补充核心身份迁移命令：`POST /api/migrations/core/preflight`、`POST /api/migrations/core/dry-run`、`POST /api/migrations/core/:batchId/import|confirm|rollback`，并以 `GET /api/migrations/core/snapshot` 读取中央权威快照。迁移命令要求 `core:migration:write`、稳定 `commandId`、服务端会话身份和批次状态机；后台会重算 canonical 来源哈希、校验备份证明结构与确定性 ID、按实际写入结果重新对账，并在确认时再次拒绝阻塞差异。本地适配器负责从不上传中央的 IndexedDB 备份字节重算摘要和来源，创建与恢复两端都拒绝篡改。它们只服务于显式迁移，不是客户、项目、分供方、班组或工人的日常保存接口。迁移端同样是可重置测试实例，不能把它或 `/api/testing/core-migration/reset` 描述为生产持久化业务库或业务命令。
