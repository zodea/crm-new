# P2 提交登记独立增量复核

**结论：本轮内容缺口 0，无伪 SHA、义务丢失、完成范围误提升或本地断链。** 本复核未参与所审 Root 元数据编写，仅只读检查，没有改产品、文档、测试或启动服务。

固定产品提交 `fd0a7b6b4ab58eb177eea1db86a069067be92a4a` 真实存在，父提交为 `579d9383357fffd2bd87e727dbc21b903a7cb69c`。实际变更401文件；commit-receipt 的112个不同路径 gitBlob 全部与该树匹配。正常 hook 原日志确认654文件/3866项通过、256.11秒及正常 eslint/typecheck/test，相关日志 SHA 全匹配。当前 code-hashes 与工作区仅两个登记脚本不同，其余110产品/测试不变；不把登记脚本变化误称为产品回归。

- **义务：**54项保留、无失效 caseId；新增 C1 证据只挂 WAGE-04/06/07/09/11/12/13。唯一状态提升是仅 C1 的 WAGE-04 → current-passed。WAGE-05/06/09/11/12/13 等混合义务仍 partial；WAGE-07 原有限定来源往返通过不属于本轮新提升，现文案继续明确 P3 写态独立验收。
- **覆盖：**143生产路由、199根变体、689 surfaces、1147 cases、20 domains 总数不变；surfaces/domains 内容也未变。恰16个真实 central/c1 子视图增加 obligationIds，参考证据、规则/前端/跨域/生产接受等级均未提升。库存适配只把“整合验收中”改为“本地限定验收通过”。
- **范围及入口：**P2票、状态页、验收目录与分支记录均绑定真实产品 SHA，保留 P3–P7、#412开放、#416生产关口。125业务交互图、13指南页+2实际输出页、7报告图分别计数；未推送/未部署及远端核查时间边界明确。本地 origin/main 引用比较为落后0、领先168；没有代称本次重新获取远端。
- **断链：**精确所审六份 Markdown 中883个本地目标均存在；新增证据与case关联有效。

**归档收尾（Root）：**初读发现 `file-manifest.json` 中 verification.json 指纹尚未跟随刚新增的 metadataChecks 更新。Root 已明确将在收录本复核后统一重生自排除清单并核全量 SHA；本报告不把这个尚待执行的刷新宣称已经完成。除该已识别收尾外，无新增阻断项。

## 本次输入指纹

比较为固定产品提交后的当前元数据增量；清单末次生成属于上述 Root 收尾，不包含在本轮固定输入中。

| 文件 | SHA256 |
| --- | --- |
| `scripts/module-review-obligations.mjs` | `12eda4206877a50eab7eb80eae4c2b99b2b027a51fcf3ef44084fb9c70739d1a` |
| `scripts/module-review-inventory.mjs` | `e3c734514f974a40f0e768295602d6903f411749614321a69d6434e12d94953c` |
| `docs/design/module-review-coverage.json` | `2a91c70f926cce783852b9d6703c55de342feeeb4d0610b548297c91aaa60ab1` |
| `docs/design/module-review-coverage.md` | `ab14e9f0c6e2d6af3a62264bd17140230d42a32cf469f132e923dfacbc101a4c` |
| `docs/design/evidence/issue-412-payroll-c1/verification.json` | `25b6414e1e31e33c2307c98b7ee88c401a7edd1c5a308cafba7a18f531aa4175` |
| `docs/design/evidence/issue-412-payroll-c1/commit-receipt.json` | `cf0f4f0aa20efa82ddc83012394a6d154456b76a5d1a32b26ac2fbef75136f6d` |
| `docs/design/evidence/issue-412-payroll-c1/README.md` | `6170d1bdb10942f801771ac78374dfa7cdb3fdf91461778ee9e0748fe5f9b1ef` |
| `docs/design/ui-implementation-status.md` | `80a3fa5fdb35dda58c699a5bad59a880993c3484d32f06e000a804d874ae30ee` |
| `docs/research/issue-review-2026-09-11/payroll-tickets/02-central-c1-attendance.md` | `ba15ca31609a5d3e287a9dd79cfbb13de95fc00fbd211d600e578e142be53b83` |
| `docs/research/issue-review-2026-09-11/README.md` | `5ee7eafbed2f53a5e2ba361a1f4f06dee81014bd9768261075c5b45915ec0e2c` |
| `docs/research/local-branch-integration-2026-09-10.md` | `41f4d3843699074ede7b9319084792296d25d666e4b8cc492ab3b219ad8b8ab5` |

