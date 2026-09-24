# P1 独立审查归档

原审查记录按字节保留，其中 `.tmp` 路径说明审查时输入，不是继续使用临时文件的要求。对应报告在本目录按原文件名归档；最终产品文件身份见上级 `code-hashes.json`。

- `spec-followup-final.json`、`standards-followup-final.json`：前轮双轴复核。
- `provenance-standards-review.json`：曾发现价格主体问题的历史记录，不是最终通过结论。
- `receipt-closure-review.json`：回执、冻结来源、转组价格和恢复边界的独立复核，未决 Standards/Spec 均为0；相关红绿日志一并保留。
- `final-integration-review.json`：最后11个输入的独立规范复核，覆盖来源布局、浏览器边界断言、旧用例兼容及文档，未决为0。
- `npm-test-final.log`：第一次整合全量的失败记录；最终通过结果位于 `../verification/npm-test-release.log`。
- 图像审查是同次运行的逐张目检；不以静态图推断未执行的交互行为。
