# #434 首页中央项目与施工进度来源验收

> 本页保留已完成切片的实测摘要及原验收边界；日期、数量和阶段状态属于当次记录。历史多轮图片、审查与归档流水统一由[固定 Git 原始材料](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434)定位。当前规则以所引现行权威文档为准，保留的真实原件、源证明和产品打印不改写。

日期：2026-09-10。范围：[实施票 #434](https://github.com/zodea/crm-new/issues/434)，归属 [#414](https://github.com/zodea/crm-new/issues/414)，排程接入边界继续由 #412 承接。

本记录只证明此次首页项目目录、来源感知只读入口和返回流程。项目、排程数据规则以[首页蓝本](../../../rewrite/pages/homepage-dashboard.md)为准；来源持久化边界沿用 ADR 0020。本次未打开或修改外部参考站，采用既有首页/DC 与公共组件契约，不提升外部参考证据等级。

## 环境与样本

- Windows 本地 Nuxt SPA 开发态、Chromium，独立测试会话。
- 正式样本通过现有整页项目表单与中央 command 新建；名称为“首页中央项目 + 视口宽度”，均为合成资料。测试前后只重置对应中央测试会话。
- 甘特及工序下钻只使用已明确开启并获授权的演示项目；不把该排程用作正式项目事实。
- 代码起点为 `cb63ec2c`；验证对应 #434 独立工作单元，其他并行模块不计入本记录。

## 复现与结果

| 场景 | 验证结果 |
| --- | --- |
| 本地项目为空，中央新增项目存在 | 首页目录正常显示；名称更正从中央回读 |
| 正式与测试项目同 ID、目录超过 100 条 | 身份分开，读取完整目录；不从旧正式库补齐 |
| 正式项目暂无中央排程读取入口 | 明确显示未接入与计划/实际未知；不构造空排程或 0% |
| 测试数据关闭、无权、项目删除、服务不可用 | 保留各自问题语义，不回落本地或第一项目 |
| 快速切换与失败重试 | 最后请求生效，失败保留此前可读项目和 URL，重试后确认目标 |
| 缓存返回后当前项目关系失配 | 中央返回 `relationship-mismatch` 后撤下旧内容及查看入口；切换到另一个失配目标时仍保留原可读项目 |
| 离开首页时项目请求未完成 | 修复前可复现新页面地址被追加旧项目参数；修复后在卸载和缓存停用时作废该请求 |
| 中央表单新建→首页→施工进度来源→首页 | 同一项目与来源贯穿，缺源页保留返回入口 |
| 演示甘特→工程量→返回原工序 | 原分组、工序与来源正确恢复；手动工序保持只读提示 |

## 验证入口

- 6 个定向文件、26 项通过：`tests/home/project-source.test.ts`、`tests/home/dashboard.test.ts`、`tests/stores/project-list.test.ts`、`tests/schedule/navigation.test.ts`、`tests/components/HomeDashboardSurface.test.ts`、`tests/components/HomeProjectSourceNavigation.test.ts`。组件导航使用与应用一致的 `KeepAlive`，包含迟到响应先失败、修复后通过的回归。
- `pnpm typecheck` 与本工作单元明确文件 ESLint 通过。全量测试及独立提交钩子由主任务统一运行。
- 浏览器入口：`e2e/issue-434-home-project-source.spec.ts`、`e2e/home-schedule.spec.ts`、`e2e/issue-189-home-dashboard.spec.ts`，最终 15 项全部通过（57.7 秒）。覆盖正式新建五视口、错误身份、缓存离页，及原甘特、局部滚动、200% 等效布局和状态恢复。
- 项目选择搜索支持键盘进入、Escape 关闭后回到触发器；所有五档正式流程断言页面不横滚。导航链接使用现有 Button 原语，并验证实际边框与文字装饰。
- [使用指南](../../../guides/home-project-progress.md)与对应 PDF 同工作单元更新，PDF 共 3 页，已逐页渲染检查。

`c68491c4` 后独立复核发现来源失配错误码误写，补充组件反例先失败再通过：当前项目重新读取失配时不再保留旧内容。该组件文件 7 项通过，包含其他目标失配时保留原项目；新增单项真实浏览器通过（23.9 秒），覆盖中央新建项目、缓存离页返回、HTTP 409 关系失配、旧入口撤下和 390px 页面滚动。定向 ESLint 通过，指南 V1.1 与 3 页 PDF 同步。

## 当前画面

每张图仅含合成测试资料。截图宽度为 390、768、1024、1293、1440px，高度为 960px；首页与只读来源页分别记录。

| 宽度 | 首页 | 只读施工进度来源 |
| --- | --- | --- |
| 390 | [首页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/home-390.png) | [来源页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/source-390.png) |
| 768 | [首页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/home-768.png) | [来源页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/source-768.png) |
| 1024 | [首页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/home-1024.png) | [来源页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/source-1024.png) |
| 1293 | [首页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/home-1293.png) | [来源页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/source-1293.png) |
| 1440 | [首页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/home-1440.png) | [来源页](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/source-1440.png) |

补充：[390px 当前项目关系失效](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-434/home-relationship-mismatch-390.png)，仅含合成项目与测试接口错误。

## 剩余边界

正式中央排程读取和写入仍未接入，不能把此次首页选择与往返闭合视为整个施工进度模块完成。既有未带中央来源的排程维护路径仍保留，生产持久化与部署继续属于后置关口。本切片没有新的业务取舍需要交给用户。
