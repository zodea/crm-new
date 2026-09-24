# #437 发票 Excel 分组边框验收

日期：2026-09-11。实施票：[#437](https://github.com/zodea/crm-new/issues/437)，承接 [#406](https://github.com/zodea/crm-new/issues/406) 的独立切片。当前规则见[发票页面蓝本](../../../rewrite/pages/finance-invoice.md#台账-xlsx-边框配置437)与 [ADR 0004](../../../adr/0004-export-interaction-model.md)。继承决定：[旧 #255 定稿](https://github.com/zodea/crm-new/issues/255#issuecomment-5248369759)、[同屏预览与默认保存](https://github.com/zodea/crm-new/issues/255#issuecomment-5248859741)、[SQLite 持久化修正](https://github.com/zodea/crm-new/issues/255#issuecomment-5251153378)。

## 本次完成与证据

- 两组四向边框分别控制实际预览与 XLSX。公共导出函数生成真实文件后读取 ZIP/XML，覆盖表头、数据、标题和合计角色；标题与合计继续沿用旧边框。
- 旧 JSON 在真实内存 SQLite 中加载、修改、保存并重建 store 回读；旧字体、格式、行高、列宽、冻结及合并配置继续保留。明确清空颜色后重读仍为黑色，未提供的分组和字段继续继承旧配置。
- 公共弹窗验证两组控件、合法 CSS、票种/金额列对齐、取消重开、恢复默认、保存失败保留输入与重试、保存后继续编辑撤下旧提示，以及非法输入不保存或导出。
- 真实 Chromium 从 `/finance/ledger` 打开预览，编辑全部八边，保存默认、刷新并下载。隔离浏览器只注入一张合成票，无真实票据、OCR 调用或生产数据库写入。
- 默认金额格式与已保存的自定义格式均显示当前选项，导出保持原值。浏览器固定在 `Asia/Shanghai` 的 `2026-09-11 00:30`，预览与实际下载文件名都使用本地日期 `2026-09-11`。
- 390 / 768 / 1024 / 1280 / 1440 × 900 检查无页面横滚、表格自身横滚、两组完整可见、键盘焦点留在弹窗、错误提示和主操作可达。每档完整边框组截图已查看；PDF 四页均已渲染查看。

## 文件

- `preview-{width}.png`：表格预览与页面边界。
- `header-{width}.png` / `data-{width}.png`：整组四边居中可见及键盘焦点；显示的是五档测试草稿。
- [invalid-color.png](./invalid-color.png)：无效颜色在固定操作区提示。
- [invoice-borders.xlsx](./invoice-borders.xlsx)：另一条完整保存/刷新/导出旅程下载的真实文件，使用不同线型与颜色。
- [workbook-readback.json](./workbook-readback.json)：该文件 SHA-256、单元格样式索引、边框索引及四边原始 XML 值。
- [使用指南](../../../guides/finance-invoice.md)及[四页 Markdown 指南](../../../guides/finance-invoice.md)。

## 验证记录

| 接缝 | 结果 |
| --- | --- |
| `tests/invoice/excel.test.ts` | 11 项通过 |
| `tests/stores/invoice-preferences.test.ts` | 5 项通过 |
| `tests/components/InvoiceExportPreview.test.ts` | 7 项通过；三份定向文件合计 23 项通过 |
| `e2e/invoice-export-borders.spec.ts` | 最终 2 项通过（53.4 秒），含午夜文件名、默认金额格式、实际下载与五档视口 |
| 本次相关源码和测试定向 ESLint | 通过 |
| `pnpm typecheck` | 通过 |

先失败再修复的实际反例：表头 XML 仍用共用边框；RGB 未规范化；非法线型可保存；缺少表头/数据组控件；编辑后仍标已保存；清空颜色后重载恢复旧色；只有 `#` 的不完整颜色仍触发导出。初次浏览器验证因测试等待完整票号、而台账按既有规则显示尾八位而失败，改为等待合成供应商行后复验；该次等待失败不作为产品缺陷或通过证据。

同一导出流程的补充反例：默认与自定义金额格式的公开控件均得到空选项，新增两项组件用例先失败后通过；本地 `09-11 00:30` 的真实预览显示 `发票台账_2026-09-10.xlsx`，窄修本地日期来源后，预览与实际下载断言均通过。冲突留证见 [#437 评论](https://github.com/zodea/crm-new/issues/437#issuecomment-5622190652)。最终 16 张视口截图与四页 PDF 均逐张查看，实际下载的文件与 XML 摘要在本目录留存。

此证据只证明本切片在当前源码和隔离浏览器中的行为，不代表整个 #406、发票领域中央写源、生产部署或 Office/WPS 双引擎视觉验收完成。合法复合线型在网页近似展示，原始值写入 XLSX。
