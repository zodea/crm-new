# 中央写命令契约

> 本文档是浏览器中央写命令的权威源。数据实体与迁移看 [`DATABASE.md`](./DATABASE.md)，读 DTO 看 [`READ-MODELS.md`](./READ-MODELS.md)，浏览器权威边界看 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)。

## 1. 当前落点

Issue #293 与 #314 分别完成正式项目、正式客户的新建、编辑和表单预载中央写链。浏览器不再直接将这两类表单写入本地 SQLite；页面只经领域 CommandStore、CommandRepository 和 HTTP adapter 调用。

- `GET /api/read/business-session`：取得当前服务端会话的 `workspaceId`、`actorId` 和 capability。
- `GET /api/read/projects/:id/form`：返回可编辑 draft、附件元数据、`version` 和服务端更新时间。
- `POST /api/commands/projects`：新建正式项目。
- `PUT /api/commands/projects/:id`：用当前 `baseVersion` 编辑正式项目。
- `GET /api/read/customers/:id/form`：返回正式客户可编辑 draft、附件元数据、`version` 和服务端更新时间。
- `POST /api/commands/customers`：新建正式客户。
- `PUT /api/commands/customers/:id`：用当前 `baseVersion` 编辑正式客户。

项目/客户导入与删除、通用离线 outbox、自动合并、完整登录/RBAC 和其他实体的日常写命令不在当前落点。Tauri 继续使用既有本地写路径，不消费浏览器中央命令。客户列表不提供并行本地删除或快捷编辑；正式编辑必须从中央只读详情显式进入。

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
```

- 服务端重新解析会话并校验工作区、操作人及对应的 `project:write` / `customer:write`；客户端字段不是授权证据。
- 新建 ID 由服务端分配不透明值；页面不使用时间戳、名称或本地 `draftId` 作正式主键。
- `version`、最终更新时间和命令结果由服务端生成。
- `draft` 允许缺少业务必填项；`save` / `submit` 同时经页面和服务端执行领域必填校验。客户统一社会信用代码在正式客户间重复时返回字段错误。

## 3. 幂等、冲突与读回

- 同一会话/工作区内重放同一 `commandId` 返回第一次成功结果，不生成第二个项目或客户，也不重复递增版本。
- 编辑命令的 `baseVersion` 与服务端当前版本不一致时返回 canonical `ProblemDTO(code='conflict')` 和 HTTP 409，禁止覆盖。
- 表单收到冲突后立即重读服务器表单，保留当前本地内容，并让用户显式选择“保留我的内容”后基于新版重试，或“改用服务器最新版”。
- 命令成功后使用返回的 ID/version 失效同实体详情缓存；列表和详情再从中央读模型取结果，不使用客户端 draft 伪造成功回显。客户保存后固定刷新同一客户 ID，并保留原列表返回上下文。

## 4. 网络失败与本地草稿

- 用户点击保存时，浏览器先以 `project-draft-<uuid>` 暂存该次意图，再调用中央命令；成功后立即清除这份暂存。
- 会话或命令请求不可达时，正式读模型不改变，页面必须提示“仅保留本地草稿，未正式保存”。
- 本地草稿按新建/目标项目分区，保留原 `commandId` 和 `baseVersion`；重载表单可恢复。它不是正式项目、不进入列表/汇总，也不能被其他实体当作外键。
- 当前没有自动回放、后台 outbox 或自动冲突合并。用户回到表单后才能再次显式保存。

上述本地阶段草稿当前只适用于项目。客户中央命令失败时不改变正式读模型，并直接显示保存失败；客户尚未承诺离线草稿或自动重放。

## 5. 当前证明边界

当前中央项目命令由可重置的非生产后台实例证明信封、权限、幂等、乐观锁、读回和浏览器交互。#294 在相同的 HTTP/Repository 边界补充核心身份迁移命令：`POST /api/migrations/core/preflight`、`POST /api/migrations/core/dry-run`、`POST /api/migrations/core/:batchId/import|confirm|rollback`，并以 `GET /api/migrations/core/snapshot` 读取中央权威快照。迁移命令要求 `core:migration:write`、稳定 `commandId`、服务端会话身份和批次状态机；后台会重算 canonical 来源哈希、校验备份证明结构与确定性 ID、按实际写入结果重新对账，并在确认时再次拒绝阻塞差异。本地适配器负责从不上传中央的 IndexedDB 备份字节重算摘要和来源，创建与恢复两端都拒绝篡改。它们只服务于显式迁移，不是客户、项目或分供方日常保存接口。迁移端同样是可重置测试实例，不能把它或 `/api/testing/core-migration/reset` 描述为生产持久化业务库或业务命令。
