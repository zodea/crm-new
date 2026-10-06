# #436 普通收款中央全链验收

> 本页保留已完成切片的实测摘要及原验收边界；日期、数量和阶段状态属于当次记录。历史多轮图片、审查与归档流水统一由[固定 Git 原始材料](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436)定位。当前规则以所引现行权威文档为准，保留的真实原件、源证明和产品打印不改写。

日期：2026-09-11。规格：[#436](https://github.com/zodea/crm-new/issues/436)，原生父票 [#413](https://github.com/zodea/crm-new/issues/413)。代码基线为本地 `105abd9798f1a95b9935a046f65ec1dc3e70dd44` 上本票的明确差异，独立提交及最终集成检查由 Issue 回执绑定 SHA。

## 实际范围与来源

普通收款的浏览器列表、详情、整页表单、命令与附件正文接入同一中央 Repository；客户、项目、施工合同与最终结算均从普通收款事实投影，不再要求先有最终结算。生命周期只包含现行草稿、保存、提交及取消未保存修改。

数据与页面规则分别链接 [READ-MODELS](../../../rewrite/READ-MODELS.md)、[COMMANDS](../../../rewrite/COMMANDS.md)、[页面契约](../../../rewrite/pages/finance-receipt.md)；不在证据副本重复字段表。构图依据现行 `R-FINANCE-FLOW-LIVE`、表单参考 `R-FORM-PRIOR` 与 Kit 原语，见[运行参考矩阵](../../runtime-reference-audit.md)。本轮不新增红圈写行为观察或用其按钮推断业务动作。

所有写入使用隔离的本地浏览器测试实例和合成数据，受控迁移从执行当前 SQLite 迁移后的内存旧库生成真实来源 DTO，再走实际 HTTP 预检、试算、导入、确认和回滚。未读取用户数据库，也不以可重置的中央实例证明生产持久化、认证、备份或 Tauri 交付。

## 失败复现与修正

- 普通收款原先保存到本地而关系详情读中央；领域命令、独立读源与四类投影现共用收款事实。缺客户草稿按自身 ID 可读，缺金额与明确零分别保留。
- 来源与关联权限在命令端重新校验；受限项目、客户、合同既不能作为新关联，也不能通过清空已有隐藏关系绕过禁写。请求完整内容参与幂等身份，重复命令与版本冲突不产生重复收款。
- 列表 Repository 原先会接收正式查询中的演示响应。真实 read DTO 反例先失败，修正后按本次查询拒绝串入的行、项目候选和汇总；显式允许的混合页按来源分别累计。
- 同 ID 的正式详情离页后再按演示来源打开，原缓存仍读取正式来源；表单重新打开也可能沿用先前的返回地址。KeepAlive 反例先失败，现按当前激活路由读取和返回，非法来源撤下金额与写入口，隐藏页不随其他页查询读取。
- 详情离页清理旧事实时原先把已知收款编号改成通用页签标题；现只用已知编号回填，重新激活仍先重读。迟到的旧响应不会覆盖新金额。
- 缺项目提交原先未把焦点落到可编辑选择控件。实际 Lookup 组件回归和浏览器验收现确认首错焦点、错误说明与已填金额保留。
- 真实 HTTP 迁移先在施工合同合法清单/月度事实字段上被拒。补齐施工合同专属字段校验后通过，并继续拒绝混入收款字段。完整历史“已作废”98.00 元原先误入有效累计，使 12.35 变为 110.35；真实旧库迁移反例修正后保留历史状态且累计仍为 12.35。
- 附件覆盖元数据与正文原子保存、所有权、大小/编码/摘要校验、预览取消及迟到响应、下载、软删除和恢复；不存在正文的旧路径不伪装成可下载文件。最后视觉检查将附件操作按钮迁入 Kit 原语。

## 验证记录

最新定向运行 20 文件 123 项通过：收款领域与四份组件测试、客户/施工合同组件、客户收款和项目读源、施工合同 Repository、最终结算中央 Repository/读源及财务状态。另一次含旧库来源兼容的运行 15 文件 92 项通过。类型检查、专属源文件 ESLint 检查通过。两条独立审查轴分别复核原发现和补修，当前无未解决 P1/P2；最终完整提交钩子结果以 Issue 回执为准。

真实 Chromium 完整 7 条在 48.0 秒通过，包含：

| 场景 | 实际结果 |
| --- | --- |
| 新建与提交 | 实际选择项目/主客户/施工合同、填写金额、上传文件后提交；列表重新进入详情、刷新后回读同一收款和附件。 |
| 草稿与失败 | 客户未填、金额未填与明确零分别保存；网络失败保留输入，相同内容重试沿用命令身份。已确认保存后的重读失败只重读，不重复写。 |
| 四来源返回 | 客户、项目、施工合同与最终结算分别进入普通收款，返回各自列表/页签并恢复锚点焦点。 |
| 演示隔离 | 演示记录使用独立身份、项目名与金额，单独汇总且无编辑入口。 |
| 新草稿身份 | 新建空草稿保存后进入自己的编辑路由，列表重新打开仍显示未填写金额。 |
| 真实首错焦点 | 缺项目提交后实际输入获得焦点，`aria-invalid` 与错误说明关联，金额 10.25 仍保留。 |
| HTTP 完整迁移 | 全字段、可选施工合同及正文确认后进入同一命令源；中央更正不被再次确认覆盖，回滚移除该批次及附件正文，独立新单保留。 |

审查补修后的五档完整场景再次通过，23.1 秒；下列 25 张图均来自此轮并已逐张检查。新增同 ID 正式／演示来源与表单 A/B 往返的最后单项收尾复验通过，用例 15.6 秒，整轮 26 秒、退出码 0。

初轮下载测试误禁用了单文件选择接口，实际公共导出走目录选择；修正测试能力配置后真实下载回读通过。HTTP 用例首次补入的测试合同漏填既有必填内容与签约日期，补齐合成资料后通过，未放宽产品校验。新增缓存用例曾在浏览器销毁时留下未完成的测试拦截器，最终改为等待拦截器收尾；此类测试准备失败不计为业务验收通过。

## 五档界面与原件

视口为 390/768/1024/1280/1440 × 900。窄屏表格在自身区域横滚，根文档无横向溢出；字段在不同列数下保持可读，表单底部操作随页面保留。截图分别展示列表、详情上部/附件所在位置、表单上部/附件所在位置，不把局部滚动位置冒称完整长页。

| 宽度 | 列表 | 详情 | 详情附件 | 表单 | 表单附件 |
| --- | --- | --- | --- | --- | --- |
| 390 | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-list-390.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-390.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-files-390.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-390.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-files-390.png) |
| 768 | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-list-768.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-768.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-files-768.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-768.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-files-768.png) |
| 1024 | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-list-1024.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-1024.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-files-1024.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-1024.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-files-1024.png) |
| 1280 | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-list-1280.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-1280.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-files-1280.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-1280.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-files-1280.png) |
| 1440 | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-list-1440.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-1440.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-detail-files-1440.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-1440.png) | [图](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/receipt-form-files-1440.png) |

编辑入口用键盘聚焦并按 Enter，附件预览打开实际 blob iframe，Escape 关闭；真实下载后按 UTF-8 回读为“普通收款真实凭证 436”。浏览器测试禁用目录选择能力，采用既有标准下载回退，不宣称人工操作系统目录。下载文件为 [receipt-voucher.txt](./receipt-voucher.txt)，迁移实际源包为 [migration-source.json](./migration-source.json)；文件字节数及 SHA-256 见 [artifacts.json](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-436/artifacts.json)。

## 指南与保留边界

[使用指南](../../../guides/receipt-registration.md)与[Markdown 指南](../../../guides/receipt-registration.md)同步。PDF 三页逐页渲染检查，标题、表格、正文与页脚无重叠、裁切或乱码。

原始数据没有独立收款分类/类型事实，当前展示未记录；保留金和现金实现额没有完整事实，明确未知。该判断已回写[原 Issue 评论](https://github.com/zodea/crm-new/issues/436#issuecomment-5624247094)，未从方式、状态或演示样例猜测填值。完整审批、确认撤回/退款/红冲、生产持久化 #416、#413 其他财务模块与 Tauri 正式交付保持各自范围，本票未运行远端 CI。
