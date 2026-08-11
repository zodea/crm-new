#!/usr/bin/env node

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const SUPPORTED_EXTENSIONS = new Map([
  ['.pdf', 'pdf'],
  ['.png', 'image'],
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
])

const DOCUMENT_TYPE_RULES = [
  {
    type: 'invoice',
    keywords: ['发票', 'invoice', '税票'],
  },
  {
    type: 'delivery',
    keywords: ['送货', '送货单', 'delivery', '收料单', '入库单'],
  },
]

const COMPARISON_FIELDS = {
  invoice: [
    'invoiceNumber',
    'invoiceDate',
    'buyerName',
    'buyerTaxNumber',
    'sellerName',
    'sellerTaxNumber',
    'amountWithoutTax',
    'taxAmount',
    'totalAmount',
  ],
  delivery: [
    'projectName',
    'supplierName',
    'deliveryDate',
    'orderNo',
    'receiver',
    'siteName',
  ],
  unknown: [],
}

const COMPARISON_LINE_FIELDS = [
  'materialName',
  'specification',
  'unit',
  'quantity',
  'unitPrice',
  'amount',
]

function parseArgs(argv) {
  const options = {
    root: '需过滤文件夹',
    mode: 'representative',
    perGroup: 2,
    output: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--root') {
      options.root = argv[++index]
    }
    else if (argument === '--mode') {
      options.mode = argv[++index]
    }
    else if (argument === '--per-group') {
      options.perGroup = Number(argv[++index])
    }
    else if (argument === '--output') {
      options.output = argv[++index]
    }
    else if (argument === '--help' || argument === '-h') {
      options.help = true
    }
    else {
      throw new Error(`未知参数：${argument}`)
    }
  }

  if (!['representative', 'all'].includes(options.mode))
    throw new Error('--mode 只能是 representative 或 all')
  if (!Number.isInteger(options.perGroup) || options.perGroup < 1)
    throw new Error('--per-group 必须是大于 0 的整数')
  if (options.output) {
    if (!isAbsolute(options.output))
      throw new Error('--output 必须使用绝对路径，避免误写入仓库')
    const workspaceRoot = resolve(process.cwd())
    const outputPath = resolve(options.output)
    const workspaceVolume = parse(workspaceRoot).root.toLocaleLowerCase('zh-CN')
    const outputVolume = parse(outputPath).root.toLocaleLowerCase('zh-CN')
    const workspaceRelativeOutput = relative(workspaceRoot, outputPath)
    const isOutsideWorkspace = workspaceVolume !== outputVolume
      || (workspaceRelativeOutput !== ''
        && (workspaceRelativeOutput.startsWith(`..${sep}`) || workspaceRelativeOutput === '..'))
    if (!isOutsideWorkspace)
      throw new Error('--output 必须写入仓库外的临时目录；默认直接输出到终端')
  }

  return options
}

function helpText() {
  return [
    '本地 OCR 样本验收清单工具（只扫描文件名与文件属性，不调用 OCR API）',
    '',
    '用法：',
    '  node scripts/ocr-sample-acceptance.mjs [选项]',
    '',
    '选项：',
    '  --root <目录>          样本根目录，默认：需过滤文件夹',
    '  --mode representative  每个“单据类型 × 文件格式”取代表样本，默认模式',
    '  --mode all             输出全部支持的样本清单（仍不调用 OCR）',
    '  --per-group <数字>     代表模式每组数量，默认：2',
    '  --output <绝对路径>    将 JSON 写入仓库外的临时目录；不传则只输出终端',
  ].join('\n')
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath))
    }
    else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

function normalizeForMatching(value) {
  return value.toLocaleLowerCase('zh-CN')
}

function classifyDocument(relativePath) {
  const matchingPath = normalizeForMatching(relativePath)
  const matches = DOCUMENT_TYPE_RULES
    .filter(rule => rule.keywords.some(keyword => matchingPath.includes(normalizeForMatching(keyword))))
    .map(rule => rule.type)

  if (matches.length === 1)
    return matches[0]
  return 'unknown'
}

function classifyFormat(filePath) {
  return SUPPORTED_EXTENSIONS.get(extname(filePath).toLocaleLowerCase('zh-CN')) ?? null
}

function scenarioTags(relativePath) {
  const value = normalizeForMatching(relativePath)
  const tags = []
  if (/手写|手填|handwritten/.test(value)) {
    tags.push('handwritten')
  }
  if (/旋转|横向|竖向|方向|rotate|orientation/.test(value)) {
    tags.push('orientation')
  }
  if (/多页|合并|multi.?page/.test(value)) {
    tags.push('multi-page')
  }
  if (/扫描|scan/.test(value)) {
    tags.push('scanned')
  }
  return tags
}

function createFieldComparison(fieldName) {
  return {
    field: fieldName,
    sourceValue: null,
    recognizedValue: null,
    status: 'pending',
    difference: null,
  }
}

function createComparisonSkeleton(documentType) {
  return {
    status: 'pending',
    reviewer: 'ai-assisted-manual-review',
    note: '待识别功能完成后填入原件对照结果；本工具不读取原始 OCR 内容。',
    fields: (COMPARISON_FIELDS[documentType] ?? []).map(createFieldComparison),
    lineItems: [],
    differences: [],
  }
}

function createSampleRecord(filePath, rootDirectory) {
  const relativePath = relative(rootDirectory, filePath)
  const format = classifyFormat(filePath)
  const documentType = classifyDocument(relativePath)
  return {
    id: `${documentType}:${format}:${relativePath}`,
    relativePath: relativePath.split(sep).join('/'),
    fileName: basename(filePath),
    documentType,
    format,
    sizeBytes: null,
    scenarioTags: scenarioTags(relativePath),
    comparison: createComparisonSkeleton(documentType),
  }
}

function sampleGroupKey(sample) {
  return `${sample.documentType}:${sample.format}`
}

function selectRepresentativeSamples(samples, perGroup) {
  const groups = new Map()
  for (const sample of samples) {
    const key = sampleGroupKey(sample)
    const group = groups.get(key) ?? []
    group.push(sample)
    groups.set(key, group)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .flatMap(([, group]) => {
      const tagged = group.filter(sample => sample.scenarioTags.length > 0)
      const untagged = group.filter(sample => sample.scenarioTags.length === 0)
      return [...tagged, ...untagged].slice(0, perGroup)
    })
}

function summarize(samples, selectedSamples, rootDirectory, mode) {
  const byTypeAndFormat = {}
  for (const sample of samples) {
    const key = sampleGroupKey(sample)
    byTypeAndFormat[key] = (byTypeAndFormat[key] ?? 0) + 1
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    sourceRoot: rootDirectory,
    safety: {
      callsOcrApi: false,
      includesRawOcr: false,
      includesFileContent: false,
      productDataMutation: false,
    },
    totals: {
      supportedFiles: samples.length,
      selectedFiles: selectedSamples.length,
      unknownDocumentType: samples.filter(sample => sample.documentType === 'unknown').length,
    },
    counts: byTypeAndFormat,
    comparisonContract: {
      fieldStatus: ['pending', 'match', 'mismatch', 'needs-review'],
      lineItemFields: COMPARISON_LINE_FIELDS,
      differences: '只记录差异摘要与待复核字段，不写入完整 OCR 原文。',
    },
    samples: selectedSamples,
  }
}

async function buildReport({ root, mode, perGroup }) {
  const rootDirectory = resolve(root)
  const filePaths = await walkFiles(rootDirectory)
  const supportedSamples = []

  for (const filePath of filePaths) {
    if (!classifyFormat(filePath))
      continue
    const sample = createSampleRecord(filePath, rootDirectory)
    const fileStats = await stat(filePath)
    sample.sizeBytes = fileStats.size
    supportedSamples.push(sample)
  }

  const selectedSamples = mode === 'all'
    ? supportedSamples
    : selectRepresentativeSamples(supportedSamples, perGroup)
  return summarize(supportedSamples, selectedSamples, rootDirectory, mode)
}

export {
  buildReport,
  classifyDocument,
  classifyFormat,
  createComparisonSkeleton,
  createSampleRecord,
  selectRepresentativeSamples,
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(helpText())
      process.exit(0)
    }

    const report = await buildReport(options)
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true })
      await writeFile(options.output, serialized, 'utf8')
      console.error(`OCR 样本验收清单已写入仓库外路径：${options.output}`)
    }
    else {
      console.log(serialized)
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
