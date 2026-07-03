# InvoiceView 数据/交互冲突修复

> 日期：2025-06-25
> 修改文件：`src/views/InvoiceView.vue`
> 对应 design.md 章节：§ 4 发票页 InvoiceView

---

## 修复前问题

### 问题 1（严重）：review tab 数据范围包含 posted 发票

`recognizedItems` 从 `allSorted` 派生，只过滤 `status === "done"`，**没有排除已入账**。
导致 stageTabs 中"发票识别与校对"的计数 = "待入账" + "已入账" 之和，数字对不上。

```
修复前：
  文档识别状态 28  |  发票识别与校对 20  |  待入账 12  |  已入账 8
                    ↑ 20 = 12 + 8 （包含了已入账！）
```

### 问题 2：review 内子筛选和顶级 Tab 重复

review 模式内部有 `reviewFilterOptions`（全部/待入账/已入账/提取不全），
和顶部的独立"待入账""已入账" Tab 做相同的事。

### 问题 3：编辑入口不统一

- status 表点击行 → `editSingle()` 切到 review 内嵌校对
- pending 表点编辑 → `router.push('/invoice/:id')` 跳 InvoiceDetailView
- posted 表点编辑 → 也跳 InvoiceDetailView
- 两套编辑体验互相矛盾

---

## 修复内容

### 1. `recognizedItems` 排除已入账

```diff
- const recognizedItems = computed(() =>
-   allSorted.value.filter((item) => item.inv.status === "done"));
+ const recognizedItems = computed(() =>
+   allSorted.value.filter((item) => item.inv.status === "done" && item.inv.accountStatus !== "posted"));
```

### 2. `postedItems` 独立从 `allSorted` 派生

```diff
- const pendingItems = computed(() => recognizedItems.value.filter((item) => item.inv.accountStatus !== "posted"));
- const postedItems = computed(() => recognizedItems.value.filter((item) => item.inv.accountStatus === "posted"));
+ const pendingItems = computed(() => recognizedItems.value);
+ const postedItems = computed(() => allSorted.value.filter((item) => item.inv.status === "done" && item.inv.accountStatus === "posted"));
```

### 3. 砍掉 review 内 pending/posted 子筛选

只保留"全部"和"提取不全"两个筛选项。

### 4. 统一编辑入口

pending/posted 表的编辑按钮改为 `editSingle(item.inv)`，统一进入 review 三栏内嵌校对。

---

## 修复后数据分区

```
修复后（数据互斥）：
  文档识别状态 28  |  校对 12  |  待入账 12  |  已入账 8
  ↑ 所有未入账       ↑ done+未入账            ↑ done+已入账
  （含未识别的）      （与待入账同源）
```

### 四个 Tab 的数据边界

| Tab | 数据过滤条件 | 用途 |
|-----|-------------|------|
| 文档识别状态 | `accountStatus ≠ posted`（所有未入账） | 上传、识别、文件管理 |
| 发票识别与校对 | `status = done && accountStatus ≠ posted` | 逐张校对编辑字段 |
| 待入账 | 同上（与校对同源数据，不同 UI） | 批量入账操作 |
| 已入账 | `status = done && accountStatus = posted` | 归档、查阅 |

### 遗留：校对 vs 待入账 计数相同

当前数据模型没有"校对完成"中间状态，`recognizedItems` 和 `pendingItems` 数据一致。
两个 Tab 定位不同——校对是三栏编辑 UI，待入账是平铺表格批量操作 UI。
如果后续需要区分，可以在 Invoice 类型上增加 `reviewedAt?: string` 字段标记校对完成。

---

## design.md 需同步更新的段落

### § 4.1 阶段导航

```
┌─ sticky 阶段 tab ──────────────────────────────────────────────────────┐
│  [文档识别状态 28]  [发票识别与校对 12]  [待入账 12]  [已入账 8]            │
│                     ↑ 仅 done+未入账      ↑ 同源       ↑ done+已入账     │
└────────────────────────────────────────────────────────────────────────┘
```

### § 4.4 左栏 review 筛选

删除"待入账/已入账"子筛选，只保留：
- 全部
- 提取不全（`isInvoiceIncomplete`）

### § 4.5 待入账操作列

编辑按钮改为切到 review tab（`editSingle`），不再跳 `/invoice/:id`。

### § 4.6 已入账操作列

同上，编辑按钮统一为 `editSingle`。
