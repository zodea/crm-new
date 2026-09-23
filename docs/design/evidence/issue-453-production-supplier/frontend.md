# 分供方本机保存前台验收

对应 [#453](https://github.com/zodea/crm-new/issues/453)，2026-09-22。使用隔离合成工作区、Node 24.12.0 构建产物与真实 Chromium；不连接用户资料或日常开发实例。当前使用步骤见[本机分供方指南](../../../guides/local-supplier-storage.md)，后端范围与生产边界见[验收入口](./README.md)。

## 失败复现与修复

- 主档和证照失响应的首轮测试证明浏览器没有原提交编号，刷新无法恢复。修复后仅保留工作区、操作者与目标限定的编号；正文、银行信息、原件和人工核验备注不写入浏览器持久层。
- 独立 Spec 审查发现未知项目数仍可筛选，主档会被过滤成假空列表。真实浏览器复现“合作项目数升序”仍可选；修复后前后端共用来源映射，未接管的数值列没有筛选入口，排序项不可选，键盘也跳过。旧深链明确失败，用户主动清除数值条件后原主档仍可见。
- 冷恢复最终读取失败或撤权时保留原编号，不宣称恢复成功。原提交已保存时，整页先显式读取已保存内容再更正，防止重复创建或上传。

## 精确验证

`npm test -- tests/production/supplier-pending.test.ts tests/production/supplier-credential-pending.test.ts tests/stores/supplier-credential-state.test.ts tests/stores/supplier-taxpayer.test.ts tests/master-data/command-sessions.test.ts tests/components/SupplierListCredentialFilter.test.ts --maxWorkers=1`：6 文件、28 用例通过，9.76 秒。覆盖无法可靠保留编号时禁止发送、未应用原键封存后换新键、已有成功回执的显式采用、恢复读取失败保键，以及原有证照与税务编辑隔离。

最终 `pnpm typecheck` 与本片前端、测试、新指南精确 ESLint 通过。完整测试由同批集成提交验证，结果绑定最终提交在 PR 登记；本记录不把定向测试冒称全量测试。

## 真实运行与文件

常驻用例：`e2e/production-supplier-storage.spec.ts`。实际公开页面连续完成：

1. 新建分供方，服务器提交成功后模拟响应丢失；停止服务、重新启动、重新登录，经列表待核对入口读取同一档案，未重复创建。
2. 上传合成营业执照原件，成功提交后丢响应；再次停止并重启，重新打开原证照页恢复唯一附件。
3. 真实点击下载原件，下载文件逐字节及 SHA-256 与上传文件一致；没有把文件名或路径当作原件验证。
4. 人工税务核验成功后丢响应；第三次重启并重新登录，原表单读到同一结论、备注和日期，以原命令读取同一回执。
5. 关联事实显示尚未接入，不触发未授权的跨域读取；旧项目数筛选地址明确失败，显式清除后显示同一条主档。

页面在 390 / 768 / 1024 / 1280 / 1440px 检查文档无横溢，原件下载操作可在页面内滚动到达。上传弹窗键盘取消后焦点回到上传按钮，证照页返回同一分供方详情。浏览器没有未处理异常。

最终机器回执见[浏览器结果](./browser.json)。截图只保留必要的 390px 与 1440px 两档：

| 页面 | 窄屏 | 桌面 |
| --- | --- | --- |
| 未接入的列表数值与正常主档 | [390px](./screens/unavailable-list-390.png) | [1440px](./screens/unavailable-list-1440.png) |
| 未接入的合同事实 | [390px](./screens/unavailable-facts-390.png) | [1440px](./screens/unavailable-facts-1440.png) |
| 原证照恢复及原件操作 | [390px](./screens/recovered-credential-390.png) | [1440px](./screens/recovered-credential-1440.png) |

未生成指南 PDF。合成原件只用于运行验证，不作为业务资料交付；普通临时截图、日志和下载副本在证据归档后清理，数据库不纳入清理或 Git。
