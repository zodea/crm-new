# 送货单识别 — 上传·整理·识别·导出

> 路由: `/material/delivery`
> 页面: `pages/material/delivery.vue`
> 来源: 现有 DeliveryView + delivery store 代码分析

> ⚠️ **IA 重构（批D · 2026-07-11）双区拆分已定案**——本页描述的"单页平铺"形态已被拆成两个页面，权威见 CONTEXT.md「归档」词条 + `docs/dc-rebuild/README.md` 反馈轮7 D 节 + `docs/handoffs/04-批D`：
> - **处理区 = 送货单识别**（乙供材管理 · route `delivery`，本页下文的上传/整理树/识别/核对流程）：只放**待识别 / 识别中 / 待核对**；核对完成即离开处理区。
> - **归档库 = 送货单归档库**（乙供材管理 · route `deliveryArchive`，设计稿 `kit/DeliveryArchiveScreen.jsx`）：核对完成后自动归档件的**左树右列表**。左树两级 **项目 → 分供方**（分供方按其合同**签订日期升序**），每项目下设 ⚠**「未区分分供方」**兜底节点；**所有节点带文件数量角标（只数量不金额）**；点树节点出该节点文件列表。
> - **归档规则**：核对完成即自动归档，**核对是归档唯一前置**；未指定项目**禁止导入**（批量/单个同拦截）。
> - **归档不是终态**：文件可**拖拽改归属**、节点可**手动新建**（从分供方库选）+ 归档时自动建缺失节点；任何改归属/字段一律弹**二次确认**（识别难免出错，留改错通道）。
> - **分供方名模糊纠错**：识别/文件夹推断的公司名在分供方库模糊匹配 → 给建议 + 一键替换归并（识别阶段与归档后编辑通用）。
> - 下文阶段三"文件列表 + 分区"里的"单页平铺态"归档呈现**已废除**，归属拦截时机= **卡在上传**（先分区归组、后识别）；见 CONTEXT「归档」「工地」。

---

## 一、交互流程（六阶段）

### 阶段一 · 上传入口

```
UploadZone
  ├─ 拖拽 / 点击选文件 / 选文件夹
  ├─ 支持 PDF、PNG、JPG、BMP、WebP、GIF、TIFF
  │
  ├─ 有文件夹层级? → 进入整理树 (stageEntries)
  └─ 散文件? → 直接加入列表 (addFiles)
```

### 阶段二 · 整理树（仅文件夹上传时出现）

```
DeliveryTree
  ├─ 按文件夹名推断 工地→公司 归属
  ├─ 匹配分供方库自动识别公司名
  ├─ 拖拽：文件移组、组移工地
  ├─ 升/降级：分组 ↔ 工地互转
  │
  ├─ 确认导入 → applyStaging()：创建分区+分配文件+预填公司名
  └─ 取消 → discardStaging()
```

"重新整理"按钮可从已导入的 store 数据重建整理树（`stageFromStore()`）。

### 阶段三 · 文件列表 + 分区

```
PartitionBar: 全部 / 各工地分区切换 + 新增/重命名/删除
FileCard × N:
  左栏: 预览缩略图 + 状态 chip
  右栏: 公司名、日期、单号、明细行
  操作: 移动分区 / 识别 / 删除
```

### 阶段四 · OCR 识别

```
触发: "识别全部" 或 单张识别
  ├─ VL 已配置? → PaddleOCR-VL 云端 (_runOcrVl)
  │   失败则 fallback 本地
  └─ 未配置 → 本地 OCR (_runOcrLocal)
      识别失败尝试旋转 90°/270°

结果写入:
  ├─ 公司名（检测冲突：文件夹名 vs OCR）
  ├─ 日期、单号、明细行
  ├─ 单据类型：送货单 or 收据
  └─ 状态: done / error / ocrPartial
```

### 阶段五 · 人工校对 + 问题处理

```
FileCard 内编辑:
  修改公司名(手动覆盖) / 日期 / 单号 / 增删明细行 / 移动分区

ProblemDialog:
  识别失败→重试 / 无法读取→手动录入 / 公司冲突→三选一 / 部分识别→核对

"只看未完善" 筛选:
  缺公司 / 缺日期 / 缺单号 / 0明细行 / 待复核
```

### 阶段六 · 输出（两条并行路径）

| 路径 | 组件 | 功能 |
|------|------|------|
| A · 入库 | SaveToStorePanel | 写入 recognizedStore（键=工地+公司+单号），供分供方详情/单价对比读取 |
| B · 导出 | ExportPanel | 每分区一个子文件夹，同公司可合并PDF，生成「送货单整理汇总.xlsx」 |

两条路径互不替代，可以只做一个也可以都做。

---

## 二、数据模型

```ts
interface DeliveryFile {
  id: string
  name: string
  blob: File
  kind: 'pdf' | 'image'
  partitionId: string
  pages: PageImage[]
  rendering: boolean
  renderError: string
  company: string
  companySource: '' | 'folder' | 'ocr' | 'manual'
  companyOcr: string
  companyConflict: boolean
  specialGroup: string
  origin: string
  merge: boolean
  docs: DeliveryDoc[]
  ocrText: string
  ocrStatus: 'idle' | 'running' | 'done' | 'error'
  ocrError: string
  ocrPartial: string
  ocrEngine?: string
  itemCandidates: any[]
  project: string
  docType: '送货单' | '收据' | ''
  note: string
}

interface DeliveryDoc {
  id: string
  date: string | null
  dateText: string
  orderNo: string
  items: DeliveryItem[]
  note?: string
}

interface DeliveryItem {
  name: string
  unit: string
  quantity: string
  unitPrice: string
  total: string
}

interface Partition {
  id: string
  name: string
}
```

---

## 三、组件清单

| 组件 | 职责 |
|------|------|
| `UploadZone` | 拖拽/选择上传入口，判断文件夹/散文件分流 |
| `DeliveryTree` | 整理树 UI（工地→公司→文件拖拽分配） |
| `PartitionBar` | 分区切换 + 管理 |
| `FileCard` | 单个文件卡片（预览+编辑+状态） |
| `FieldsTable` | 明细行编辑表格 |
| `HoverZoom` | 图片悬停放大 |
| `ExportPanel` | 导出归档弹窗 |
| `SaveToStorePanel` | 入库操作弹窗 |
| `ProblemDialog` | 问题汇总弹窗 |
| `OcrGateDialog` | OCR 配置拦截弹窗 |

---

## 四、未完善检测规则

```ts
function fileIncompleteReasons(f: DeliveryFile): string[] {
  // 识别失败 / 无法读取 / 公司冲突未解决 / 部分识别
  // 公司为空 / 日期为空 / 单号为空(送货单) / 0明细行 / 待复核
  // 收据模式: 检测材料名称/单位/单价是否为空
}
```
