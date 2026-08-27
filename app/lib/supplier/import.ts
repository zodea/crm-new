import type { Supplier } from '~/stores/supplier'
import { PROJECT_SUPPLIER_FILE_CATEGORIES } from '~/lib/project-supplier/command-contract'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { toNum } from '~/lib/util/number'

export { PROJECT_SUPPLIER_FILE_CATEGORIES } from '~/lib/project-supplier/command-contract'

export type ProjectSupplierFileCategory = (typeof PROJECT_SUPPLIER_FILE_CATEGORIES)[number]
export type ProjectSupplierMatchSource = 'name' | 'alias' | 'unmatched'

export interface ProjectSupplierImportMatch {
  category: ProjectSupplierFileCategory
  supplierId: string
  supplierName: string
  matchSource: ProjectSupplierMatchSource
}

export interface ProjectSupplierImportSupplier {
  id: string
  name: string
  aliases: readonly string[]
}

export interface ProjectSupplierImportItem extends ProjectSupplierImportMatch {
  key: string
  file: File
  createSupplierConfirmed: boolean
}

const CATEGORY_KEYWORDS: Readonly<Record<ProjectSupplierFileCategory, readonly string[]>> = {
  合同: ['合同', '协议'],
  请款: ['请款', '申请款', '进度款'],
  收票: ['收票', '发票', '票据'],
  付款: ['付款', '回单', '支付'],
  结算: ['结算', '决算'],
  资质: ['资质', '证照', '营业执照'],
  其他: [],
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function comparable(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[^\p{L}\p{N}]+/gu, '')
}

export function inferProjectSupplierFileCategory(fileName: string): ProjectSupplierFileCategory {
  const normalized = comparable(fileName)
  for (const category of PROJECT_SUPPLIER_FILE_CATEGORIES) {
    if (category !== '其他' && CATEGORY_KEYWORDS[category].some(keyword => normalized.includes(comparable(keyword))))
      return category
  }
  return '其他'
}

export function inferProjectSupplierName(fileName: string, projectName = ''): string {
  const extensionless = fileName.replace(/\.[^.]+$/, '')
  let candidate = extensionless
  if (projectName)
    candidate = candidate.replaceAll(projectName, ' ')
  for (const keywords of Object.values(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords)
      candidate = candidate.replaceAll(keyword, ' ')
  }
  candidate = candidate
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/[_—–·()[\]（）【】]+/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return candidate || '待确认分供方'
}

/**
 * 仅使用本地文件名与现有分供方名称/别名做确定性匹配；不读取文件内容，也不伪装成 OCR。
 * 多个名称同时命中时取最长命中项，降低简称抢占全称的概率。
 */
export function classifyProjectSupplierImportFile(
  fileName: string,
  suppliers: readonly ProjectSupplierImportSupplier[],
  projectName = '',
): ProjectSupplierImportMatch {
  const normalizedFileName = comparable(fileName)
  const matches = suppliers.flatMap(supplier => [
    { supplier, label: supplier.name, source: 'name' as const },
    ...supplier.aliases.map(label => ({ supplier, label, source: 'alias' as const })),
  ])
    .map(match => ({ ...match, normalizedLabel: comparable(match.label) }))
    .filter(match => match.normalizedLabel.length >= 2 && normalizedFileName.includes(match.normalizedLabel))
    .sort((left, right) => right.normalizedLabel.length - left.normalizedLabel.length)

  const best = matches[0]
  return {
    category: inferProjectSupplierFileCategory(fileName),
    supplierId: best?.supplier.id ?? '',
    supplierName: best?.supplier.name ?? inferProjectSupplierName(fileName, projectName),
    matchSource: best?.source ?? 'unmatched',
  }
}

function aliases(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map(text).filter(Boolean)
  return text(value).split(/[,，;；、]/).map(part => part.trim()).filter(Boolean)
}

function assignIfPresent<K extends keyof Supplier>(
  target: Partial<Supplier>,
  row: Record<string, unknown>,
  key: K,
  normalize: (value: unknown) => Supplier[K],
): void {
  if (Object.hasOwn(row, key))
    target[key] = normalize(row[key])
}

function supplierCategory(value: unknown): Supplier['supplierCategory'] {
  const category = text(value)
  return SUPPLIER_CATEGORIES.includes(category as (typeof SUPPLIER_CATEGORIES)[number])
    ? category
    : '其他'
}

/** 映射页签行 → 分供方 store 可写数据；拒绝空名并归一枚举、别名、数值。 */
export function normalizeSupplierImportRow(row: Record<string, unknown>): Partial<Supplier> {
  const name = text(row.name)
  if (!name)
    throw new Error('公司全称不能为空')

  const data: Partial<Supplier> = {
    name,
    source: 'excel',
  }

  assignIfPresent(data, row, 'externalRef', text)
  assignIfPresent(data, row, 'aliases', aliases)
  assignIfPresent(data, row, 'supplierCategory', supplierCategory)
  assignIfPresent(data, row, 'uniqueCode', text)
  assignIfPresent(data, row, 'taxNo', text)
  assignIfPresent(data, row, 'legalRep', text)
  assignIfPresent(data, row, 'registeredCapital', toNum)
  assignIfPresent(data, row, 'registeredDate', text)
  assignIfPresent(data, row, 'address', text)
  assignIfPresent(data, row, 'mainBusiness', text)
  assignIfPresent(data, row, 'businessType', text)
  assignIfPresent(data, row, 'invoiceName', text)
  assignIfPresent(data, row, 'taxpayerType', text)
  assignIfPresent(data, row, 'bank', text)
  assignIfPresent(data, row, 'bankAccount', text)
  assignIfPresent(data, row, 'invoiceAddress', text)
  assignIfPresent(data, row, 'phone', text)
  assignIfPresent(data, row, 'contact', text)
  assignIfPresent(data, row, 'contactPhone', text)
  assignIfPresent(data, row, 'rating', text)
  assignIfPresent(data, row, 'note', text)

  return data
}

/** 仅用于新增导入；重导更新不能套默认值，否则会覆盖未映射的既有资料。 */
export function withSupplierImportCreateDefaults(data: Partial<Supplier>): Partial<Supplier> {
  return {
    aliases: [],
    supplierCategory: '其他',
    credentialStatus: 'incomplete',
    ...data,
  }
}
