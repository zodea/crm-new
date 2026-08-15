# 中央写命令契约

> 本文档是浏览器中央写命令的权威源。数据实体与迁移看 [`DATABASE.md`](./DATABASE.md)，读 DTO 看 [`READ-MODELS.md`](./READ-MODELS.md)，浏览器权威边界看 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)。

## 1. 当前落点

#293 完成第一条中央写链：正式项目的新建、编辑和表单预载。浏览器不再直接将项目表单写入本地 SQLite；页面只经 `ProjectCommandStore → ProjectCommandRepository → HTTP adapter` 调用：

- `GET /api/read/business-session`：取得当前服务端会话的 `workspaceId`、`actorId` 和 capability。
- `GET /api/read/projects/:id/form`：返回可编辑 draft、附件元数据、`version` 和服务端更新时间。
- `POST /api/commands/projects`：新建正式项目。
- `PUT /api/commands/projects/:id`：用当前 `baseVersion` 编辑正式项目。

项目导入、删除、通用离线 outbox、自动合并、完整登录/RBAC 和其他实体写命令不在当前落点。Tauri 继续使用既有本地写路径，不消费浏览器中央命令。

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
```

- 服务端重新解析会话并校验工作区、操作人和 `project:write`；客户端字段不是授权证据。
- 新建 ID 由服务端分配不透明值；页面不使用时间戳、名称或本地 `draftId` 作正式主键。
- `version`、最终更新时间和命令结果由服务端生成。
- `draft` 允许缺少业务必填项；`save` / `submit` 同时经页面和服务端校验项目名称、客户与项目经理。

## 3. 幂等、冲突与读回

- 同一会话/工作区内重放同一 `commandId` 返回第一次成功结果，不生成第二个项目，也不重复递增版本。
- 编辑命令的 `baseVersion` 与服务端当前版本不一致时返回 canonical `ProblemDTO(code='conflict')` 和 HTTP 409，禁止覆盖。
- 表单收到冲突后立即重读服务器表单，保留当前本地内容，并让用户显式选择“保留我的内容”后基于新版重试，或“改用服务器最新版”。
- 命令成功后使用返回的 ID/version 失效同项目详情缓存；列表和详情再从中央读模型取结果，不使用客户端 draft 伪造成功回显。

## 4. 网络失败与本地草稿

- 用户点击保存时，浏览器先以 `project-draft-<uuid>` 暂存该次意图，再调用中央命令；成功后立即清除这份暂存。
- 会话或命令请求不可达时，正式读模型不改变，页面必须提示“仅保留本地草稿，未正式保存”。
- 本地草稿按新建/目标项目分区，保留原 `commandId` 和 `baseVersion`；重载表单可恢复。它不是正式项目、不进入列表/汇总，也不能被其他实体当作外键。
- 当前没有自动回放、后台 outbox 或自动冲突合并。用户回到表单后才能再次显式保存。

## 5. 当前证明边界

当前中央项目命令由可重置的非生产后台实例证明信封、权限、幂等、乐观锁、读回和浏览器交互；真实业务库、客户—项目—分供方核心身份迁移、对账与回滚由 #294 承接。`/api/testing/projects/reset` 只是测试协调边界，不是业务命令。
