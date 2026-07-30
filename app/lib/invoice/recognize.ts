// 发票识别统一接口 + 桩实现(#60)——纯逻辑，vitest 直接断言。
// 调用方(store/页面)只依赖 recognizeInvoice 签名；后续批次接真 OCR 引擎(ADR 0006)时
// 只换此处的实现绑定，不改任何调用方。桩识别按文件名哈希确定性产出 mock 字段：
// 同一文件名重复识别结果一致（可测、可复现演示，日期也从 seed 派生不读时钟），
// 金额满足两位小数铁律(amount+tax=total)。
import type { RecognizeDocumentOptions } from '~/lib/recognize/engine'
import { promiseTimeout } from '@vueuse/core'
import { OcrRecognitionError, recognizeDocument } from '~/lib/recognize/engine'
import { buildInvoiceFieldConfidence, parseInvoiceText } from '~/lib/recognize/invoice-parse'
import { round2 } from '~/lib/util/number'

export interface InvoiceItem {
  name: string
  spec: string
  unit: string
  quantity: number
  unitPrice: number
  amount: number
  taxRate: string
  taxAmount: number
}

/** 识别产出的可编辑字段集 + 逐字段置信度（字段校对模式的边框色/角标/✓确认依据） */
export interface RecognizedInvoiceFields {
  invoiceType: string
  invoiceNumber: string
  invoiceDate: string
  buyer: string
  buyerTaxNo: string
  seller: string
  sellerTaxNo: string
  amount: number
  taxAmount: number
  totalAmount: number
  taxRate: string
  remark: string
  items: InvoiceItem[]
  fieldConfidence: Record<string, number>
  ocrConfidence: number
}

export interface RecognizeOptions {
  /** 识别进度回调（0~100，最后一次必为 100） */
  onProgress?: (percent: number) => void
  /** 进度节拍间隔 ms；0 = 不等待（测试用），缺省 ~120ms 模拟真识别耗时 */
  stepMs?: number
  /** 测试/宿主注入的网络边界；业务调用保持缺省，统一走同源 OCR 代理。 */
  fetch?: RecognizeDocumentOptions['fetch']
  /** 从本机 OCR 设置读取、由服务端再次白名单校验的 PaddleOCR-VL 参数。 */
  runtimeOptions?: RecognizeDocumentOptions['runtimeOptions']
}

// ── 置信度分档（OCR 设置页的"置信度分档阈值"默认值；置信度仅作参考，判决权在人）──

export const CONFIDENCE_THRESHOLDS = { ok: 0.95, warn: 0.85 } as const

export type ConfidenceTier = 'ok' | 'warn' | 'danger'

/** 置信度 → 分档；无置信度数据（人工录入/Excel 导入的字段）返回 null，不着色不出角标 */
export function confidenceTier(conf: number | null | undefined): ConfidenceTier | null {
  if (conf == null)
    return null
  if (conf >= CONFIDENCE_THRESHOLDS.ok)
    return 'ok'
  if (conf >= CONFIDENCE_THRESHOLDS.warn)
    return 'warn'
  return 'danger'
}

// ── 桩识别实现 ──

/** djb2 字符串哈希（确定性 mock 的种子来源） */
function hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++)
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return h
}

// ── 可识别的上传文件类型（唯一定义：file input 的 accept 与拖拽/选择后的过滤都从这里派生，防两处漂移）──

export const RECOGNIZABLE_FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const
export const RECOGNIZABLE_FILE_ACCEPT = RECOGNIZABLE_FILE_EXTENSIONS.map(e => `.${e}`).join(',')
const RECOGNIZABLE_FILE_RE = new RegExp(`\\.(?:${RECOGNIZABLE_FILE_EXTENSIONS.join('|')})$`, 'i')

export function isRecognizableFile(fileName: string): boolean {
  return RECOGNIZABLE_FILE_RE.test(fileName)
}

const SELLERS = [
  { name: '广州市大板东建材有限公司', taxNo: '91440101MA5CBX1234', goods: ['HRB400 螺纹钢', 'C30 商品混凝土', '水泥'] },
  { name: '汇丰水泥制品有限公司', taxNo: '91440103MA5GHI9012', goods: ['C30 商砼', 'C35 商砼', '砂浆'] },
  { name: '花城珠江电线电缆有限公司', taxNo: '91440101MA5DEF5678', goods: ['BV2.5 电线', 'YJV 电缆', 'PVC 线管'] },
  { name: '穗建五金机电经营部', taxNo: '91440104MA5JKL3456', goods: ['电动工具', '五金配件', '水管管件'] },
  { name: '鸿运建筑防水工程有限公司', taxNo: '91440106MA5MNO7890', goods: ['SBS 防水卷材', 'JS 防水涂料', '堵漏王'] },
] as const

const BUYER = { name: '广州市瑞航建筑工程有限公司', taxNo: '91440101MA9RH00001' } as const

/** 逐字段置信度的字段名全集（与 Invoice 字段名一致，供表单按 key 取数） */
export const CONFIDENCE_FIELD_KEYS = [
  'invoiceType',
  'invoiceNumber',
  'invoiceDate',
  'buyer',
  'buyerTaxNo',
  'seller',
  'sellerTaxNo',
  'amount',
  'taxAmount',
  'totalAmount',
  'taxRate',
] as const

/**
 * 强制压低置信度的候选池:amount 不在校对网格渲染(由 total−tax 派生),压低落在它身上会产出
 * UI 不可见、永远无法✓确认的黄/红字段——只从可见字段里选。
 */
const FORCEABLE_LOW_KEYS = CONFIDENCE_FIELD_KEYS.filter(k => k !== 'amount')

/**
 * 桩识别：按文件名哈希确定性产出全套字段。保证：
 * - 金额铁律：两位小数，amount + taxAmount = totalAmount 精确成立，明细行金额合计 = amount；
 * - 至少 1 个字段置信度落在 warn/danger 档（演示"黄/红字段确认后变绿"的校对流程）；
 * - 进度回调递增且以 100 收尾。
 */
export async function stubRecognizeInvoice(
  input: { fileName: string },
  options: RecognizeOptions = {},
): Promise<RecognizedInvoiceFields> {
  const { onProgress, stepMs = 120 } = options
  const seed = hash(input.fileName)

  for (const percent of [8, 23, 41, 58, 74, 89, 100]) {
    if (stepMs > 0)
      await promiseTimeout(stepMs)
    onProgress?.(percent)
  }

  const seller = SELLERS[seed % SELLERS.length]!
  // 不含税金额：8 千 ~ 20 万，两位小数
  const amount = round2(8000 + (seed % 192000) + (seed % 100) / 100)
  const taxAmount = round2(amount * 0.13)
  const totalAmount = round2(amount + taxAmount)

  // 明细 1~3 行，等分后末行吸收舍入差，保证明细金额/税额合计精确等于票面 amount/taxAmount
  const itemCount = 1 + (seed % 3)
  const perAmount = round2(amount / itemCount)
  const perTax = round2(taxAmount / itemCount)
  const items: InvoiceItem[] = Array.from({ length: itemCount }, (_, i) => {
    const isLast = i === itemCount - 1
    const itemAmount = isLast ? round2(amount - perAmount * (itemCount - 1)) : perAmount
    const itemTax = isLast ? round2(taxAmount - perTax * (itemCount - 1)) : perTax
    return {
      name: seller.goods[i % seller.goods.length]!,
      spec: ['国标', '定制', '常规'][i % 3]!,
      unit: ['吨', '批', '米'][i % 3]!,
      quantity: 1,
      unitPrice: itemAmount,
      amount: itemAmount,
      taxRate: '13%',
      taxAmount: itemTax,
    }
  })

  // 逐字段置信度：基线 0.96~0.995；按哈希强制压低 1~2 个字段到 warn/danger 档
  const fieldConfidence: Record<string, number> = {}
  for (const [i, key] of CONFIDENCE_FIELD_KEYS.entries()) {
    // 必须无符号右移 >>>：seed ≥ 2^31 时 >> 会 ToInt32 变负 → 基线跌档/负下标产出 "undefined" 键
    fieldConfidence[key] = round2(0.96 + ((seed >>> i) % 36) / 1000)
  }
  const lowKey1 = FORCEABLE_LOW_KEYS[seed % FORCEABLE_LOW_KEYS.length]!
  fieldConfidence[lowKey1] = round2(0.86 + (seed % 80) / 1000) // warn 档 (0.86~0.939)
  if (seed % 2 === 0) {
    const lowKey2 = FORCEABLE_LOW_KEYS[(seed >>> 3) % FORCEABLE_LOW_KEYS.length]!
    if (lowKey2 !== lowKey1)
      fieldConfidence[lowKey2] = round2(0.6 + (seed % 200) / 1000) // danger 档 (0.60~0.799)
  }
  const values = Object.values(fieldConfidence)
  const ocrConfidence = round2(values.reduce((s, v) => s + v, 0) / values.length)

  // 纯 seed 派生(UTC 固定锚点):不读当前时钟——同一文件名任何时刻/时区重识别结果一致(桩契约),
  // 也避开 toISOString 的 UTC 换日漂移(本地 08:00 前识别日期少一天)。
  const day = new Date(Date.UTC(2026, 5, 30) - (seed % 60) * 86400000)
  const invoiceDate = day.toISOString().slice(0, 10)

  return {
    invoiceType: seed % 3 === 0 ? '增值税普通发票' : '增值税专用发票',
    invoiceNumber: `0944${invoiceDate.slice(0, 4)}${String(seed).padStart(9, '0').slice(0, 9)}`,
    invoiceDate,
    buyer: BUYER.name,
    buyerTaxNo: BUYER.taxNo,
    seller: seller.name,
    sellerTaxNo: seller.taxNo,
    amount,
    taxAmount,
    totalAmount,
    taxRate: '13%',
    remark: items[0]!.name,
    items,
    fieldConfidence,
    ocrConfidence,
  }
}

/**
 * 真实发票识别：上传原始文件到同源代理，由 PaddleOCR-VL 产出版面 Markdown，再进入本地可测试解析器。
 * 项目提示仍保持原始文本，不在识别层强绑项目主数据；字段确认和归档继续由领域 store 负责。
 */
export async function recognizeInvoice(
  input: { file: File },
  options: RecognizeOptions = {},
): Promise<RecognizedInvoiceFields> {
  const cloud = await recognizeDocument(input.file, {
    fetch: options.fetch,
    onProgress: options.onProgress,
    runtimeOptions: options.runtimeOptions,
  })
  const parsed = parseInvoiceText(cloud.markdownPages.join('\n\n'))
  const hasUsableInvoiceData = Boolean(
    parsed.invoiceNumber
    || parsed.buyer
    || parsed.seller
    || parsed.totalAmount != null
    || parsed.items.length,
  )
  if (!hasUsableInvoiceData) {
    throw new OcrRecognitionError(
      'invalid-result',
      '未从文件中识别出可用的发票字段',
    )
  }

  const fieldConfidence = buildInvoiceFieldConfidence(parsed)
  const confidenceValues = Object.values(fieldConfidence)
  const ocrConfidence = confidenceValues.length
    ? round2(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
    : 0

  return {
    invoiceType: parsed.invoiceType,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    buyer: parsed.buyer,
    buyerTaxNo: parsed.buyerTaxNo,
    seller: parsed.seller,
    sellerTaxNo: parsed.sellerTaxNo,
    amount: parsed.amount ?? 0,
    taxAmount: parsed.taxAmount ?? 0,
    totalAmount: parsed.totalAmount ?? 0,
    taxRate: parsed.taxRate,
    remark: parsed.remark,
    items: parsed.items,
    fieldConfidence,
    ocrConfidence,
  }
}
