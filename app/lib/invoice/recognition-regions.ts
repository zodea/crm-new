// 识别字段 → 发票原图区域（用户 2026-10-14 需求：重新识别比对与首次识别点字段定位）。纯函数，vitest 直接断言。
// 坐标唯一来源是本次 PaddleOCR-VL 结果的版面块（prunedResult.parsing_res_list 的 block_bbox），
// 精度只到块：字段值在哪个块的文本里出现，就框住整块；块内没有字段级坐标，不推算、不造框。
// 区域只在内存中：重新识别随草稿，首次识别随上传会话中的原文件，都不入库。
import type { InvoiceRecognitionField, InvoiceRecognitionFieldMark } from './recognition-changes'
import type { OcrRecognitionPage } from '~/lib/recognize/engine'

/** 相对页面宽高的 0~1 坐标（左上原点），与预览缩放无关。 */
export interface NormalizedBox {
  x: number
  y: number
  width: number
  height: number
}

export interface InvoiceFieldRegion {
  /** 与 OCR 页序一致：图片恒为 0，PDF 为页码 - 1 */
  pageIndex: number
  box: NormalizedBox
  /** 版面块类型（text / table …），说明框住的是整块 */
  blockLabel: string
}

export type InvoiceFieldRegions = Readonly<Record<string, InvoiceFieldRegion>>

export type PreviewRotation = 0 | 90 | 180 | 270

interface OcrBlock {
  pageIndex: number
  blockLabel: string
  box: NormalizedBox
  /** 去空白的文本（公司名、票号、税号等连续文本匹配） */
  compact: string
  /** 空白折叠为单空格、去千分位与货币符号（金额、日期、税率按数字边界匹配） */
  spaced: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

/** block_bbox 支持 [x1,y1,x2,y2]、扁平多点 [x,y,...] 与点列 [[x,y],...]，多点取外接矩形。 */
function bboxPoints(raw: unknown): Array<[number, number]> | null {
  if (!Array.isArray(raw) || !raw.length)
    return null
  const flat = raw.every(item => Array.isArray(item))
    ? (raw as unknown[][]).flatMap(point => point.slice(0, 2))
    : raw
  if (flat.length < 4 || flat.length % 2 !== 0 || !flat.every(item => typeof item === 'number' && Number.isFinite(item)))
    return null
  const numbers = flat as number[]
  const points: Array<[number, number]> = []
  for (let index = 0; index < numbers.length; index += 2)
    points.push([numbers[index]!, numbers[index + 1]!])
  return points
}

function normalizedBox(raw: unknown, width: number, height: number): NormalizedBox | null {
  const points = bboxPoints(raw)
  if (!points)
    return null
  const xs = points.map(([x]) => clamp01(x / width))
  const ys = points.map(([, y]) => clamp01(y / height))
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const box = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  return box.width > 0 && box.height > 0 ? box : null
}

/**
 * 页面几何：需要 prunedResult 的 width/height 才能归一化。方向分类把整页转 180° 时框按原图翻回；
 * 转 90°/270° 时上游的宽高与框所在坐标系无法从结果中可靠判定，整页不定位（如实显示“原图未定位”）。
 */
function pageGeometry(prunedResult: unknown) {
  if (!isRecord(prunedResult))
    return null
  const width = positive(prunedResult.width)
  const height = positive(prunedResult.height)
  if (!width || !height)
    return null
  const preprocess = prunedResult.doc_preprocessor_res
  const angle = isRecord(preprocess) && typeof preprocess.angle === 'number' ? preprocess.angle : 0
  if (angle !== 0 && angle !== -1 && angle !== 180)
    return null
  return { width, height, flipped: angle === 180 }
}

function blockText(raw: string) {
  const plain = raw
    .replace(/<br\s*(?:\/\s*)?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .normalize('NFKC')
    .toUpperCase()
  return {
    compact: plain.replace(/\s+/g, ''),
    spaced: plain
      .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '')
      .replace(/¥/g, ' ')
      .replace(/\s+/g, ' '),
  }
}

function ocrBlocks(pages: readonly OcrRecognitionPage[]): OcrBlock[] {
  return pages.flatMap((page) => {
    const geometry = pageGeometry(page.prunedResult)
    if (!geometry)
      return []
    return page.layoutRegions.flatMap((region) => {
      if (!isRecord(region) || typeof region.block_content !== 'string')
        return []
      const box = normalizedBox(region.block_bbox, geometry.width, geometry.height)
      if (!box)
        return []
      return [{
        pageIndex: page.pageIndex,
        blockLabel: typeof region.block_label === 'string' ? region.block_label : 'text',
        box: geometry.flipped ? rotateNormalizedBox(box, 180) : box,
        ...blockText(region.block_content),
      }]
    })
  })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizedValue(value: unknown) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/\s+/g, '')
}

type BlockTest = (block: OcrBlock) => boolean

function containsText(value: unknown): BlockTest | null {
  const text = normalizedValue(value)
  return text.length >= 2 ? block => block.compact.includes(text) : null
}

function containsCode(value: unknown): BlockTest | null {
  const code = normalizedValue(value)
  if (code.length < 6)
    return null
  const pattern = new RegExp(`(?<![0-9A-Z])${escapeRegExp(code)}(?![0-9A-Z])`)
  return block => pattern.test(block.compact)
}

function containsMoney(value: unknown): BlockTest | null {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount) || amount === 0)
    return null
  const pattern = new RegExp(`(?<![\\d.])${escapeRegExp(amount.toFixed(2))}(?!\\d)`)
  return block => pattern.test(block.spaced)
}

function containsRate(value: unknown): BlockTest | null {
  const rate = normalizedValue(value).match(/^(\d+(?:\.\d+)?)%$/)?.[1]
  if (!rate)
    return null
  const pattern = new RegExp(`(?<![\\d.])${escapeRegExp(rate)} ?%`)
  return block => pattern.test(block.spaced)
}

function containsDate(value: unknown): BlockTest | null {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match)
    return null
  const [year, month, day] = [match[1]!, String(Number(match[2])), String(Number(match[3]))]
  const pattern = new RegExp(
    `(?<!\\d)${year} ?年 ?0?${month} ?月 ?0?${day} ?日|(?<!\\d)${year} ?[-/.] ?0?${month} ?[-/.] ?0?${day}(?!\\d)`,
  )
  return block => pattern.test(block.spaced)
}

/** 每个字段的匹配方式，以及同值出现在多个块时用来消歧的票面标签。 */
const FIELD_LOCATORS: Record<string, { test: (value: unknown) => BlockTest | null, hint?: RegExp }> = {
  invoiceNumber: { test: containsCode, hint: /发票号码|票据号码/ },
  invoiceDate: { test: containsDate, hint: /开票日期/ },
  buyer: { test: containsText, hint: /购买方|购方|买方/ },
  buyerTaxNo: { test: containsCode, hint: /购买方|购方|买方/ },
  seller: { test: containsText, hint: /销售方|销方|卖方/ },
  sellerTaxNo: { test: containsCode, hint: /销售方|销方|卖方/ },
  invoiceType: { test: containsText },
  totalAmount: { test: containsMoney, hint: /价税合计|小写/ },
  taxAmount: { test: containsMoney, hint: /税额/ },
  taxRate: { test: containsRate, hint: /税率|征收率/ },
  remark: { test: containsText, hint: /备注/ },
}

/**
 * 把识别结果的字段值映射到 OCR 版面块：值只出现在一个块 → 该块；出现在多个块 → 仅保留带字段标签的块，
 * 仍不唯一则不定位。空值、零金额、未出现在任何块中的值都不定位。
 */
export function locateInvoiceFieldRegions(
  pages: readonly OcrRecognitionPage[],
  values: object,
  fields: readonly InvoiceRecognitionField[],
): Record<string, InvoiceFieldRegion> {
  const blocks = ocrBlocks(pages)
  if (!blocks.length)
    return {}
  const regions: Record<string, InvoiceFieldRegion> = {}
  for (const { key } of fields) {
    const locator = FIELD_LOCATORS[key]
    const test = locator?.test((values as Record<string, unknown>)[key])
    if (!locator || !test)
      continue
    let matched = blocks.filter(test)
    if (matched.length > 1)
      matched = locator.hint ? matched.filter(block => locator.hint!.test(block.compact)) : []
    const block = matched.length === 1 ? matched[0] : undefined
    if (block)
      regions[key] = { pageIndex: block.pageIndex, box: block.box, blockLabel: block.blockLabel }
  }
  return regions
}

/** 预览顺时针旋转后，框在旋转后画框中的位置（仍为 0~1）。 */
export function rotateNormalizedBox(box: NormalizedBox, rotation: PreviewRotation): NormalizedBox {
  switch (rotation) {
    case 90:
      return { x: 1 - box.y - box.height, y: box.x, width: box.height, height: box.width }
    case 180:
      return { x: 1 - box.x - box.width, y: 1 - box.y - box.height, width: box.width, height: box.height }
    case 270:
      return { x: box.y, y: 1 - box.x - box.width, width: box.height, height: box.width }
    default:
      return box
  }
}

/**
 * 旋转后的画框：宽高比（宽 / 高），以及未旋转图片相对画框的宽高百分比（图片居中后再旋转）。
 * 缩放只改变画框宽度，框以百分比定位，随之同步。
 */
export function rotatedFrame(size: { width: number, height: number }, rotation: PreviewRotation) {
  if (rotation % 180 === 0)
    return { aspectRatio: size.width / size.height, imageWidth: 100, imageHeight: 100 }
  return {
    aspectRatio: size.height / size.width,
    imageWidth: size.width / size.height * 100,
    imageHeight: size.height / size.width * 100,
  }
}

export interface InvoiceRegionHighlightGroup {
  id: string
  pageIndex: number
  box: NormalizedBox
  keys: string[]
  labels: string[]
}

/**
 * 原图高亮清单：只取有识别标记（识别变动 / 已人工修改）的字段；落在同一块的字段合并为一个框，
 * 标签列出全部字段名；定位不到的字段单列，界面说明“原图未定位”。
 */
export function invoiceRegionHighlights(
  fields: readonly InvoiceRecognitionField[],
  marks: Readonly<Record<string, InvoiceRecognitionFieldMark>>,
  regions: InvoiceFieldRegions | undefined,
) {
  const groups = new Map<string, InvoiceRegionHighlightGroup>()
  const unlocated: InvoiceRecognitionField[] = []
  for (const { key, label } of fields) {
    if (!marks[key])
      continue
    const region = regions?.[key]
    if (!region) {
      unlocated.push({ key, label })
      continue
    }
    const { x, y, width, height } = region.box
    const id = [region.pageIndex, ...[x, y, width, height].map(value => value.toFixed(4))].join(':')
    const group = groups.get(id)
    if (group) {
      group.keys.push(key)
      group.labels.push(label)
    }
    else {
      groups.set(id, { id, pageIndex: region.pageIndex, box: region.box, keys: [key], labels: [label] })
    }
  }
  return { groups: [...groups.values()], unlocated }
}

/**
 * 首次识别的点字段定位：只给当前聚焦 / 悬停的字段造一个强调框（不常驻，同块其他字段不连带标注）；
 * 定位不到的识别字段单列，聚焦时说明“原图未定位”。
 */
export function invoiceRegionFocus(
  fields: readonly InvoiceRecognitionField[],
  regions: InvoiceFieldRegions | undefined,
  activeKey: string | null | undefined,
) {
  const unlocated = fields.filter(field => !regions?.[field.key])
  const active = activeKey ? fields.find(field => field.key === activeKey) : undefined
  const region = active ? regions?.[active.key] : undefined
  const groups: InvoiceRegionHighlightGroup[] = active && region
    ? [{ id: `focus:${active.key}`, pageIndex: region.pageIndex, box: region.box, keys: [active.key], labels: [active.label] }]
    : []
  return { groups, unlocated }
}
