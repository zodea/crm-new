# HANDOFF · 瑞航 CRM 设计稿 IA 重构（向红圈看齐）

> 交接时间：2026-07-09 ｜ 对象：**DC 设计稿**（`DC重构设计源码/`，claude.ai/design 项目「瑞航CRM-NEW」）
> 定性：**这是交互设计（效果图），真功能在 Nuxt 项目落**。id 稳定"够跳转即可"、金额链 mock、不建真聚合引擎。
> 本文件＝**主索引 + 公共执行上下文**；分批任务在 `docs/handoffs/01…05-*.md`，**按序号做**（功能+顺序划分）。
>
> ⛔ 旧内容（#56 Playwright E2E 交接）已作废——E2E 停到第二趟，本文件改为 IA 重构交接。

---

## 一、当前状态

- **P1 已完成推送**：项目详情 10 Tab 子表 CRUD 闭环 + 蓝本对齐（commit `40e2637`）。
- **P2 已完成推送**：项目×分供方工作台 `ProjectSupplierScreen`（commit `e751597`）。
- **grilling 定案（R1–R6）+ 导航复核**已过，用户拍板「后续都可以开动」。本次 IA 重构**取代**旧的 P3/P4/批A-C 任务表——统一走下面 **批 A–E**。
- 未提交的设计文档改动：`CONTEXT.md`（识别中心/清单拆表词条已改）——⚠️ **该文件会话开始时已被他人改过，`git add` 会混提，先别提交它**（或只提交你自己那几行）。`.claude/launch.json` 是他人改动、勿动。本交接（`HANDOFF.md` + `docs/handoffs/`）已单独 docs 提交。

## 二、锁定的设计（唯一权威＝下列产物，勿在 handoff 里复制正文）

| 内容 | 位置 |
|---|---|
| **grilling 六轮决议 + 效果图/数据结构图/流程图** | https://claude.ai/code/artifact/3c2f49b4-2b5d-4e0a-9046-45216267071a |
| **导航栏 当前 vs 新版（10 组·约30实体·锁定版）** | https://claude.ai/code/artifact/888ed161-6349-4ee3-94b3-f7c0c3b2748e |
| IA 方向总览（红圈四铁律 / 底座三件） | https://claude.ai/code/artifact/10c3dc96-0c7d-4db9-9d37-f7a69cc1a869 |
| 术语（识别中心/清单拆表已改写） | `CONTEXT.md` |
| 红圈参照（菜单/各域走查，gitignored） | `红圈系统/00-全局框架.md` + `03…11-*.md` |
| 页面蓝本 | `docs/rewrite/pages/*.md` |
| DC 路由/接入机制、DS 组件、DesignSync | `docs/dc-rebuild/IMPLEMENTATION.md` |
| 交互实现方法论（6 步、原语优先、验证闭环） | `docs/dc-rebuild/INTERACTION-PLAYBOOK.md` |
| 视觉规范 | `docs/dc-rebuild/STYLE-GUIDE.md` + ADR 0007 |

### 六条已定决议（grilling）
1. **轻实体仓**：稳定 id 够跳转；金额链 mock；蓝链/反向Tab/项目详情Tab 共读 `kit/data.js`；真聚合留 Nuxt。
2. **实体彻底独立 · 列表共用一套模板 · 详情共用外壳、不适用段隐藏**。
3. **审批流隐藏**（单人+暂无联网）：详情只留审批状态 chip（「变更单」四档：草稿/已上报/已打回/已签证；付款类 审批中/已审批/已付）。真审批链留 V2。
4. **识别中心拆回各域**：发票识别→资金、送货单识别→乙供材、清单拆表→主合同、OCR设置→设置。菜单组退役（CONTEXT 已改）。
5. **实体清单**：**10 组、约 30 实体**（见导航 Artifact）。**目标成本并入项目信息**（最终调整）。
6. **★ 全数据可导入/导出**：建进列表模板，全列表通用；沿用 **ADR 0004（导出）/ 0005（导入）**。

### 底座四件（批 A 先造，后续白嫖）
- **EntityListScreen**（列表工厂）：一份 meta（列 + 蓝链列 + 筛选 + 底部业务汇总行 + 业务态默认视图 + 左侧分类 + 导入/导出 + 新增编辑软删撤回）→ 一整页红圈式列表。复用 P1 `ProjectDetailScreen.jsx` 里的 `SubTable` CRUD 闭环范式。
- **EntityLink(type, id)**（蓝链原语，进 `kit/KitAtoms.jsx`）：全站实体名一律蓝色可点，跳转映射**只写一处**。
- **DetailShell**（详情外壳）：摘要条（四级对账）+ Tab 壳 + 右侧文书/文件栏；**审批段不挂**。
- **ContractDetailScreen**（合同详情，1 个，`kind`＝施工/分包/材采 显隐字段与 Tab）。

### "好用不堆砌"验收线（每页达标才算完、才下一页）
1. 红圈式呈现：四级金额链列 + 底部业务汇总行 + 默认业务态视图 + 左侧分类（如有）
2. 蓝链真跳：所有实体名可点、落到对应详情（非死链）
3. 交互闭环：增/删(软删撤回)/改/搜/筛/**导入/导出** 都真响应
4. 详情（如有）：摘要四级对账 + 关联单据 Tab + 文书/文件 + 状态 chip（无审批流）
5. 本地 Chrome 走 happy path、esbuild 过、console 零报错
6. 达标才下一页——不铺半成品占位

## 三、公共执行流程（每批都照做）

**改** `DC重构设计源码/`（`app.dc.html` 外壳 + `kit/*.jsx`）→ **验** → **提交** → **推送**。

1. **esbuild 语法**：`cd DC重构设计源码 && npx esbuild kit/<改过>.jsx --loader:.jsx=jsx --outdir=<临时>`，全过。
2. **本地实测**：`preview_start "dc-design"`（`serve 8823`，已在 `.claude/launch.json`）→ preview_eval 跳 `http://localhost:8823/app.dc.html` → `window.DC.navigate(route, params)` → **DOM eval / snapshot 验交互**（⚠️ `preview_screenshot` 会超时——外部 `unpkg.com/lucide` CDN 挂起 load；用 eval/snapshot 取证）。console 零报错。
3. **提交**：`git add` **只加本批文件**（列路径，禁 `-A`；**不加** `.claude/launch.json` / `HANDOFF.md`）。conventional commit + 中文，结尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。预提交钩子＝lint-staged（eslint 已忽略 `DC重构设计源码/`）+ `pnpm typecheck` + `pnpm test`。
4. **推送线上**：`DesignSync finalize_plan`（projectId `e54e3b41-1b18-485c-924f-e277deedc21e`，`localDir=DC重构设计源码`，`deletes:[]`）→ `write_files`（`localPath` 直读）。推后提醒用户 **硬刷新** design 编辑器（预览有缓存）。

### ⚠️ 本会话踩过的坑
- **git 操作前先 `preview_stop`**：`serve` 占用中文路径文件，`git checkout`/`stash` 会 `Permission denied`。
- **提交前把本批文件全 stage**：lint-staged 备份"未暂存改动"进 stash，含中文路径大文件时还原偶发 git error；全 stage 后备份只剩 `launch.json`（ASCII），稳。
- eslint 忽略 `DC重构设计源码/` 已配（`eslint.config.mjs`，在 commit `40e2637`）。

### 现有可复用原语（`kit/`，隐藏 x-import 预载）
- `KitUI.jsx`：`toast/confirm/formModal/modal/undoToast(msg,onUndo,ms=5000)/exportModal/importModal/folderPicker`。
- `KitTable.jsx`：`window.KitTable`，列 `{key,label,width,align,mono,money,color,render(v,row)}` + `sum{label,value}` + `toolbar/onRowClick/pageSize/minRows/tableMinWidth`。
- `KitAtoms.jsx`：`SelectFilter/SegTab/SearchInput/SectionHeader/Metric/MetricGrid/TreeNav`（**批 A 往这里加 `EntityLink`**）。
- 共享 store（反馈轮9）：`window.APP`/`INV`/`SCHEDULE`——批 A 起新增实体 store 或统一扩展。
- `app.dc.html` 路由机制：`PAGE` + `renderVals.isXxx` + `sc-if` x-import + `_tabKey` + `_tabTitle` + `_isActive` + `navigate`；页签上限 15+toast；`window.DC.navigate/closeActiveTab`（**返回=关页签用后者**）。

## 四、批次顺序（按序做，一批一份 handoff）

| 序 | 批 | 功能 | Handoff |
|---|---|---|---|
| 1 | **批 A** | 底座4件 + 10组新菜单 + 合同主线（施工/分包/材采 + 清单拆表入主合同）+ 返回关页签 + 导入导出 | [01-批A](docs/handoffs/01-批A-底座与合同主线.md) |
| 2 | **批 B** | 资金域（付款申请/付款管理/收款/开票/往来/支付/报销）+ 全站蓝链（发票） | [02-批B](docs/handoffs/02-批B-资金域与全站蓝链.md) |
| 3 | **批 C** | 目标成本 + 主合同生命周期（变洽签/报量/验收/结算/甲方罚扣）+ 分包单据 | [03-批C](docs/handoffs/03-批C-目标成本与主合同生命周期.md) |
| 4 | **批 D** | 材料域（乙供材 5 + 甲供材整域）+ 送货单归档库（原 P3） | [04-批D](docs/handoffs/04-批D-材料域与送货单归档.md) |
| 5 | **批 E** | 项目其他合同（房租）+ 客户 + 分供方反向Tab + 全站走查 | [05-批E](docs/handoffs/05-批E-其他合同与收尾.md) |

> 批 A 是地基，先做且做扎实（底座质量决定后面 4 批成色）。批 B–E 内部各页可并行，**跨批按序**。

## 五、建议技能（suggested skills）

- **ultracode / Workflow**：每批扇出——每个实体列表＝一份 meta，多列表页可并行由子代理生成后统一接线验证。批 A 底座建好后，B–E 尤其适合。
- **注意**：本活是 **DC 设计稿（`.jsx` 全局 React），不是 Nuxt/Vue**——antfu 的 vue skill 只在真移植到 `app/` 时才用。
- **web-design-guidelines**：批 E 全站走查。
- **domain-modeling**：新实体冒出未定义术语就地写进 `CONTEXT.md`（glossary only）。
- 开工前 `gh issue list --state open` 核当下（多会话并行）。

## 六、收尾文档纪律（每批完成时）

- `docs/dc-rebuild/README.md` 追加该批记录；被推翻的旧蓝本就地打墓碑 + 指向新权威源（material-delivery.md 随批 D 回写）；新术语进 `CONTEXT.md`。
