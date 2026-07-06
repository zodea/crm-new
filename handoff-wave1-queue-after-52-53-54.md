# Handoff · #52/#53/#54 完成后队列 —— 下一批:#56 / #77(+#75/#78 可并行)

> 交接给新会话。上一站:本批三个 issue 全部关闭——#52「软删除+操作日志」(提交 `5ce7810`)、#53「Seed 演示数据」(`b8b42ed`)、#54「页签状态机」(对照盘点后给证据关闭,未新写代码)。验收证据见各 issue 关闭评论。本文档只记队列状态、冲突警告与坑。

## 图状态(2026-07-06 `gh` 实查,非记忆)

- **已关闭(新增)**:#52、#53、#54、**#50(并行会话完成)**
- **#58 大瓶颈剩余卡点**:仅剩 **#56、#77**(#52/#53/#50 已清,#54 完成已解锁 #56)
- **就绪可领取**:**#56**(页签栏 UI+keep-alive+右键菜单+Playwright 基建,刚解锁)、**#77**、#75、#78
- 接手前仍要 `gh issue view <n> --json state,body` 复核——多条并行线在推进,图是动态的。

## 下一批接手要点

### #56 页签栏 UI(2b)
- 纯逻辑与 store 已全齐(见 #54 关闭评论的落点表):`lib/tabs/tab-machine.ts`(16 vitest)+ `stores/tabs.ts` + `AppTabBar.vue`(开/复用/中键关/右键四关菜单已有!)。**先对照 #56 验收标准盘点存量**,大概率主要缺 Playwright 基建与打磨项;页签收尾杂项在 #82 挂账,别重复做。
- 上限阻断 toast/弹回已接 `kit.warning`,端到端实测挂在 #82。

### #77(KitUI 原语)与 #75/#78
- 属 #74 PRD 拆片,正文见 GitHub;与数据层无冲突,可与 #56 并行开。

## 本次新增可复用资产(后续所有页面 story 都会用)

- **软删除底座 `app/lib/db/soft-delete.ts`**(#52,34 条 vitest):
  - 读:`selectVisibleSql(table, tail)` 唯一祝福读路径(祖先过滤,ADR 0003 只标父级);JOIN 场景用裸 `hiddenCtes(table)` + `visibleCond(table, alias)`。**任何新查询禁止裸 `SELECT * FROM 业务表`**。
  - 写:`logCreate(db, table, id)`(INSERT 后)、`withUpdateLog(db, table, id, mutate)`(编辑三明治,自带存在性检查防幽灵日志,返回 null = 记录不存在/已删,**调用方要据此提示失败**)、`createSoftDeleteActions(db, table, reload)` 一行展开 remove/restore/undo。
  - `db` 门面从 `~/lib/db/client` 导入;新表必须登记 `PARENT_REFS`(漂移有测试拦截);`DEPRECATED_TABLES` 拒绝废案表(ticket_registrations,ADR-0001)。
  - remove/update 返回日志 id/null,是给 undoToast/失败提示的句柄——**UI 接线还没做**,归 KitUI/页面 story。
- **Seed 演示数据**(#53):12 项目/5 分供方/8 发票(全状态谱系)/6 班组/8 工人/5 挂靠,`app/lib/db/seed/*.json`。加新演示数据 = 直接扩 JSON(glob 自动拾取、幂等既有),**不用改 seed.ts**;完整性测试模式见 `tests/db/seed-data.test.ts`。
- 项目状态词表 = `['筹备中','施工中','停工','已竣工','已结算']`(project/index.vue STATUS_OPTIONS);设计稿「在建/收尾/完工」按此映射,别把设计稿状态词直灌库。

## 坑(增量,其余沿用上一份 handoff)

- **typecheck 修复会话(改 `connection.ts`/`export-seed.ts` 等)截至本次结束仍未落地**(基线 24 条存量红)。动 lib/db 前先 `git log --oneline -5` 复核;`seed.ts` 本批实测可以不碰(JSON 管道齐全)。新代码自证:`npx nuxt typecheck 2>&1 | grep <本次文件名>` 无输出。
- **DATABASE.md §8 与 #52 实现的同步(墓碑+口径)由用户在独立会话处理中**(后台任务 task_4afed5d8)——别重复改 `docs/rewrite/DATABASE.md`,它同时还有用户的未提交编辑。
- V1 刻意取舍(勿当 bug 修,已在 #52 关闭评论挂账):恢复「祖先仍删」子记录数据层成功但列表不可见;写库+落日志无事务;跨 store 内存缓存不随父删自动刷新;project_suppliers 无库级唯一索引。
- 项目列表页存量 vxe 报错 `show-overflow=true 不支持`(应为字符串 `"title"`,上份 handoff 坑清单已记)——存量页面写法,接 #58/列表页时顺手纠。
- 发票页统计卡把计数显示成「8.00」(Metric 金额格式化误用)——已挂后台任务 task_682751d6。

## suggested skills

- **`/implement`**——#56 先做「存量 vs 验收」盘点(同 #54 方法),缺口大概率集中在 Playwright 基建;#77/#75/#78 直接开工。
- **`/tdd`**——新纯逻辑一律测试先行,沿用 `tests/db/*`、`tests/tabs/*` 模式。

## 参照

- 上份 handoff:`handoff-wave1-queue-after-51.md`(vxe 坑、提交纪律);全图盘点:`handoff-wave1-queue-after-50.md`。
- Issue 流程:`docs/agents/issue-tracker.md`。
