# 测试与开发工具适配调查

> 非权威调研，取证日期为 2026-09-24。保留候选用途、原始来源和未采纳理由，不维护当前安装状态、发布版本或实施排期。现行工具与运行方式直接见[测试入口](../testing/README.md)、[package.json](../../package.json)和[架构](../rewrite/ARCHITECTURE.md)。

## 取证范围

当时通过 GitHub REST API 完整分页取得 antfu 的 1,755 个公开收藏条目，并核对重点候选的官方资料和许可证；没有逐一审查全部项目源码。收藏归属和发行信息是当时快照，不构成作者担保或今日兼容性结论。原始详细调查及配置观察可从[固定 Git 来源](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/research)恢复。

来源：[公开收藏页](https://github.com/antfu?tab=stars)、[REST 清单入口](https://api.github.com/users/antfu/starred?per_page=100)。MSW、fast-check、Knip 未在当时公开清单中找到，只是根据本地问题补充的候选。

## 仍有独立价值的比较

| 候选及原始来源 | 调查时识别的用途 | 适配限制与判断依据 |
| --- | --- | --- |
| [Vitest 性能分析](https://v4.vitest.dev/guide/profiling-test-performance) | 区分 transform、setup、import、tests、environment 的耗时，定位组件启动或数据库准备成本 | 调查没有性能基准，不能承诺提速。原 SQLite helper 已缓存 sql.js 初始化，不能说每例都重复初始化引擎；只有测量证明准备是瓶颈时才比较基线夹具 |
| [Vitest Browser Mode](https://v4.vitest.dev/guide/browser/) | 用真实几何与键盘验证 jsdom 模拟不能证明的布局、滚动和焦点 | 调查时的 ContextHelp 用例人为设置几何；Browser Mode 不代替完整路由、后台、原生壳层及文件验收。现行浏览器配置已由测试入口承接，不按旧“待安装”重做 |
| [Vitest ESLint 插件](https://github.com/vitest-dev/eslint-plugin-vitest) | 发现错误 expect、Promise 断言处理和缺失断言 | 当时已有 antfu `test/*` 规则，候选是增量规则而非第二套插件。共享断言 helper 需能被识别；绿色结果不能证明规则能拦截缺陷 |
| [Vitest VS Code 扩展](https://github.com/vitest-dev/vscode) | 单条运行、断点、watch 等人工调试 | 收益取决于使用的编辑器；不能将较新主版本的 Trace View 等功能当作当前 Vitest 组合已可用 |
| [MSW](https://mswjs.io/docs/integrations/node)及[Vitest 请求模拟](https://v4.vitest.dev/guide/mocking/requests) | 为实际客户端 transport 提供可控的 401/403、409、网络错误与迟到响应 | 工程量 Repository 已有 fetcher 注入，WBS 已有真实 HTTP round trip；仅在消除重复或覆盖真实缺口时有增量价值。模拟不能替代服务端事务、持久化与恢复验收 |
| [fast-check](https://github.com/dubzzz/fast-check)及[重放参数](https://fast-check.dev/docs/api/interfaces/Parameters/) | 扩展量算、金额守恒、分摊顺序和归一化的组合输入 | 性质来自已定规则或独立模型，限制规模与深度，保存 seed/path，重要缩小反例转固定回归；不能以被测算法作预期值或丢弃已有手工边界 |
| [node-modules-inspector](https://github.com/antfu/node-modules-inspector) | 调查依赖实例、重复版本和安装大小 | 已安装能力看现行命令；安装体积不等于浏览器包体积，不为只读诊断增加产品依赖 |
| [jscpd](https://github.com/kucherenko/jscpd) | 找领域、服务及 helper 的复制片段 | 排除生成物、设计源码和快照，人工判定相同语义后再合并；重复率不决定不同领域应该共用实现 |
| [dpdm](https://github.com/acrazing/dpdm) | 调查显式 TypeScript 入口的循环依赖 | Nuxt 自动导入、动态组件和 Vue SFC 识别存在边界；空结果不能证明全应用无环 |
| [Taze](https://github.com/antfu-collective/taze) | 独立依赖维护中的版本报告 | 版本更新清单不证明 Nuxt、Vite、Vitest、ESLint 组合兼容，不自动解除锁定版本 |
| [ast-grep](https://github.com/ast-grep/ast-grep) | 在重构前按语法结构搜索可疑调用 | 先验证模式和 Vue 片段覆盖，再判断是否改写；文本命中不能代替运行关系 |
| [Knip](https://knip.dev/reference/plugins/nuxt) | 调查未使用文件、导出和依赖 | 需核验 Nuxt 4 app 目录、自动导入、插件及动态注册误报；来源不属于当时 antfu 收藏清单 |

上述 Vitest、MSW、fast-check 及主要维护工具当时按项目官方元数据记录为 MIT；Knip 记录为 ISC。该记录不代替选定发布版本、传递依赖许可证或实际接入验证。

## 未采纳理由

- Compodium、Histoire 与已有组件演练入口有重叠，发布和 peer 兼容性尚需证明；不因能自动发现组件就增加第二套展示平台。
- happy-dom 是另一种模拟环境，是否比 jsdom 更快且满足现有 reka-ui、axe、pointer 行为需实测，不直接全量替换。
- vite-plugin-inspect 的适用版本取决于 Nuxt 锁定的 Vite；已有 Nuxt DevTools 需先核对其能力。
- Cypress、Storybook 与现有 Playwright、组件演练入口有较大职责重叠，调查没有支持第二套完整平台的证据。
- 当时已归档的 nuxt-vitest、vite-plugin-vue-devtools、playwright-video 旧仓库不作为接入候选；公共库 API 和自定义 ESLint 规则测试工具也未体现私有 CRM 的优先收益。

本调查不授权新增依赖、换测试环境、扩大并发或关闭隔离。实施时按一个具体场景比较发现能力、维护成本和耗时，现行验证纪律只见[Git 工作流](../agents/git-workflow.md)和[CI 使用规则](../agents/ci-usage.md)。
