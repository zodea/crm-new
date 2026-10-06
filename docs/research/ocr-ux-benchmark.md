# 识别校对界面的历史参考线索

> 非权威调研，取证日期为 2026-07-05。原调查提到下列产品及交互，但未保存逐项可核验的第一方页面或运行截图；它们只是补采线索，不构成瑞航已实现、已采纳或必须新增的能力。

当前发票、送货单和 OCR 设置各有独立业务入口；字段、人工核对、有效资格及异常路径直接见[发票页面](../rewrite/pages/finance-invoice.md)与[送货页面](../rewrite/pages/material-delivery.md)，模型、联网与凭证边界只见 [ADR 0006](../adr/0006-ocr-paddleocr-vl-single-model.md)。旧固定三栏比例、六阶段常驻步骤、PP-OCRv6、多引擎回退和自动确认建议不作为实施指令，原全文通过[固定 Git 来源](https://github.com/zodea/crm-new/blob/c16869fcbf954dddd46143839afe5790f3828f1a/docs/research/ocr-ux-benchmark.md)定位。

## 保留的比较线索

| 原调查提及对象 | 要补采的交互 | 证据限制 |
| --- | --- | --- |
| Rossum、Docsumo | 字段和原图双向定位、明细网格及人工画线补漏 | 需要核实坐标格式、实际键盘行为和原图尺度；没有坐标不能伪造高亮 |
| Google Document AI HITL、ABBYY Verification Station | 明确的人工确认、嵌套明细及成组校对 | 参考工具的批量确认不能覆盖瑞航逐业务人工核对门槛 |
| Label Studio、docTR-Labeler | 区域列表、预标注修正和键盘流 | 工具交互与财务、送货归档不是同一业务，不能直接移植资格或保存状态 |
| TextIn、每刻报销 | 单页多票预览、批量处理、重复与异常呈现 | 异常分类和查重条件须按本项目实体及原件证据判断 |
| Ramp、Tipalti | 字段来源解释和按版式修正的透明度 | 旧调查没有证明本项目有学习后端；来源说明不能伪装成已训练的自动修正 |
| 百度 iOCR | 原图框选字段与模板冷启动 | 只是备选交互线索，不授权新增引擎、云调用或模板依赖 |

原调查聚焦“看到原件、定位字段、明确人工采用、解释错误”之间的连贯性。具体改善应从当前运行页面确认缺口，再核对对应参考；色卡、分栏、浮层和键盘约束只维护 [DESIGN-SYSTEM](../rewrite/DESIGN-SYSTEM.md)及 [KitUI](../design/kit-ui-component-specs.md)，不在本文件另设一套比例、阈值或优先级。
