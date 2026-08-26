# 当前技术架构

本文描述仓库当前结构和模块边界，不维护逐页面完成度。依赖版本以 `package.json` 为准，浏览器中央权威与演示隔离决策看 [ADR 0020](../adr/0020-browser-authority-and-demo-workspace-boundary.md)，界面完成度看 [`docs/design/ui-implementation-status.md`](../design/ui-implementation-status.md)，实体关系看 [`DATABASE.md`](./DATABASE.md)，页面读模型与后台 DTO 语义看 [`READ-MODELS.md`](./READ-MODELS.md)，中央写入语义看 [`COMMANDS.md`](./COMMANDS.md)，跨域入口与返回语义看 [`NAVIGATION.md`](./NAVIGATION.md)。

## 1. 运行形态

```text
Nuxt 4 SPA
├─ 浏览器当前生产目标
│  ├─ 领域 Repository → 中央 HTTP 服务
│  ├─ sql.js/IndexedDB 分为无 seed 的 production 快照与只读 demo 快照
│  ├─ 核心身份迁移经 HTTP/Repository 切换；确认后旧 production 普通读写阻断，保留不可变备份供回滚
│  ├─ Nitro /server/api/ocr 代理官方 OCR API
│  └─ Nitro /api/read/projects 提供项目列表与详情的正式/演示隔离读链，并消费已确认迁移的项目身份
└─ Tauri 2 桌面态
   ├─ tauri-plugin-sql SQLite
   ├─ tauri-plugin-fs / dialog
   └─ Nuxt 静态前端
```

- `nuxt.config.ts` 设置 `ssr: false`；当前生产目标、中央权威与桌面范围由 ADR 0020 裁定。
- OCR 凭证只存在 Nitro runtime config，不进入 public config 或前端持久化。桌面静态构建不能假定 Nitro 永远可用，最终本地自托管/云端边界遵守 ADR 0006。
- 项目列表与来源感知基础详情的 Nitro 实例已经实现默认 workspace/actor 会话、正式空来源、独立演示来源与 capability 校验；#294 的核心身份迁移会让已确认导入的项目进入正式项目读链。当前中央端仍是可重置测试实例，完整登录/RBAC 与生产持久化业务库尚未接入。
- 平台差异经 `app/lib/platform/`、`app/lib/io/` 和数据库连接层收口，页面不直接散写 Tauri/浏览器判断。

## 2. 技术栈

| 层 | 当前选择 |
| --- | --- |
| 框架 | Nuxt 4、Vue 3.5、TypeScript、Vue Router |
| 桌面 | Tauri 2 |
| 状态 | Pinia |
| 持久化 | SQLite：tauri-plugin-sql；开发 fallback：sql.js |
| 样式 | UnoCSS，运行时令牌在 `app/assets/css/tokens.css` |
| 交互 | reka-ui / shadcn-vue 结构、vue-sonner、VueUse |
| 数据网格 | vxe-table，经项目组件封装 |
| 测试 | Vitest、Vue Test Utils、Playwright |
| 包管理 | pnpm |

选型原因和不可逆约束以 [`docs/adr/`](../adr/) 为准，不在本文复制。

## 3. 源码布局

```text
app/
├─ assets/          # 运行时设计令牌和全局样式
├─ components/
│  ├─ ui/           # 跨领域原子与封装
│  ├─ shared/       # 应用级宿主、布局和共享组合件
│  └─ <domain>/     # 项目、合同、资金、物资、工程量等领域组件
├─ composables/     # 可复用响应式行为
├─ lib/
│  ├─ db/           # 连接、协调器、迁移、schema、seed、软删除
│  ├─ forms/        # 整页表单契约与共享逻辑
│  ├─ kit/          # KitUI 纯逻辑
│  ├─ nav/          # 导航树与路由归属
│  ├─ migration/    # 核心身份来源快照、映射契约与 HTTP Repository
│  └─ <domain>/     # 领域纯逻辑、适配器与读写服务
├─ pages/           # Nuxt 文件路由；页面负责组合，不承担全部领域逻辑
├─ plugins/         # 数据库、组件库等运行时接入
├─ stores/          # 跨界面领域状态及唯一写 action
├─ types/           # 跨模块共享类型
└─ workers/         # 重计算或文件处理 worker

server/             # 仅服务端可见的 OCR 代理、业务读 API、会话与 capability 边界
src-tauri/          # Tauri 壳、权限与打包
tests/              # Vitest 单元/组件测试
e2e/                # Playwright 用户旅程
DC重构设计源码/     # 当前设计运行态，不是生产源码
```

## 4. 数据与状态流

```text
项目列表、详情与表单
  AppTopbar / DataVisibilityStore
        │ includeDemo 默认关闭并按工作区偏好持久化
        ▼
  ProjectListScreen ──► ProjectListStore ──┐
  ProjectDetailScreen ─────────────────────┤ 只依赖 ProjectListRepository port
                                          ▼
  HTTP adapter ──► Nitro /api/read/projects[/:id] ──► 默认业务会话 + 可重置中央测试实例
                                                    ├─ real：正式来源，默认空且不 seed
                                                    └─ demo：独立夹具，capability 允许时只读叠加

  ProjectForm ──► ProjectCommandStore ──► ProjectCommandRepository
       │ 本地草稿只保留失败意图                  │
       └──► HTTP adapter ──► /api/commands/projects[/:id]
                                  ├─ server session/capability 重验
                                  ├─ commandId 幂等 + baseVersion 乐观锁
                                  └─ 成功后失效详情并从中央读模型读回

尚未切换的页面域
  includeDemo=false ──► production 本地快照（未迁移域的过渡投影/写入暂存；不 seed）
  includeDemo=true  ──► demo 本地快照（确定性 seed，驱动只读）
  开关变化          ──► 确认未保存内容 → 服务端授权 → 原子重载应用
                       └─ 统一清空旧 Pinia 投影、Lookup 最近选择域与连接

核心身份迁移（#294）
  设置 → 数据迁移页 ──► CoreMigrationStore ──► CoreMigrationRepository ──► /api/migrations/core/*
        │                         │                         │
        │                         │                         └─ 可重置中央测试实例：预检、dry-run、导入、确认、回滚
        │                         ▼
        └─ production 快照 ──► 不可变 IndexedDB 备份 ──► 拓扑映射/对账 ──► 用户确认
                                                                            │
                                                                            ├─ 已接管身份、合同与甲方商务单据只走中央
                                                                            └─ 回滚窗口内仅可由迁移适配器恢复备份
```

- 领域共享数据归 store；页面局部 UI 状态留在组件树；只复用行为时用 composable。
- 数据写入只有一条可追踪路径：组件事件 → store action → 领域/数据库层。
- 项目列表、来源感知详情与正式项目表单已接中央 HTTP。新增/编辑由 `project:write`、`commandId` 和 `baseVersion` 保护；项目导入与删除仍禁用。详情 origin 由后台按 `(dataOrigin,id)` 校验，URL 参数不能重标来源；演示表单路由与本地数据库写接缝都会被只读边界拦截。
- Issue #318、#320 与 #321 的材料采购、施工、分包合同浏览器链只经各自领域 Repository/Store 与中央 HTTP：列表和七分区详情按 `(dataOrigin,id,kind)` 校验，演示来源还要同时通过用户可见性开关与服务端 `demo:read`。正式表单以各自 write capability、`commandId`、`baseVersion` 和服务端关系校验保护，成功后回到同一中央详情重读；#294 受控迁移携带 canonical 施工/分包合同并在确认后进入同一中央命令源。没有稳定外键的事实保持空集合，实际竣工、分包结算与清账未知时保持 `null`。
- Issue #294 的核心身份迁移是另一条显式中央命令链：`preflight → immutable backup → dry-run → import → post-write reconciliation → confirm → rollback`。#320 与 #321 将 canonical 施工/分包合同纳入同一受控拓扑，导入顺序固定为客户、分供方、班组、项目、施工合同、分包合同、工人、项目分供方；只接受稳定旧 ID 映射，不按名称、编号或金额猜关系。本地迁移适配器从快照字节重算摘要、来源哈希和版本并在恢复前再次核对；服务端重算 canonical 来源哈希、验证证明结构并将首份证明不可替换地绑定批次，但不上传或读取浏览器整库备份。服务端在实际写入后重新核对计数、金额、数量、关系、软删除与孤儿，客户端按钮状态不能替代后台门禁。确认后浏览器保存持久迁移标记并禁止六类身份与施工/分包合同走旧 production 的普通读写，重载时必须校验标记和中央活动批次。迁移适配器可以读取不可变备份用于恢复，不能以此重新开放普通旧库查询。
- Issue #322 在施工合同、分包合同之后把 canonical 补充协议加入同一受控拓扑；父合同旧 ID 必须唯一映射到其中一类主合同。确认后两类合同详情从同一中央命令事实源消费补充协议，并按 `(dataOrigin, contractId, kind, focusId)` 校验存在性与父子归属；不存在和关系错配使用不同问题语义。
- Issue #323 将甲方变洽签与月度报量接入同一中央 owner-document Repository/HTTP/command 边界；Issue #324 在同一边界增加验收—保修，两个视图共享唯一验收 ID、主记录和追加审计链。浏览器流转命令原子保存阶段事实与视图附件；受控迁移不信任客户端状态或审计元组。
- 当前项目与施工/分包合同正式读链会消费已确认迁移的对应实体。客户、分供方、班组、工人和项目分供方的普通页面 Repository/中央接线由 #281 完成，迁移页不复制这些页面功能。
- `/api/testing/projects/reset` 仅在非生产环境接受带测试标头的确定性场景切换，用来证明 ready、empty、forbidden、demo-forbidden、unavailable 与 retry，不是业务 API。
- `server/utils/business-session.ts` 是单公司、单操作人首版的服务端身份注入边界；客户端查询不能覆盖 `workspaceId` 或 `actorId`。正式登录接入时替换该边界，不改变领域 DTO。
- 用户可编辑的实体字段和关系以 `DATABASE.md` 为契约；不要从表格列或 mock 对象反推 schema。
- 列表、详情、工作台和未来 HTTP adapter 的读语义以 `READ-MODELS.md` 为契约；Pinia 不直接拼私有 URL，本地 SQLite adapter 与 HTTP adapter 不得各造一套空值、金额或权限含义。
- 删除遵循软删除与撤回语义；具体约束见 `DATABASE.md` 和 ADR 0003。

## 5. 导航、页面与表单

- 侧栏信息架构的代码权威源是 `app/lib/nav/nav-tree.ts`；`to` 缺省表示入口尚未实现。
- 页面路由由 `app/pages/` 生成。列表、详情、表单之间的 active nav 和应用页签归属由 `app/lib/nav/`、`app/lib/tabs/` 统一处理；页签上限、可恢复 descriptor、活动页刷新和后台页暂停语义统一遵守 [`PUBLIC-SURFACES.md`](./PUBLIC-SURFACES.md)。
- 蓝色名称、编号、金额、消息目标和跨域来源返回必须遵守 [`NAVIGATION.md`](./NAVIGATION.md)；后台返回语义目标与稳定 ID，前端唯一 target registry 解析站内路径，多态单据不得用名称或编号猜 variant。
- 业务实体新增/编辑采用整页表单路由；共享字段、保存动作、脏数据拦截和持久化能力位于 `app/components/forms/`、`app/lib/forms/` 及相关 store，见 ADR 0014 / 0015。
- 行级小对象、确认和轻量选择器才使用 Dialog；不得把大型业务实体重新塞回通用 formModal。

路由数量和“是否闭环”会持续变化，不在架构文档维护静态路由清单。

## 6. UI 模块边界

- `app/components/ui/`：按钮、输入、Dialog、Sheet、Tabs、表格封装、状态和链接等稳定能力。
- `app/components/shared/`：AppShell、KitUIHost、整页表单壳等跨领域组合。
- `app/components/<domain>/`：只在某一业务语义成立的复杂组件，例如 WBS、甘特、工程量矩阵和票款分摊。
- `useKitUI()` 是 toast / confirm / formModal 的稳定入口；页面不直接创建第二套全局浮层宿主。
- 智能洞察可用性、右侧 Sheet、全局事件 inbox、toast/角标/消息抽屉扇出及单例实时通道属于应用壳公共能力；领域页只提供稳定 `metadataKey`、`subject` 和读模型 adapter，不自行建立第二套消息或洞察框架，见 [`PUBLIC-SURFACES.md`](./PUBLIC-SURFACES.md)。

视觉权威、组件层次和响应式规则见 [`docs/design/README.md`](../design/README.md) 与 [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md)。

## 7. 验证边界

- 纯函数和状态派生：单元测试。
- 组件交互、可达性与边界：组件测试。
- 路由、数据库、应用页签、整页表单和跨域旅程：Playwright E2E。
- Tauri 专属文件、数据库和权限能力不能只由浏览器 mock 证明；发布前需桌面态验收。
- UI 改动同时验证参考视口、390 / 768 / 1024 / 1280–1440px、200% 等效宽度、键盘焦点和局部滚动。
