// 发票识别统一接口 + 桩实现(#60)——纯逻辑，vitest 直接断言。
// 调用方(store/页面)只依赖 recognizeInvoice 签名；后续批次接真 OCR 引擎(ADR 0006)时
// 只换此处的实现绑定，不改任何调用方。桩识别按文件名哈希确定性产出 mock 字段：
// 同一文件名重复识别结果一致（可测、可复现演示，日期也从 seed 派生不读时钟），
// 金额满足两位小数铁律(amount+tax=total)。
import type { RecognizeDocumentOptions } from '~/lib/recognize/engine'
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

// ── 可识别的上传文件类型（唯一定义：file input 的 accept 与拖拽/选择后的过滤都从这里派生，防两处漂移）──

export const RECOGNIZABLE_FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const
export const RECOGNIZABLE_FILE_ACCEPT = RECOGNIZABLE_FILE_EXTENSIONS.map(e => `.${e}`).join(',')
const RECOGNIZABLE_FILE_RE = new RegExp(`\\.(?:${RECOGNIZABLE_FILE_EXTENSIONS.join('|')})$`, 'i')

export function isRecognizableFile(fileName: string): boolean {
  return RECOGNIZABLE_FILE_RE.test(fileName)
}

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
