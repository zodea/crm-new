# 开票因子与税额工具验收

> 本页保留已完成切片的实测摘要及原验收边界；日期、数量和阶段状态属于当次记录。历史多轮图片、审查与归档流水统一由[固定 Git 原始材料](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-432)定位。当前规则以所引现行权威文档为准，保留的真实原件、源证明和产品打印不改写。

日期：2026-09-10。Issue：[#432](https://github.com/zodea/crm-new/issues/432)，承接 #414 与 #431 的 FACTOR-01～04。实施基线 `cb63ec2c`，本记录随修复提交。

## 权威与修复范围

按 [#204 最终反馈](https://github.com/zodea/crm-new/issues/204#issuecomment-5145177434) 和 `DC重构设计源码/kit/CalcScreen.jsx` 实施。实际打开本地设计应用，在 1280×720 视口检查顶部税额、左侧因子和右侧结果；点击默认示例得到 68 条组合。该工具没有直接对应的红圈页面，设计证据不外推到其他页面。

- 顶部四格即时税额计算与组合求解共用同一个金额；四格均可用鼠标和键盘复制。
- 下方桌面左侧约 330px 因子控制区、右侧结果区，包含/排除、返回数量和计算动作集中在左侧；窄屏顺序堆叠，结果表在自身区域滚动。
- 首次默认 128640、因子 640/960、不限数量、整数数量、返回 100 条，首次进入不自动求解。已有配置及明确清空的金额、返回数量和因子保持原样，兼容旧 f/m/d 字段。
- 原精确到分算法、延迟遮罩、取消和结果替换机制保持；结果标题保存该轮实际目标，避免新输入与旧结果混用。

## 失败复现与实际验证

修改前先建立公开 composable 和组件回归：首次默认不符、空配置被默认值覆盖、税额不能即时计算和四格复制共 6 项失败；旧格式兼容的 2 项仍通过。

- `tests/components/FactorSolverState.test.ts`、`tests/components/FactorTaxCalculator.test.ts` 与 `tests/finance/factor-combination.test.ts` 共 22 项通过，覆盖默认 68 个精确解、既有/旧格式/空配置、模型回写、父级金额变化、无效输入及原算法。独立预审发现超过两位小数的目标标题与实际分值可能不同；先以 1.005 复现失败，再让标题保存该轮实际求解分值，避免与税额和组合相差一分。
- `e2e/factor-solver.spec.ts` 7 项通过：筛选与数量、短任务不闪遮罩、税率边界和刷新、长金额不越界、276 条结果局部滚动、四格键盘复制和五档视口、旧配置与空值刷新。最后单独重跑四格复制与五档场景，通过后采集无通知遮挡的截图；金额补修后重跑求解场景通过，实际验证默认 68 个解只显示 1 条时正确提示上限，以及 1.005 的标题、税额与组合均为 1.00。
- 390 / 768 / 1024 / 1280 / 1440px 实际运行检查无页面横向溢出；小屏仅结果表横向滚动，桌面左右分栏。问号说明用 Enter 打开、Escape 关闭后焦点回到原按钮。
- [使用指南](../../../guides/invoice-factor.md) 与 `output/pdf/瑞航CRM_开票因子与税额计算使用说明.pdf` 同步，3 页逐页渲染检查，无文字截断或重叠。
- 类型、全量回归与独立复核以本 Issue 最终回执的固定提交范围为准。

| 视口 | 当前实现 |
| --- | --- |
| 390px | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-432/factor-workbench-390.png) |
| 768px | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-432/factor-workbench-768.png) |
| 1024px | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-432/factor-workbench-1024.png) |
| 1280px | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-432/factor-workbench-1280.png) |
| 1440px | [截图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-432/factor-workbench-1440.png) |

本次仅覆盖本地计算工具及配置恢复，不生成正式业务记录，也不代表 #414 的其他设置/首页工作或 #416 生产能力完成。未推送、未运行 GitHub Actions。
