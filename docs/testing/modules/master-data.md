# 通用主数据

[返回测试模块索引](../README.md)

本页记录文件归属与定位线索，不评定测试价值或业务验收状态。每个文件只在一个模块表中登记；跨模块关系在备注或总索引中说明。场景列默认摘取文件内首个分组／测试名称，仅用于定位，不代表文件全部断言已经复核。

## 单元／服务／状态

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/db/f1-master-data-migrations.test.ts](../../../tests/db/f1-master-data-migrations.test.ts) | 单元／服务／状态 | v19 F1 基础主数据迁移 |
| [tests/master-data/capabilities.test.ts](../../../tests/master-data/capabilities.test.ts) | 单元／服务／状态 | 班组/工人可承接能力 |
| [tests/master-data/command-sessions.test.ts](../../../tests/master-data/command-sessions.test.ts) | 单元／服务／状态 | 打开两个主档后，保存前一个只更新自己的记录和版本 |
| [tests/master-data/forms.test.ts](../../../tests/master-data/forms.test.ts) | 单元／服务／状态 | f1 整页表单领域 action |
| [tests/master-data/list.test.ts](../../../tests/master-data/list.test.ts) | 单元／服务／状态 | 主数据列表筛选与排序 |
| [tests/master-data/page.test.ts](../../../tests/master-data/page.test.ts) | 单元／服务／状态 | master data route metadata |
| [tests/stores/master-data-read.test.ts](../../../tests/stores/master-data-read.test.ts) | 单元／服务／状态 | master data read store |

## 组件（jsdom）

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [tests/components/MasterDataCapabilityFields.test.ts](../../../tests/components/MasterDataCapabilityFields.test.ts) | 组件（jsdom） | master data capability fields |

## Playwright E2E

| 文件 | 运行层／用途 | 场景或关联说明（定位用） |
| --- | --- | --- |
| [e2e/central-master-data-multifilter.spec.ts](../../../e2e/central-master-data-multifilter.spec.ts) | Playwright E2E | 客户、班组与工人具名夹具复选；核对完整命中及排除集合、未选候选保留、返回地址的精确选值和清除恢复 |
| [e2e/master-data-forms.spec.ts](../../../e2e/master-data-forms.spec.ts) | Playwright E2E | 六类主数据整页表单五档布局；两套正式客户输入、离开未保存表单及预算编辑 |
| [e2e/master-data-lists.spec.ts](../../../e2e/master-data-lists.spec.ts) | Playwright E2E | 两组具名输入经中央命令创建客户、班组和工人；五档视口检查列表与局部滚动，键盘进入真实详情及清除空筛选 |
