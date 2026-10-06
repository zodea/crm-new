# #438 合作档案原件验收记录

> 本页保留已完成切片的实测摘要及原验收边界；日期、数量和阶段状态属于当次记录。历史多轮图片、审查与归档流水统一由[固定 Git 原始材料](https://github.com/zodea/crm-new/tree/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-438)定位。当前规则以所引现行权威文档为准，保留的真实原件、源证明和产品打印不改写。

日期：2026-09-11。规格：[#438](https://github.com/zodea/crm-new/issues/438)，父票 [#408](https://github.com/zodea/crm-new/issues/408)，文件能力协作 [#406](https://github.com/zodea/crm-new/issues/406)。

本记录对应 `main` 基线 `39c56dc84d10d8d759119022ca9d7deaf91d0c62` 上冻结的 #438 工作区切片；测试运行时 #436/#439/#440 的运行源码暂停写入。提交前记录不冒称固定提交已验收，最终提交 SHA 与集成检查由 Issue 交付评论绑定。页面和字段规则仍以[项目分供方蓝本](../../../rewrite/pages/project-supplier.md#文件区)为准。

## 已验证范围

仅接入中央导入保存、`ownerType=project_supplier` 且 owner 为当前合作关系的原件。服务端重读当前项目、分供方及 canonical 合作关系，核验当前会话能力、来源、文件与 owner 后才访问同会话正文；导入时的父实体副本、同名或同 ID 本地文件不能授权或补正文。列表仅带元数据和可用性，正文按用户动作读取。

浏览器验证使用独立测试会话和合成文件，未访问外部参考站写入口。合成 PDF 有真实交叉引用表和两页不同内容；通过实际导入表单建立关系并保存，再刷新工作台。测试读取真正下载的文件流与预览对象 URL，使用 PDF.js 独立解析页数和每页内容，同时校验原始字节。没有以文件名、截图或三字节假 PDF 替代原件验证。

| 验收动作 | 实际结果与证据 |
| --- | --- |
| 导入 → 刷新 → 单份下载 → PDF 预览 | 原件下载和预览均逐字节等于输入，解析为两页，文本顺序为 `Central original page 1`、`Central original page 2`。预览开启独立窗口，应用不改写 PDF。 |
| 中央与本地同 ID 冲突 | 在本地业务快照安装同 fileId、owner、文件名但内容为 `LOCAL` 的文件；刷新后的中央下载仍是原始 PDF。正文入口不调用本地文件加载链。 |
| 同名不同文件及原始 ZIP | 实际选择三份文件并下载 ZIP，两份同名 PDF 分别保留原字节，第二份追加 `(2)`；原始 ZIP 附件作为完整文件保留，不展开。逐个检查包内原件与清单 SHA-256 相符。 |
| 当前身份和权限 | HTTP 实测错误项目、分供方、关系、ownerType、ownerId、origin 与其他测试会话均不得取得正文；上传后撤销当前项目权限返回 403，删除当前项目返回 404，不使用导入副本。 |
| 摘要失败与重试 | 注入错误 SHA-256 后，ZIP 动作明确失败并保留选择；去除故障后同一选择可以成功下载。[故障状态](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-438/hash-failure.png)。 |
| 慢响应保存 | 正文端点延迟 6.5 秒；保存目录 port 入口检查真实 `navigator.userActivation.isActive`，随后验证写入字节。等待仅使用 console 事件，不用 DOM 轮询续激活。修复后激活为 true，写入与输入相同。目录 port 为可观察测试替身，未声称人工选择过操作系统目录。 |
| 视口和焦点 | 390/768/1024/1280/1440 × 900，根页面无横向溢出，合作文件动作随宽度换行，ZIP 按钮可聚焦。五张截图均逐张检查；没有提升外部参考证据等级。 |

截图：[390](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-438/files-390.png)、[768](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-438/files-768.png)、[1024](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-438/files-1024.png)、[1280](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-438/files-1280.png)、[1440](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-438/files-1440.png)。截图中的成功消息分别来自先前的单份下载和 ZIP 下载。

## 失败复现与定向回归

- 正文读取端口、服务端和组件先建立失败回归后实现；覆盖权限/祖先/关系/来源/owner、缺正文、Base64、长度与摘要异常。服务端每次重验当前事实；未知摘要可由同一真实正文计算。
- ZIP 的超长扩展名和 emoji 截断曾导致清单路径与 ZIP 条目不同，两个新增回归先失败后通过；还覆盖重复 ID、同名不同 ID、非法路径/保留名、缺原件留痕、网络或校验失败整包拒绝。
- `window.open` 抛错曾留下忙碌状态；新增组件回归先失败后通过。提交前进一步复现“取消 A、完成 B、A 迟到”会释放 B 的预览 URL，随后将异常清理限定为所属请求，回归通过。弹窗阻止、取消/切换来源/卸载后的迟到成功、对象 URL 释放与重试均有行为验证。
- 真实 6.5 秒慢响应先出现 `438-picker-activation:false`。统一直接保存增加惰性 data 工厂，先请求目录再读取正文；公共端口新增顺序、取消不读、读取中取消后的迟到成功/失败、读失败不写盘回归，原有字节参数和写盘行为保持兼容。
- 使用默认 Chromium headless shell 时 PDF 预览停留在 `about:blank`；其不支持 PDF 导航是 [Playwright 已知限制](https://playwright.dev/docs/api/class-page#page-goto)。本票 E2E 改用已安装的完整 `channel: chromium` 后，真实 PDF 预览通过，应用预览实现没有为测试替换成图片或假页面。

最终本票定向运行：

```text
npm test -- tests/project-supplier tests/components/ProjectSupplierFileAccess.test.ts tests/components/ProjectSupplierFilePanel.test.ts tests/kit/export.test.ts tests/kit/export-directory.test.ts tests/kit/export-config.test.ts tests/kit/configured-export-runner.test.ts
15 文件，131 项通过（含并行 #439 新增的一条请款回归；不以该通过结果扩展本票验收范围）。

pnpm typecheck
通过。

pnpm exec playwright test e2e/project-supplier-files.spec.ts --project=chromium --workers=1
3 项通过，54.0 秒。
```

本票独占源码与测试的 ESLint 检查通过。未独立启动全量测试或云 CI；父任务统一冻结后执行集成检查。

浏览器结果记录于上述最后一次完整运行；其后仅补入已红绿验证的预览异常清理归属保护，尚未把旧浏览器结果称为该后续改动的重跑结果。

## 使用指南与保留边界

[使用指南](../../../guides/project-supplier-workbench.md) V1.4 与 [Markdown 指南](../../../guides/project-supplier-workbench.md) 已同步。PDF 共六页，逐页渲染检查标题、表格、操作步骤、页脚及当前可用/待业务裁定边界，无裁切、重叠或乱码。

其他 owner 的合同、付款申请、发票、支付、支出结算正文仍未接入，继续由 #406/#408/#409/#410/#413 承接；缺正文不回退本地。合作终态确认 PDF 与终态规则仍归 #408 的业务裁定。本票不交付生产重启持久化、完整 RBAC、多 workspace、Tauri、OCR、附件替换/删除或全项目档案包，也不把测试会话当作生产认证。

取消和来源变化能阻止尚未开始的写盘，不声称撤销已开始的原生写入。历史缺原件可在 ZIP 清单留痕并报告不齐套；网络、权限、关系或完整性失败不降格为历史缺失。
