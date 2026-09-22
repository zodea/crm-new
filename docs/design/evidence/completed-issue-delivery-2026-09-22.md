# 已完成 Issue 远端交付核验（2026-09-22）

[PR #448](https://github.com/zodea/crm-new/pull/448) 已正常合并185个提交，合并提交为 `084e1e4b97001089452e61407ed1aa6ca6d1ef4d`。此前报告中31个“本地完成、待推送”的独立 Issue 已具备远端交付条件；本记录逐项核对开放票、既有验收记录及其 Git 祖先关系，随后登记关闭。

不重做已完成实现或重跑全部历史浏览器。各票测试、真实文件与视口结论仍以链接证据所列场景为准；生产持久化、尚未完成的父模块及后续业务扩展继续由各自 Issue 承接。历史材料中的“未推送”只表示当时状态，不能用来重复领取。本次仅更新交付状态，无产品代码变化，无新增 PDF 或 GitHub Actions。

| Issue | 已完成的独立范围 | 合入的验收记录 |
| --- | --- | --- |
| [#398](https://github.com/zodea/crm-new/issues/398) | 修复十项浏览器业务回归 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/research/local-branch-integration-2026-09-10.md) |
| [#418](https://github.com/zodea/crm-new/issues/418) | 按红圈重整列表、详情和表单的层次与排版 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-418/README.md) |
| [#419](https://github.com/zodea/crm-new/issues/419) | 修正分供方列表与详情的资料状态文字和标签 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-419/README.md) |
| [#420](https://github.com/zodea/crm-new/issues/420) | 补齐分供方劳务承包范围的维护查询与回读 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-419/README.md) |
| [#421](https://github.com/zodea/crm-new/issues/421) | 补齐问号帮助并精简分供方页面的常驻说明 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-421/supplier-import-form-verification.md) |
| [#422](https://github.com/zodea/crm-new/issues/422) | 补齐材料采购合同列表金额、关系入口与筛选汇总 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-422/README.md) |
| [#423](https://github.com/zodea/crm-new/issues/423) | 接通项目 Excel 导入与中央保存回读 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-423/project-import-verification.md) |
| [#424](https://github.com/zodea/crm-new/issues/424) | 接通客户关联项目中央回读与详情往返 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-424/customer-project-verification.md) |
| [#425](https://github.com/zodea/crm-new/issues/425) | 接通正式施工合同保存后的客户回读与详情往返 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-425/customer-contract-verification.md) |
| [#426](https://github.com/zodea/crm-new/issues/426) | 修复客户收款固定样例与中央来源回读不一致 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-426/customer-receipt-verification.md) |
| [#427](https://github.com/zodea/crm-new/issues/427) | 修正项目合作工作台的汇总口径与文件匹配顺序 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-427/cooperation-rules-verification.md) |
| [#428](https://github.com/zodea/crm-new/issues/428) | 统一付款结算引用与动态成本的确认状态口径 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-428/settlement-confirmation-verification.md) |
| [#429](https://github.com/zodea/crm-new/issues/429) | 修复 OCR 设置读取失败后的误保存与重试入口 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-429/ocr-settings-recovery-verification.md) |
| [#430](https://github.com/zodea/crm-new/issues/430) | 修复迁移回滚待恢复时的误报与新迁移入口 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-430/migration-recovery-verification.md) |
| [#431](https://github.com/zodea/crm-new/issues/431) | 登记设置与付款旧验收义务并关联本轮证据 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/module-review-coverage.md) |
| [#432](https://github.com/zodea/crm-new/issues/432) | 落实开票因子工具的共用金额与已定布局 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-432/factor-workbench-verification.md) |
| [#433](https://github.com/zodea/crm-new/issues/433) | 修正工资退役格式、考勤来源与筛选往返 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-433/payroll-verification.md) |
| [#434](https://github.com/zodea/crm-new/issues/434) | 接通首页中央项目选择与来源感知排程查看 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-434/README.md) |
| [#435](https://github.com/zodea/crm-new/issues/435) | 补齐浏览器页签描述恢复与失效回退 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-435/reopen/README.md) |
| [#436](https://github.com/zodea/crm-new/issues/436) | 接通普通收款中央保存、详情与关联事实全链 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-436/README.md) |
| [#437](https://github.com/zodea/crm-new/issues/437) | 补齐发票 Excel 表头与数据行四向边框配置及回读 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-437/README.md) |
| [#438](https://github.com/zodea/crm-new/issues/438) | 接通项目合作档案中央原件预览、下载与 ZIP 回读 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-438/project-supplier-files-verification.md) |
| [#439](https://github.com/zodea/crm-new/issues/439) | 修复付款批复空值、明确零与历史来源读回语义 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-439/README.md) |
| [#440](https://github.com/zodea/crm-new/issues/440) | 修复工程量三量合计与月度导出的缺值和计量单位 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-440/README.md) |
| [#441](https://github.com/zodea/crm-new/issues/441) | [DL01] 接通送货原件、逻辑归档与修订中央链 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-441/README.md) |
| [#442](https://github.com/zodea/crm-new/issues/442) | 接通工程量区域、模板与完成事实中央链 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-442/README.md) |
| [#443](https://github.com/zodea/crm-new/issues/443) | 接通标准工序库中央版本维护与回读 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-443/README.md) |
| [#444](https://github.com/zodea/crm-new/issues/444) | 接通中央 WBS 建组、计划调整与阶段来源往返 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-444/README.md) |
| [#445](https://github.com/zodea/crm-new/issues/445) | 闭合内部暂估绑定施工合同的中央差异确认流程 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-445/README.md) |
| [#446](https://github.com/zodea/crm-new/issues/446) | 接通分供方证照原件、资料状态与人工核验中央链 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-446/README.md) |
| [#447](https://github.com/zodea/crm-new/issues/447) | 接通证照 OCR 人工核对与主档回填中央链 | [验收记录](https://github.com/zodea/crm-new/blob/084e1e4b97001089452e61407ed1aa6ca6d1ef4d/docs/design/evidence/issue-447/README.md) |

31项：#398、#418–#447。#402–#415 中仍有未实现范围的母票不会随这批关闭；#416 的架构决定及22张实施子票另由 PR #480 交付。工资新的补正由 PR #476、#481、#482 及各后续独立 PR 登记。
