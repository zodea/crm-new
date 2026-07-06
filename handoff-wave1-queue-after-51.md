# Handoff · #51 完成后队列 —— 下一批:#52 / #53 / #54

> 交接给新会话(可各开一个并行 `/implement`)。上一站:#51「KitTable」已实现、评审、提交(`f587b51`)并关闭,验收证据与遗留项见 issue #51 关闭评论。本文档只记队列状态、并行冲突警告与坑,issue 正文/ADR 不在此复制。

## 图状态(2026-07-06 `gh` 实查,非记忆)

- **已关闭**:#48、#49、#55(作废)、#76、**#51(本次)**
- **进行中(别处并行,勿碰)**:#50「KitAtoms」
- **就绪可领取**:**#52、#53、#54**(本批)、#75、#77、#78
- **#58 大瓶颈剩余卡点**:#52 #53 #56 #50 #77(#51 已清);#54 完成解锁 #56
- 接手任一 issue 前仍要 `gh issue view <n> --json state,body` 复核状态与 Blocked by——图是动态的,有多条并行线在推进。

## 本批三个 issue 的接手要点(正文见 GitHub,此处只记正文之外的信息)

### #52 软删除+操作日志(lib/db + store 统一封装)
- issue 正文顶部有 ⚠️ 横幅:**级联删除口径按 ADR 0003 定案**,早期「子记录级联软删除、撤回一并恢复」已作废——以横幅和 ADR 为准,别按旧文字做。
- **并行冲突警告**:另有一个后台会话正在修 `nuxt typecheck` 存量报错(约 25 处),会改 `app/lib/db/{connection,seed,export-seed}.ts` 等文件。#52 恰好要动 lib/db——**开工前先 `git log --oneline -5` 看该修复是否已落地,若未落地要么等它,要么避开同文件**,不要产生冲突提交。
- 现成基建:迁移机制 #48 已闭环(`app/lib/db/migrations.ts` + `tests/db/migrations.test.ts` + `tests/helpers/memory-db.ts`),新表/新列走增量迁移,照既有测试模式写。

### #53 Seed(设计稿 mock → SQLite 演示数据)
- `app/lib/db/seed.ts`、`export-seed.ts` 已存在,先读再扩,别另起炉灶。
- 数据源在 `DC重构设计源码/`(mock data.js);金额口径两位小数铁律见 `docs/rewrite/DATABASE.md`(只引用不复制)。
- 同样受 typecheck 修复会话的文件重叠影响(seed.ts 在其清单里),同上先核对。

### #54 页签状态机 store(纯逻辑)
- **很可能已被部分/大部实现**:仓库里已有 `app/lib/tabs/tab-machine.ts`、`tab-title.ts`、`tests/tabs/tab-machine.test.ts`、`app/stores`(页签 store)、`app/components/layout/AppTabBar.vue`(见提交 4095b45、6c6c1cd、86810dc,以及收尾 issue #82)。
- **第一步不是写代码**,而是把现有实现与 #54(乃至下游 #56)的验收标准逐条对照:缺口才补,已覆盖就直接在 issue 里给证据关闭。别重做已有的东西。

## 本次新增可复用资产

- **KitTable 全局表格**(`app/components/ui/KitTable.vue` + 纯逻辑 `app/lib/kit/table.ts`):受控分页/列头筛选(本地+remote)/money 列/插槽,demo `/dev/kit-table`。后续所有列表页(#58/#62/#69…)直接用,接口示例见 demo 页。
- `TablePager` 已支持「N 条/页」切换;`paginate/clampPage/pageCount/deriveFilterOptions` 在 `~/lib/kit/table` 可独立复用。

## 坑(新增两条,其余沿用上一份 handoff)

- **vxe-column props 必须收进 computed 缓存**:模板里内联函数调用产出新对象/闭包(formatter/filterMethod/filters)会触发 vxe 4.19 列重注册死循环——白屏、无报错、preview eval/snapshot 全超时;渲染进程卡死后连 reload 都执行不了,只能 preview_stop→preview_start 换标签页。
- vxe 4.19:`show-overflow` 要字符串值(如 `"title"`,布尔会要求缺失的 vxe-tooltip);filter-change 回调用 `field`(`property` 已弃用)。
- 沿用:提交纪律(独立单元即提交、只 add 本次文件、conventional commits 中文、尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`);勿碰用户并行编辑的 `CONTEXT.md`、`docs/dc-rebuild/*`、`docs/rewrite/*`;新增自动导入组件后重启 dev server;验证 = `npx vitest run` + 对应 `/dev/*` 页 preview_* 工具。
- `nuxt typecheck` 目前基线是红的(存量约 25 处,修复会话在跑)——新代码自证清白的办法:`npx nuxt typecheck 2>&1 | grep <本次文件名>` 应无输出。

## suggested skills

- **`/implement`**——对 #52、#53 直接开工(正文含完整验收标准);#54 先做「对照盘点」再决定补码还是关闭。
- **`/tdd`**——#52 的 store 封装、#54 的状态机缺口都是纯逻辑席位,沿用 `tests/kit/*`、`tests/tabs/*` 既有模式。
- 若 issue 旧文字与 ADR 打架(#52 的级联口径最典型),用 **`/grill-with-docs`** 以 `docs/adr/0003` 为准核实后再动手。

## 参照

- 上两份 handoff 仍有效:`handoff-migration-wave1-47.md`(对齐点)、`handoff-wave1-queue-after-50.md`(全图盘点)。
- Issue 流程:`docs/agents/issue-tracker.md`;triage 标签:`docs/agents/triage-labels.md`。
