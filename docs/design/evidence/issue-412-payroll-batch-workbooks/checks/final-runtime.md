# P7 最终运行记录

验证日期：2026-09-22。产品提交为 `f71196db`、`f14fdd26`、`3181761d`、`c6d0a1ba` 和 `a2f117f5`。

## 自动检查

- `pnpm typecheck`：通过。
- 改动路径精确 ESLint：通过。
- `pnpm test:unit -- tests/payroll/central-batch-funding.test.ts tests/payroll/complete-workbook.test.ts`：2 文件、10 项通过。
- `pnpm test:components -- tests/components/PayrollWorkbookArchiveDialog.test.ts tests/components/PayrollCentralRead.test.ts`：2 文件、14 项通过。
- `pnpm build`：通过；原 BigInt 字面量目标兼容警告已消失。仍有既有的 sourcemap、VueUse PURE 注释及动态/静态导入提示，没有新增构建失败。
- 最终产品提交钩子：793 文件、4339 项通过，337.61 秒。
- 最终定向回归：批次服务、HTTP、迁移与工作簿 5 文件、22 项；工作簿弹窗与取整配置 2 文件、3 项。

## 文件结果

测试重新打开实际生成的 XLSX 与 ZIP，确认以下结果：

- 全周期工作簿包含目录、周期对账、实际收付、缺口清单及冻结原表。
- 冻结原文有缺口的范围只生成“部分工资工作簿”，公式合计和对账结论为不可判定；实际账查询仍覆盖所选全部已发工资身份。
- A 累计 1000/1600、实际 800/700 的周期结果为应付 1600、净实际 1500、差额 100。
- 按月归档具有真实 `YYYY-MM/` 目录和根目录 `00-归档说明.md`。
- C1 为工资与考勤，C2 为工资与签工且无考勤；缺正文只登记缺口。

## 浏览器结果

本地正式来源为空，页面在 390、768、1024、1280、1440px 五档视口运行。五档的 `documentElement.scrollWidth` 均等于视口宽度；工资表容器自身保留横向滚动。390px 下从“刷新”继续 Tab 后焦点进入“资料来源”选择框。控制台错误为 0。

因为实例没有项目和已发工资，“完整工作簿”入口按既定条件不显示，不能在本轮空实例中实际打开弹窗。弹窗选择、读取全部已发工资、两种模式及导出错误由组件测试覆盖；真实 XLSX/ZIP 结构由文件回读覆盖。该限制保留在证据中，不扩写为有数据浏览器全链。
