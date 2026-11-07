# 发票与税额工具

[返回测试模块索引](../README.md)

清单含义、登记边界与维护规则见[测试入口](../README.md#维护与核对)。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/invoice/central-original-binding.test.ts](../../../tests/invoice/central-original-binding.test.ts) | 单元／状态 | 原件字节与权限核对 |
| [tests/invoice/central-upload-file-authority-race.test.ts](../../../tests/invoice/central-upload-file-authority-race.test.ts) | 单元／合成传输 | 原件读取和末次授权等待时来源失效、正常上传与原编号；不访问真实服务 |
| [tests/invoice/central-pending-discovery.test.ts](../../../tests/invoice/central-pending-discovery.test.ts) | 单元／状态 | 原编号发现与身份隔离 |
| [tests/invoice/central-http-revision-safety.test.ts](../../../tests/invoice/central-http-revision-safety.test.ts) | 单元／合成传输 | 来源修订安全整数、列表／详情／预检及普通和打印原编号恢复；不访问真实服务 |
| [tests/invoice/central-workspace-read-interleaving.test.ts](../../../tests/invoice/central-workspace-read-interleaving.test.ts) | 单元／合成传输 | 已开始提交或打印与旧列表交错、恢复和后继读取代次保护；不访问真实服务 |
| [tests/invoice/central-workspace-read-consistency.test.ts](../../../tests/invoice/central-workspace-read-consistency.test.ts) | 单元／合成传输 | 分页能力与来源、同版本完整回读、打印整批及原编号；不复算不透明范围指纹 |
| [tests/invoice/central-workspace-real-scope.test.ts](../../../tests/invoice/central-workspace-real-scope.test.ts) | 隔离内存 SQLite／真实服务 | 101 张合成票经真实服务和 HTTP 适配器分页，核对真实分页范围与来源；不连接真实服务或磁盘库 |
| [tests/invoice/central-workspace-observed-authority.test.ts](../../../tests/invoice/central-workspace-observed-authority.test.ts) | 单元／合成传输 | 已观察会话核验失败及旧 401/403 的遮蔽、重验代次与原编号保护；不访问真实服务 |
| [tests/invoice/central-session-read-authority.test.ts](../../../tests/invoice/central-session-read-authority.test.ts) | 单元／合成传输 | 普通及打印会话失读权或能力集合变化时保留原编号，并在权限恢复后核对原号；不访问真实服务 |
| [tests/invoice/central-recognition.test.ts](../../../tests/invoice/central-recognition.test.ts) | 单元／状态 | 识别区域不进入写命令 |
| [tests/invoice/central-workspace-recognition.test.ts](../../../tests/invoice/central-workspace-recognition.test.ts) | 单元／状态 | 识别后的身份权限核对 |
| [tests/stores/invoice-manual-startup.test.ts](../../../tests/stores/invoice-manual-startup.test.ts) | 单元／状态 | 手工原编号刷新与身份隔离 |
| [tests/invoice/central-migration-bootstrap.test.ts](../../../tests/invoice/central-migration-bootstrap.test.ts) | 单元／服务／状态 | 迁入目录的身份、权限与来源版本 |
| [tests/invoice/central-migration-pending.test.ts](../../../tests/invoice/central-migration-pending.test.ts) | 单元／状态 | 迁入原编号发现、身份隔离及损坏存储阻断 |
| [tests/invoice/correction-contract.test.ts](../../../tests/invoice/correction-contract.test.ts) | 单元／服务／状态 | 更正差异、未知和真实零 |
| [tests/invoice/correction-http.test.ts](../../../tests/invoice/correction-http.test.ts) | 单元／服务／状态 | 更正读取与回执身份、权限、版本 |
| [tests/invoice/correction-session.test.ts](../../../tests/invoice/correction-session.test.ts) | 单元／服务／状态 | 更正未知结果及回读失败保留原编号 |
| [tests/production/invoice-migration-catalog-client.test.ts](../../../tests/production/invoice-migration-catalog-client.test.ts) | 单元／客户端 | 目录来源、版本及身份权限 |
| [tests/production/invoice-migration-catalog-integration.test.ts](../../../tests/production/invoice-migration-catalog-integration.test.ts) | 隔离 SQLite／服务 | 真实项目目录与客户端核验 |
| [tests/production/invoice-access.test.ts](../../../tests/production/invoice-access.test.ts) | 路由边界 | 正式发票与更正 API 方法及范围 |
| [tests/production/invoice-owner.test.ts](../../../tests/production/invoice-owner.test.ts) | 隔离 SQLite／服务 | 发票原件、核对、归档、回执及冷读取 |
| [tests/production/invoice-contracts.test.ts](../../../tests/production/invoice-contracts.test.ts) | 隔离 SQLite／服务 | 其他支出合同来源核验 |
| [tests/production/invoice-contract-buyer-integration.test.ts](../../../tests/production/invoice-contract-buyer-integration.test.ts) | 隔离 SQLite／真实合同 owner | 四类项目合同主体、版本及权限 |
| [tests/production/invoice-company-upgrade.test.ts](../../../tests/production/invoice-company-upgrade.test.ts) | 隔离 SQLite／升级 | 公司归属与合同升级保留旧事实 |
| [tests/production/invoice-company-owner-integration.test.ts](../../../tests/production/invoice-company-owner-integration.test.ts) | 隔离 SQLite／真实 owner | 公司合同、双方主体、归档及备份冷恢复 |
| [tests/production/invoice-company-migration-proof.test.ts](../../../tests/production/invoice-company-migration-proof.test.ts) | 隔离 SQLite／真实 owner | 同源公司合同和逐票主体映射 |
| [tests/production/invoice-legacy-archive-contract.test.ts](../../../tests/production/invoice-legacy-archive-contract.test.ts) | 隔离 SQLite／真实 owner | 旧项目票归档时核对实际合同、双方主体与历史回执 |
| [tests/production/invoice-manual-company-guards.test.ts](../../../tests/production/invoice-manual-company-guards.test.ts) | 隔离 SQLite／服务 | 手工公司票身份、税号、来源及原编号 |
| [tests/production/invoice-correction-eligibility.test.ts](../../../tests/production/invoice-correction-eligibility.test.ts) | 隔离 SQLite／服务 | 更正资格、付款打印阻断、提交与冷恢复 |
| [tests/production/invoice-correction-schema.test.ts](../../../tests/production/invoice-correction-schema.test.ts) | 隔离 SQLite／结构 | 更正版本、回执、附件及回滚 |
| [tests/production/invoice-migration-backup.test.ts](../../../tests/production/invoice-migration-backup.test.ts) | 隔离 SQLite／备份 | 迁入证据、原件与原回执冷恢复 |
| [tests/production/invoice-migration-catalog.test.ts](../../../tests/production/invoice-migration-catalog.test.ts) | 隔离 SQLite／服务 | 迁入目标目录编排和来源缺口 |
| [tests/production/invoice-migration-correction-number.test.ts](../../../tests/production/invoice-migration-correction-number.test.ts) | 隔离 SQLite／服务 | 迁入与普通发票命令族各自恢复 |
| [tests/production/invoice-migration-preview.test.ts](../../../tests/production/invoice-migration-preview.test.ts) | 单元／客户端 | 预检来源与权限变化 |
| [tests/production/invoice-migration-session.test.ts](../../../tests/production/invoice-migration-session.test.ts) | 单元／客户端 | 旧库摘要不符时保留原编号 |
| [tests/production/invoice-migration-publish.test.ts](../../../tests/production/invoice-migration-publish.test.ts) | 隔离 SQLite／服务 | 完整旧库原子发布、原证据及原号恢复 |
| [tests/production/invoice-migration-source.test.ts](../../../tests/production/invoice-migration-source.test.ts) | 合成旧库／预检 | 旧来源和公司合同引用保护 |
| [tests/server/invoice-migration-catalog-route.test.ts](../../../tests/server/invoice-migration-catalog-route.test.ts) | 路由／服务 | 发票迁入目录请求与鉴权 |
| [tests/tabs/invoice-migration-startup.test.ts](../../../tests/tabs/invoice-migration-startup.test.ts) | 单元／状态 | 迁入未决命令的启动恢复 |
| [tests/composables/useInvoiceRegionTarget.test.ts](../../../tests/composables/useInvoiceRegionTarget.test.ts) | 单元／服务／状态 | 原图强调目标：宽屏失焦撤框、悬停临时覆盖；窄屏切到原件面板恢复最近一次定位（含先换面板后失焦），切回后按新焦点更新，reset 不恢复旧定位 |
| [tests/db/invoice-ledger.test.ts](../../../tests/db/invoice-ledger.test.ts) | 单元／服务／状态 | checkReviewed:归档前置——未校对一律拒绝(DATABASE.md §2.4「核对完成是归档唯一前置」) |
| [tests/finance/factor-combination.test.ts](../../../tests/finance/factor-combination.test.ts) | 单元／服务／状态 | solveFactorCombinations：精确整数组合 |
| [tests/invoice/batch-pass.test.ts](../../../tests/invoice/batch-pass.test.ts) | 单元／服务／状态 | isAllGreen:全绿判定(建议通过标记与批量通过入围条件) |
| [tests/invoice/excel.test.ts](../../../tests/invoice/excel.test.ts) | 单元／服务／状态 | 发票台账 Excel 导出 |
| [tests/invoice/ledger-nodes.test.ts](../../../tests/invoice/ledger-nodes.test.ts) | 单元／服务／状态 | 台账树键与 query 预筛（specs §07：预筛不进页签身份） |
| [tests/invoice/print-layout.test.ts](../../../tests/invoice/print-layout.test.ts) | 单元／服务／状态 | 发票打印排版与打印资格：无原件、识别、确认、重复、金额逐项拒绝原因 |
| [tests/invoice/pdf-preview-ownership.test.ts](../../../tests/invoice/pdf-preview-ownership.test.ts) | 单元／合成替身 | PDF 页图所有权与异常回收，销毁失败由 pdf.js、canvas 和 URL 替身注入 |
| [tests/invoice/recognition-changes.test.ts](../../../tests/invoice/recognition-changes.test.ts) | 单元／服务／状态 | 重新识别前后的字段差异：人工值被覆盖、清空、补出均列出，长票号按文本比较；草稿字段标记与保存确认正文 |
| [tests/invoice/recognition-regions.test.ts](../../../tests/invoice/recognition-regions.test.ts) | 单元／服务／状态 | 识别字段 → OCR 版面块区域：归一化、金额数字边界、标签消歧、不造框条件、180° 翻转与多页；旋转/缩放坐标换算；变动字段按块合并与“原图未定位”清单；首次识别点字段定位只框当前字段 |
| [tests/recognize/local-document.test.ts](../../../tests/recognize/local-document.test.ts) | 单元／服务／状态 | 本机 OCR 合成结果的文本与真实多边形：源帧核验、越界/歧义拒绝、混合 PDF 页码与缺口 |
| [tests/invoice/recognize.test.ts](../../../tests/invoice/recognize.test.ts) | 单元／服务／状态 | confidenceTier:置信度分档(边框色/角标/✓确认 依据) |
| [tests/invoice/status.test.ts](../../../tests/invoice/status.test.ts) | 单元／服务／状态 | invoiceDocStatus:单一权威的状态优先级 |
| [tests/recognize/invoice-engine.test.ts](../../../tests/recognize/invoice-engine.test.ts) | 单元／服务／状态 | recognizeInvoice；带版面块坐标时给出字段块级区域，无坐标为空 |
| [tests/recognize/invoice-parse.test.ts](../../../tests/recognize/invoice-parse.test.ts) | 单元／服务／状态 | 发票字段、价税、重复字及候选明细的零值/未知值；不以部分明细伪造合计或将整票金额分配给猜测的单行 |
| [tests/stores/invoice-archive.test.ts](../../../tests/stores/invoice-archive.test.ts) | 单元／服务／状态 | invoice store 归档来源留痕 |
| [tests/stores/invoice-preferences.test.ts](../../../tests/stores/invoice-preferences.test.ts) | 单元／服务／状态 | invoice store 导出样式偏好 |
| [tests/stores/invoice-printing.test.ts](../../../tests/stores/invoice-printing.test.ts) | 单元／服务／状态 | invoice store 打印计数 |
| [tests/stores/invoice-recognition.test.ts](../../../tests/stores/invoice-recognition.test.ts) | 单元／服务／状态 | invoice store 真实识别管线；重新识别只返回草稿不写库、失败不产生草稿、守卫保持；保存草稿后归档审计保留首次识别与完整修订链路；识别区域随原文件留在会话中（不入库不进日志，撤回窗口结束、刷新即失效），保存草稿后改用新区域 |

## 组件（jsdom）

本机 OCR 几何的浏览器解码验证见 [InvoiceLocalGeometry.test.ts](../../../tests/browser/InvoiceLocalGeometry.test.ts)：合成图片、EXIF 方向和旋转 PDF 采用模拟 OCR 结果，真实 OCR 模型尚未验收。

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/CentralInvoiceEntry.test.ts](../../../tests/components/CentralInvoiceEntry.test.ts) | 组件（jsdom） | 中央目录缺口和权限 |
| [tests/components/CentralInvoiceBatchUpload.test.ts](../../../tests/components/CentralInvoiceBatchUpload.test.ts) | 组件（jsdom）／合成来源 | 批量逐项结果、来源失效时停止及页面提交守卫 |
| [tests/components/InvoiceExportTableAmounts.test.ts](../../../tests/components/InvoiceExportTableAmounts.test.ts) | 组件（jsdom） | 旧及中央台账共用预览区分未知与真实零 |
| [tests/components/CentralInvoiceLedgerScreen.test.ts](../../../tests/components/CentralInvoiceLedgerScreen.test.ts) | 组件（jsdom） | 台账导出及来源版本 |
| [tests/components/CentralInvoicePrintAuthorityRace.test.ts](../../../tests/components/CentralInvoicePrintAuthorityRace.test.ts) | 组件（jsdom）／合成来源 | 打印确认授权期间切源、卸载及失效恢复不发送旧登记；已发送后来源变化、原编号与存储缺口 |
| [tests/components/CentralInvoiceLoadInterleaving.test.ts](../../../tests/components/CentralInvoiceLoadInterleaving.test.ts) | 组件（jsdom）／合成传输 | 工作台与台账旧载入成功或网络失败、新读取；旧权限拒绝时遮蔽、提示及重验 |
| [tests/components/CentralInvoiceLedgerSnapshot.test.ts](../../../tests/components/CentralInvoiceLedgerSnapshot.test.ts) | 组件（jsdom）／合成来源 | 跨页导出来源变化、新匹配、目录核验竞态、权限失效与零和未知 |
| [tests/components/CentralInvoiceLedgerView.test.ts](../../../tests/components/CentralInvoiceLedgerView.test.ts) | 组件（jsdom） | 台账来源与筛选 |
| [tests/components/CentralInvoiceManualCreate.test.ts](../../../tests/components/CentralInvoiceManualCreate.test.ts) | 组件（jsdom） | 手工草稿、输入保护与原编号 |
| [tests/components/CentralInvoiceManualEntry.test.ts](../../../tests/components/CentralInvoiceManualEntry.test.ts) | 组件（jsdom） | 失权隐藏及身份隔离 |
| [tests/components/CentralInvoicePendingRecovery.test.ts](../../../tests/components/CentralInvoicePendingRecovery.test.ts) | 组件（jsdom） | 待核对提交与更正分流 |
| [tests/components/CentralInvoiceQueue.test.ts](../../../tests/components/CentralInvoiceQueue.test.ts) | 组件（jsdom） | 队列金额与上传 |
| [tests/components/CentralInvoiceQueueSearch.test.ts](../../../tests/components/CentralInvoiceQueueSearch.test.ts) | 组件（jsdom） | 队列已保存字段搜索、选中与草稿保留、来源变化清词 |
| [tests/components/CentralInvoiceQueueStatusFilter.test.ts](../../../tests/components/CentralInvoiceQueueStatusFilter.test.ts) | 组件（jsdom） | 队列状态多选与搜索组合、识别进行中区分、草稿保护及来源失效清理 |
| [tests/components/CentralInvoiceRerecognition.test.ts](../../../tests/components/CentralInvoiceRerecognition.test.ts) | 组件（jsdom） | 未保存输入和重识别 |
| [tests/components/CentralInvoiceRerecognitionConsentRace.test.ts](../../../tests/components/CentralInvoiceRerecognitionConsentRace.test.ts) | 组件（jsdom） | 重识别草稿的来源绑定、提交守卫、迟到回包和原编号恢复；切票或放弃确认期间来源重读、切换及表单变化保留草稿；合成原件与写入 sink |
| [tests/components/CentralInvoiceEditAuthorityRace.test.ts](../../../tests/components/CentralInvoiceEditAuthorityRace.test.ts) | 组件（jsdom） | 普通保存的授权等待、同源重读、存储缺口提示、迟到回包和原编号恢复；真实 workspace/session 配合合成来源与存储 |
| [tests/components/CentralInvoiceReviewAuthorityRace.test.ts](../../../tests/components/CentralInvoiceReviewAuthorityRace.test.ts) | 组件（jsdom） | 票面核对的授权等待、同源重读、存储缺口、失权和原编号恢复；真实 workspace/session 配合合成来源与存储 |
| [tests/components/CentralInvoiceCloudConsentRace.test.ts](../../../tests/components/CentralInvoiceCloudConsentRace.test.ts) | 组件（jsdom） | 云识别确认与来源变化；合成原件和云 sink，不连接真实云服务 |
| [tests/components/CentralInvoiceDiscardConsentRace.test.ts](../../../tests/components/CentralInvoiceDiscardConsentRace.test.ts) | 组件（jsdom） | 废弃确认、授权期间生命周期和来源变化；真实 workspace/session 配合合成写入 sink |
| [tests/components/CentralInvoiceArchiveConsentRace.test.ts](../../../tests/components/CentralInvoiceArchiveConsentRace.test.ts) | 组件（jsdom） | 归档确认、授权等待和来源变化；真实 workspace/session 配合合成写入 sink |
| [tests/components/CentralInvoiceAttachConsentRace.test.ts](../../../tests/components/CentralInvoiceAttachConsentRace.test.ts) | 组件（jsdom） | 关联原件确认、读取、授权和迟到回包；真实 workspace/session 配合合成写入 sink 与原编号恢复 |
| [tests/components/CentralInvoiceLegacyConsentRace.test.ts](../../../tests/components/CentralInvoiceLegacyConsentRace.test.ts) | 组件（jsdom） | 旧票核对确认、授权和迟到回包；真实 workspace/session 配合合成写入 sink 与原编号恢复 |
| [tests/components/CentralInvoiceWorkspaceScreen.test.ts](../../../tests/components/CentralInvoiceWorkspaceScreen.test.ts) | 组件（jsdom） | 工作台与原编号恢复 |
| [tests/components/CentralInvoiceWorkspaceView.test.ts](../../../tests/components/CentralInvoiceWorkspaceView.test.ts) | 组件（jsdom） | 归档归属与来源版本 |
| [tests/components/CentralInvoiceDragUpload.test.ts](../../../tests/components/CentralInvoiceDragUpload.test.ts) | 组件（jsdom） | 上传确认期间目录、权限和原编号变化阻断 |
| [tests/components/CentralInvoiceCorrectionAuthority.test.ts](../../../tests/components/CentralInvoiceCorrectionAuthority.test.ts) | 组件（jsdom） | 撤权隐藏原票与同身份草稿恢复 |
| [tests/components/CentralInvoiceCorrectionRoute.test.ts](../../../tests/components/CentralInvoiceCorrectionRoute.test.ts) | 组件（jsdom） | 同路由切票的未保存输入保护 |
| [tests/components/CentralInvoiceCorrectionScreen.test.ts](../../../tests/components/CentralInvoiceCorrectionScreen.test.ts) | 组件（jsdom） | 更正草稿、提交、打印阻断及原编号 |
| [tests/components/CentralInvoiceFieldsForm.test.ts](../../../tests/components/CentralInvoiceFieldsForm.test.ts) | 组件（jsdom） | 票面零与未知、版本冲突及识别草稿 |
| [tests/components/InvoiceMigrationPanel.test.ts](../../../tests/components/InvoiceMigrationPanel.test.ts) | 组件（jsdom） | 旧票映射、公司主体及预检缺口 |
| [tests/components/InvoiceMigrationAuthorityRace.test.ts](../../../tests/components/InvoiceMigrationAuthorityRace.test.ts) | 组件（jsdom） | 迁入及撤回的授权等待、已发送后失权保留原编号与原命令恢复；使用真实迁入 session 和合成预检、授权、存储及服务替身 |
| [tests/components/InvoiceMigrationRecoverAuthorityRace.test.ts](../../../tests/components/InvoiceMigrationRecoverAuthorityRace.test.ts) | 组件（jsdom） | 原编号核对期间失权、切源与能力变化保号；已应用和未应用使用真实迁入 session 及合成授权、存储和服务替身 |
| [tests/components/InvoiceMigrationFileLifetime.test.ts](../../../tests/components/InvoiceMigrationFileLifetime.test.ts) | 组件／合成来源 | 快照读取、解析及预检迟到时的已观察失效与来源切换保护 |
| [tests/components/InvoiceMigrationModuleLifetime.test.ts](../../../tests/components/InvoiceMigrationModuleLifetime.test.ts) | 组件／合成来源 | 快照解析模块加载期间来源失效不启动旧校验 |
| [tests/components/InvoiceMigrationPendingReadFailure.test.ts](../../../tests/components/InvoiceMigrationPendingReadFailure.test.ts) | 组件及隔离服务 | 发布或恢复后批次读取失败，重进后保留并核对原编号 |
| [tests/components/InvoiceMigrationRecoveryFlow.test.ts](../../../tests/components/InvoiceMigrationRecoveryFlow.test.ts) | 组件（jsdom） | 迁入断线后原编号核对 |
| [tests/components/FactorSolverState.test.ts](../../../tests/components/FactorSolverState.test.ts) | 组件（jsdom） | 因子工具保存配置兼容 |
| [tests/components/FactorTaxCalculator.test.ts](../../../tests/components/FactorTaxCalculator.test.ts) | 组件（jsdom） | 共用金额税额栏 |
| [tests/components/InvoiceEditPage.test.ts](../../../tests/components/InvoiceEditPage.test.ts) | 组件（jsdom） | 编辑页重新识别草稿：只填表单不写库、保存二次确认（取消不写库）、字段角标与读屏原值、放弃恢复、离开保护、失败保留输入；原图比对框、“原图未定位”、聚焦/悬停强调与旋转换算；平时显示原件，无原文件时说明“原件不在本次会话中”且不显示示意图；首次识别聚焦字段临时框出、失焦撤框 |
| [tests/components/InvoiceReviewForm.test.ts](../../../tests/components/InvoiceReviewForm.test.ts) | 组件（jsdom） | 识别校对表单草稿模式：修改只交父级不写库，变动字段角标与读屏原值；聚焦/悬停变动字段通知原图强调，读屏说明原图是否框出；首次识别点字段定位聚焦即定位、失焦撤回，未定位字段读屏说明 |
| [tests/components/InvoiceRegionViewer.test.ts](../../../tests/components/InvoiceRegionViewer.test.ts) | 组件（jsdom） | 发票原图预览器：普通预览缩放与左右旋转、PDF 超页数上限如实提示、渲染/解码失败可解释并重试、点字段定位与比对两种区域模式 |
| [tests/components/InvoiceRegionViewerDecodeFailure.test.ts](../../../tests/components/InvoiceRegionViewerDecodeFailure.test.ts) | 组件（jsdom） | 合成 PDF 页图解码失败、重试、定位撤销和旧结果迟到 |
| [tests/components/InvoiceImageDecodeReadiness.test.ts](../../../tests/components/InvoiceImageDecodeReadiness.test.ts) | 组件（jsdom） | 旧工作台图片解码前不定位、零尺寸、解码失败重试及旧文件事件迟到；中央空几何帧仍拒绝定位 |
| [tests/components/InvoicePrintLayout.test.ts](../../../tests/components/InvoicePrintLayout.test.ts) | 组件（jsdom） | 打印面板：无原件的 Excel 发票不可勾选、列出未打印清单，打印只提交有原件的票 |
| [tests/components/InvoiceExportPreview.test.ts](../../../tests/components/InvoiceExportPreview.test.ts) | 组件（jsdom） | 发票导出预览样式草稿 |

## 真实浏览器（Vitest／Chromium）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/browser/CentralInvoiceArchive.test.ts](../../../tests/browser/CentralInvoiceArchive.test.ts) | 真实组件／模拟来源 | 归档来源及主要视口 |
| [tests/browser/CentralInvoiceDragUpload.test.ts](../../../tests/browser/CentralInvoiceDragUpload.test.ts) | 真实组件／模拟来源 | 五视口拖放、归属失效与键盘上传入口 |
| [tests/browser/CentralInvoiceLedgerExport.test.ts](../../../tests/browser/CentralInvoiceLedgerExport.test.ts) | 真实组件／模拟来源 | 台账导出与主要视口 |
| [tests/browser/CentralInvoicePrintAuthorityRace.test.ts](../../../tests/browser/CentralInvoicePrintAuthorityRace.test.ts) | 真实组件／合成来源 | 两视口键盘打印确认、授权期间及已发送后切源与同源登记；系统打印与原件核验为替身 |
| [tests/browser/CentralInvoiceLedgerSnapshot.test.ts](../../../tests/browser/CentralInvoiceLedgerSnapshot.test.ts) | 真实组件／模拟来源 | 五视口筛选、键盘、焦点和来源变化；导出文件调用为替身 |
| [tests/browser/CentralInvoiceManualCompany.test.ts](../../../tests/browser/CentralInvoiceManualCompany.test.ts) | 真实组件／模拟来源 | 手工公司票归档选择 |
| [tests/browser/CentralInvoicePendingRecovery.test.ts](../../../tests/browser/CentralInvoicePendingRecovery.test.ts) | 真实组件／模拟来源 | 原编号发现与恢复 |
| [tests/browser/CentralInvoiceSessionReadAuthority.test.ts](../../../tests/browser/CentralInvoiceSessionReadAuthority.test.ts) | 真实组件／合成传输 | 失读权隐藏票面、重新读取与键盘核对原号；会话与服务响应均为合成 |
| [tests/browser/CentralInvoiceObservedAuthority.test.ts](../../../tests/browser/CentralInvoiceObservedAuthority.test.ts) | 浏览器组件／合成传输 | 两视口旧 403 后隐藏票面、保留输入及键盘重读，并回归原编号恢复；不访问真实服务 |
| [tests/browser/CentralInvoiceLoadInterleaving.test.ts](../../../tests/browser/CentralInvoiceLoadInterleaving.test.ts) | 真实组件／合成传输 | 两视口旧读取成功或网络失败迟到不覆盖新数据或提示，键盘焦点；外部并发使用合成来源 |
| [tests/browser/CentralInvoiceRegions.test.ts](../../../tests/browser/CentralInvoiceRegions.test.ts) | 真实组件／模拟来源 | 原件定位与撤权 |
| [tests/browser/InvoiceImageDecodeReadiness.test.ts](../../../tests/browser/InvoiceImageDecodeReadiness.test.ts) | 真实浏览器／合成图片 | 五视口真实图片解码后的定位、旋转及损坏恢复；不读取真实发票 |
| [tests/browser/InvoicePdfPageDecodeFailure.test.ts](../../../tests/browser/InvoicePdfPageDecodeFailure.test.ts) | 真实浏览器／合成页图 | 五视口 PDF 页图解码失败、键盘重试和焦点返回 |
| [tests/browser/pdf-preview-real-browser.test.ts](../../../tests/browser/pdf-preview-real-browser.test.ts) | 真实浏览器／合成 PDF | 真实 pdf.js 和 canvas 渲染单页旋转 PDF、图像解码与调用者释放 URL |
| [tests/browser/CentralInvoiceRerecognition.test.ts](../../../tests/browser/CentralInvoiceRerecognition.test.ts) | 真实组件／模拟来源 | 重识别草稿与交互 |
| [tests/browser/CentralInvoiceRerecognitionConsentRace.test.ts](../../../tests/browser/CentralInvoiceRerecognitionConsentRace.test.ts) | 真实组件／模拟来源 | 五视口键盘、焦点与重识别提交来源守卫；切票和放弃草稿的确认迟到、取消及正常操作；受控确认替身和合成原件、写入 sink |
| [tests/browser/CentralInvoiceEditAuthorityRace.test.ts](../../../tests/browser/CentralInvoiceEditAuthorityRace.test.ts) | 真实组件／模拟来源 | 五视口键盘普通保存、授权期间切源、存储缺口与恢复及同源成功；合成授权、存储和写入 sink |
| [tests/browser/CentralInvoiceReviewAuthorityRace.test.ts](../../../tests/browser/CentralInvoiceReviewAuthorityRace.test.ts) | 真实组件／模拟来源 | 五视口键盘核对、授权期间切源或卸载、存储缺口与恢复及同源成功；合成授权、存储和写入 sink |
| [tests/browser/CentralInvoiceLeaveRealConfirm.test.ts](../../../tests/browser/CentralInvoiceLeaveRealConfirm.test.ts) | 真实组件／模拟来源 | 五视口真实确认宿主的 Escape、焦点、来源重读后迟到确认和单宿主抢占；第二次确认由测试直接触发，识别及数据来源为合成替身 |
| [tests/browser/CentralInvoiceCloudConsentRace.test.ts](../../../tests/browser/CentralInvoiceCloudConsentRace.test.ts) | 真实组件／模拟来源 | 五视口键盘、焦点与云识别来源切换；受控确认替身、合成原件及云 sink，不连接真实云 |
| [tests/browser/CentralInvoiceDiscardConsentRace.test.ts](../../../tests/browser/CentralInvoiceDiscardConsentRace.test.ts) | 真实组件／模拟来源 | 五视口键盘、焦点与确认期间卸载；受控确认替身和合成写入 sink |
| [tests/browser/CentralInvoiceBatchUpload.test.ts](../../../tests/browser/CentralInvoiceBatchUpload.test.ts) | 浏览器组件／合成来源 | 批次键盘焦点与失权清理、真实文件读取迟到后阻断旧上传；不连接真实服务 |
| [tests/browser/CentralInvoiceArchiveConsentRace.test.ts](../../../tests/browser/CentralInvoiceArchiveConsentRace.test.ts) | 真实组件／模拟来源 | 五视口键盘、焦点与归档确认时来源切换；受控确认替身和合成写入 sink |
| [tests/browser/CentralInvoiceAttachConsentRace.test.ts](../../../tests/browser/CentralInvoiceAttachConsentRace.test.ts) | 真实组件／模拟来源 | 五视口键盘、焦点与原件确认期间切换来源或卸载；受控确认、合成文件与写入 sink |
| [tests/browser/CentralInvoiceLegacyConsentRace.test.ts](../../../tests/browser/CentralInvoiceLegacyConsentRace.test.ts) | 真实组件／模拟来源 | 五视口键盘、焦点与旧票核对确认期间切换来源或卸载；受控确认和合成写入 sink |
| [tests/browser/CentralInvoiceQueueSearch.test.ts](../../../tests/browser/CentralInvoiceQueueSearch.test.ts) | 真实组件／模拟来源 | 五视口键盘搜索、草稿保护、来源变化清词和队列局部滚动 |
| [tests/browser/CentralInvoiceQueueStatusFilter.test.ts](../../../tests/browser/CentralInvoiceQueueStatusFilter.test.ts) | 真实组件／模拟来源 | 五视口状态多选浮层键盘与焦点、取消和应用、组合筛选、来源切换及队列局部滚动 |
| [tests/browser/CentralInvoiceCorrection.test.ts](../../../tests/browser/CentralInvoiceCorrection.test.ts) | 真实组件／模拟来源 | 更正票面与归属的多视口操作 |
| [tests/browser/CentralInvoiceCorrectionAuthority.test.ts](../../../tests/browser/CentralInvoiceCorrectionAuthority.test.ts) | 真实组件／模拟来源 | 失权隐藏与同身份草稿恢复 |
| [tests/browser/CentralInvoiceCorrectionNavigation.test.ts](../../../tests/browser/CentralInvoiceCorrectionNavigation.test.ts) | 真实组件／模拟来源 | 键盘切票和离开保护 |
| [tests/browser/InvoiceMigrationPendingReadFailure.test.ts](../../../tests/browser/InvoiceMigrationPendingReadFailure.test.ts) | 真实组件／模拟来源 | 读取失败时原编号提示、撤权和多视口 |
| [tests/browser/InvoiceMigrationPanel.test.ts](../../../tests/browser/InvoiceMigrationPanel.test.ts) | 真实组件／模拟来源 | 迁入映射和原编号多视口操作 |
| [tests/browser/InvoiceMigrationAuthorityRace.test.ts](../../../tests/browser/InvoiceMigrationAuthorityRace.test.ts) | 真实组件／合成来源 | 五视口键盘确认及授权等待期间失权；确认、文件、授权、存储及命令使用受控合成替身 |
| [tests/browser/InvoiceMigrationRecoverAuthorityRace.test.ts](../../../tests/browser/InvoiceMigrationRecoverAuthorityRace.test.ts) | 真实组件／合成来源 | 五视口键盘核对期间失权保号及恢复会话重试；授权、存储和服务均为合成替身 |
| [tests/browser/InvoiceMigrationFileLifetime.test.ts](../../../tests/browser/InvoiceMigrationFileLifetime.test.ts) | 浏览器组件／合成来源 | 快照选择、失效停止后续校验、键盘及两视口 |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/production-invoice-company-manual.spec.ts](../../../e2e/production-invoice-company-manual.spec.ts) | 隔离服务／合成数据 | 手工建票与公司合同归档 |
| [e2e/production-invoice-drag-upload.spec.ts](../../../e2e/production-invoice-drag-upload.spec.ts) | Playwright 隔离生产构建 | 项目及公司拖放、响应丢失后原编号与原件冷恢复；不运行真实 OCR |
| [e2e/production-invoice-manual-recovery.spec.ts](../../../e2e/production-invoice-manual-recovery.spec.ts) | 隔离服务／合成数据 | 手工创建响应丢失、重启重新登录及原编号刷新恢复 |
| [e2e/production-invoice-ledger-export.spec.ts](../../../e2e/production-invoice-ledger-export.spec.ts) | 隔离服务／合成数据 | 台账筛选导出与隔离冷读 |
| [e2e/production-invoice-migration.spec.ts](../../../e2e/production-invoice-migration.spec.ts) | 隔离服务／合成数据 | 项目和公司旧票发布、原件及断线原编号恢复 |
| [e2e/production-invoice-correction.spec.ts](../../../e2e/production-invoice-correction.spec.ts) | 隔离服务／合成数据 | 更正草稿、断线原编号恢复与打印阻断 |
| [e2e/factor-solver.spec.ts](../../../e2e/factor-solver.spec.ts) | Playwright E2E | 精确因子组合工作台 |
| [e2e/invoice-export-borders.spec.ts](../../../e2e/invoice-export-borders.spec.ts) | Playwright E2E | Issue #437 发票 Excel 分组边框 |
| [e2e/invoice-ledger-print-mode.spec.ts](../../../e2e/invoice-ledger-print-mode.spec.ts) | Playwright E2E | 发票台账打印入口：Excel 行可在台账勾选合计但不进入打印，进入双栏选择、打印确认并返回台账 |
| [e2e/invoice-print-layout.spec.ts](../../../e2e/invoice-print-layout.spec.ts) | Playwright E2E | 发票打印排版：1/2/4 张、勾选合计、旋转、打印确认与计数持久化 |
| [e2e/invoice-project-linkage.spec.ts](../../../e2e/invoice-project-linkage.spec.ts) | Playwright E2E | 发票全旅程：识别归档后三处联动，改项目后迁移，再转个人开支隔离 |
| [e2e/issue-398-invoice-rerecognition.spec.ts](../../../e2e/issue-398-invoice-rerecognition.spec.ts) | Playwright E2E | 工作台与编辑页重新识别先作草稿：高亮变动、保存/确认二次确认、取消不写库、离开保护，原图比对框可见、聚焦字段与键盘 Tab 变动条目时强调、缩放旋转后仍可见；工作台与编辑页平时原件预览（键盘缩放旋转、放大后局部滚动不带动整页），首次识别聚焦字段强调框与失焦撤框（390 下切到原件面板保留最近一次定位、重新聚焦后更新，1440 失焦撤框），刷新后“原件不在本次会话中”；1440 与 390 视口键盘焦点，四档视口不横滚 |

## 辅助文件与配置（非独立测试）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/fixtures/invoice-ledger-layer/nuxt.config.ts](../../../tests/fixtures/invoice-ledger-layer/nuxt.config.ts) | 辅助／夹具 | 中央发票隔离验收层 |
| [tests/fixtures/invoice-ledger-layer/app/pages/invoice-workspace-acceptance.vue](../../../tests/fixtures/invoice-ledger-layer/app/pages/invoice-workspace-acceptance.vue) | 辅助／夹具 | 工作台隔离验收入口 |
| [tests/fixtures/invoice-ledger-layer/app/pages/invoice-ledger-acceptance.vue](../../../tests/fixtures/invoice-ledger-layer/app/pages/invoice-ledger-acceptance.vue) | 辅助／夹具 | 台账隔离验收入口 |
| [tests/fixtures/invoice-workbook.ts](../../../tests/fixtures/invoice-workbook.ts) | 辅助／夹具 | 供测试导入的夹具／辅助代码；按所属业务就近查阅 |
