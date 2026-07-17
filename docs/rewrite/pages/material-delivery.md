# 送货单识别 — 上传·整理·识别·导出

> 路由: `/material/delivery`
> 页面: `pages/material/delivery/index.vue` → `components/delivery/DeliveryRecognitionScreen.vue`
> 来源: 现有 DeliveryView + delivery store 代码分析；2026-07-17 已接入真实 OCR 闭环

> ⚠️ **IA 重构（批D · 2026-07-11）双区拆分已定案**——本页描述的"单页平铺"形态已被拆成两个页面，权威见 CONTEXT.md「归档」词条 + `docs/dc-rebuild/README.md` 反馈轮7 D 节 + `docs/handoffs/04-批D`：
> - **处理区 = 送货单识别**（乙供材管理 · route `delivery`，本页下文的上传/整理树/识别/核对流程）：只放**待识别 / 识别中 / 待核对**；核对完成即离开处理区。
> - **归档库 = 送货单归档库**（乙供材管理 · route `deliveryArchive`，设计稿 `kit/DeliveryArchiveScreen.jsx`）：核对完成后自动归档件的**左树右列表**。左树两级 **项目 → 分供方**（分供方按其合同**签订日期升序**），每项目下设 ⚠**「未区分分供方」**兜底节点；**所有节点带文件数量角标（只数量不金额）**；点树节点出该节点文件列表。
> - **归档规则**：核对完成即自动归档，**核对是归档唯一前置**；未指定项目**禁止导入**（批量/单个同拦截）。
> - **归档不是终态**：文件可**拖拽改归属**、节点可**手动新建**（从分供方库选）+ 归档时自动建缺失节点；任何改归属/字段一律弹**二次确认**（识别难免出错，留改错通道）。
> - **分供方名模糊纠错**：识别/文件夹推断的公司名在分供方库模糊匹配 → 给建议 + 一键替换归并（识别阶段与归档后编辑通用）。
> - 下文阶段三"文件列表 + 分区"里的"单页平铺态"归档呈现**已废除**，归属拦截时机= **卡在上传**（先分区归组、后识别）；见 CONTEXT「归档」「工地」。

> ✅ **当前实现快照（2026-07-17）**：浏览器处理区已打通 PDF/PNG/JPG/JPEG 上传 → 同源服务端代理 → PaddleOCR-VL 1.6 → HTML/Markdown 表格解析 → 左原图/右字段与材料行校对 → 核对完成自动写入归档库。支持一文件多张单、供应商别名/模糊建议、工地原文预选项目、金额行级及本页合计勾稽；项目仍是归档硬前置，分供方可落“未区分分供方”。原始 `File` 仅保留在当前识别会话，Token 仅在服务端 `.env`。文件夹整理树、批量改归属和导出归档仍属后续工作，不得把下文历史蓝图误写成已完成。

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
  └─ 当前评估模式 → PaddleOCR-VL 1.6 官方 API
      ├─ useDocOrientationClassify + useDocUnwarping 自动方向/形变校正
      ├─ 输出结构化 Markdown + HTML 表格 + layout regions
      └─ 失败显式报错并允许会话内重试；不静默切换其他引擎

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

### 阶段六 · 核对完成与输出

> ⛔ 下方旧版“入库/导出两条并行路径”已废弃。当前权威口径是：**核对完成即自动归档，核对是归档唯一前置**。

| 路径 | 当前行为 |
|------|------|
| 核对完成 | 强制选择项目；把单头与材料明细写入 `delivery_records` / `delivery_lines`，立即离开处理区并进入归档库 |
| 分供方未命中 | 允许归到项目下“未区分分供方”，保留 OCR 供应商原文供后续纠正 |
| 导出 | 独立后续能力，不阻塞核对归档，也不由 OCR 完成动作隐式触发 |

---

## 二、数据模型

> ⚠️ 下列是早期完整蓝图，不是当前运行时副本。持久化模型唯一权威见 `docs/rewrite/DATABASE.md` §2.5；当前处理区会话类型见 `app/stores/delivery.ts`，不要再复制第三份字段定义。

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

当前已落地：

| 组件 | 职责 |
|------|------|
| `DeliveryRecognitionScreen` | 上传/拖拽、识别队列、主数据建议、核对归档编排 |
| `DeliveryQueuePanel` | 会话文件队列、状态/进度、单张重试与移除 |
| `DeliveryOriginalPanel` | PDF/图片原件预览，图片人工旋转辅助核对 |
| `DeliveryReviewPanel` | 多张单切换、单头/材料行编辑、金额复核与归档入口 |

以下为尚未全部落地的历史目标组件：

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
