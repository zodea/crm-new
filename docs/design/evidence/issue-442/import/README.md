# #442 日常三类中央导入验证

本页是验证证据，不是数据或流程的权威源。命令和读取规则见 [COMMANDS](../../../../rewrite/COMMANDS.md#工程量中央命令与迁移接管442)、[READ-MODELS](../../../../rewrite/READ-MODELS.md#工程量中央读取与甲方月报442)，操作说明见[工程量中央流程指南](../../../../guides/quantity-central-workflow.md)。

## 当前结果

2026-09-12 日常三类导入的实际浏览器链路通过：`e2e/quantity-import.spec.ts` 1/1，业务执行 23.0 秒、总耗时 34.0 秒。使用当前 HTTP 创建的合成正式项目和班组，上传真实 CSV，经映射和预览写入中央，再通过当前读取接口核对结果；没有向浏览器注入成功记录或绕过业务校验。

- 新增公共服务和真实 Repository 9 项：模板零/未知/公式、原识别量和旧 BOQ 身份、项目/区域/责任唯一身份、显式责任替换与历史照片保全、completed 缺照片拒绝与 draft 保存、版本/幂等冲突、命令响应目标/状态拒收、写成功后回读失败使用同一命令恢复。
- 既有原桌面导入 6 项通过，显式旧数据回填边界未改变。
- HTTP Repository、中央页面和 store 8 项，以及导入注册表/runner/映射/来源边界 31 项通过，共 55 项定向验证。
- 精确源码与测试 ESLint 通过；最终类型和完整回归由 #442 集成验证记录汇总。
- 首次公开模板命令红例为“不支持的工程量命令动作”，接入后转绿；新增结果校验红例为服务器把 completed 响应降为 draft 时被错误接受，修复后拒收。
- 实际 CSV 读取新增两项红例分别证明 UTF-8/GBK 将 `2026-09-11` 自动改成 `9/11/26`；读取层保留原始文字后转绿，并确认 XLSX 的显式日期和前导零格式仍按单元格显示值读取。补充文件、工程量、项目、发票、映射与 runner 六文件 56 项通过（与前述 55 项有重合，不累加）。

## 真实文件与交互证据

- 模板 CSV 回读合同量 `0`、暂定量 `null`、现场算式 `2*3` 得到 `6`，未关联 BOQ 的认定量保持 `null`。
- 责任 CSV 由当前项目、楼栋、楼层、户和班组唯一身份解析，回读到真实户 ID 与班组 ID。
- 阶段 CSV 第一行请求 `completed`、没有照片，被明确拒绝；第二行明确请求 `draft`，成功保存备注“明确待补照”。等待导入进度达到 100% 后再读取，避免把尚未处理的第二行当成失败。
- 下载的[拒绝清单](./quantity-import-rejections.csv)保留原始第 2 行、原值和缺照原因，只含被拒绝的 `completed` 行，不含已保存的草稿。测试使用应用已有的浏览器下载适配路径；真实系统目录选择器由公共导出套件另行验证。
- 390 / 768 / 1024 / 1280 / 1440px 实际视口均无页面横向溢出，下载按钮可以获得键盘焦点。五张截图已逐张检查，结果通知退出后页头、反馈和操作可见；窄屏预览表在自己的区域横向滚动。

| 视口 | 实际截图 |
| --- | --- |
| 390px | [移动宽度](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-442/import/quantity-import-390.png) |
| 768px | [窄桌面宽度](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-442/import/quantity-import-768.png) |
| 1024px | [桌面宽度](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-442/import/quantity-import-1024.png) |
| 1280px | [桌面宽度](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-442/import/quantity-import-1280.png) |
| 1440px | [桌面宽度](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/design/evidence/issue-442/import/quantity-import-1440.png) |

实际失败曾揭示共享 CSV 读取器把 ISO 日期改成另一种格式；已修读取层保留字面值，并通过 UTF-8、GBK 及 XLSX 格式兼容反例。测试夹具的项目编码、异步导入完成等待和浏览器下载适配也已分别纠正，产品的项目身份、严格日期及缺照规则保持有效。

## 范围边界

日常模板量、责任配置和阶段完成通过正式中央命令逐行执行。所有关系先从当前来源唯一解析为稳定 ID，再在服务器重验；文件自身不授予权限。完成行不能指定 `allowMissingPhotos` 或照片正文，不会静默把 completed 改成 draft。业务拒绝逐行报告，临时故障停止当前行供重试，写后同源回读成功才计为该行完成。

受控旧库迁移使用[另行证据](../migration/README.md)，其历史缺照片边界不适用于日常导入。本地后台可重置验证实例不代表生产持久化已经上线。
