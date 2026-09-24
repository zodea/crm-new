import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { buildReport } from './ocr-sample-acceptance.mjs'

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

const DEFAULT_MAX_RATE_LIMIT_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 15_000
const DEFAULT_MAX_RETRY_DELAY_MS = 120_000
const DEFAULT_REQUEST_DELAY_MS = 1_000

const CONTENT_CLASSIFICATION_RULES = [
  {
    type: 'invoice',
    keywords: ['发票号码', '发票代码', '增值税专用发票', '增值税普通发票', '购买方', '购方', '销售方', '销方', '价税合计', '税额', '开票日期'],
  },
  {
    type: 'delivery',
    keywords: ['送货单', '收料单', '收货单', '入库单', '供货单位', '发货单位', '收货单位', '收货人', '送货日期', '到货', '验收'],
  },
  {
    type: 'contract',
    keywords: ['合同', '补充协议', '协议书', '合同编号', '甲方', '乙方', '签订日期', '履行期限', '违约责任', '采购合同', '供货合同'],
  },
  {
    type: 'certificate',
    keywords: ['营业执照', '统一社会信用代码', '法定代表人', '注册资本', '经营范围', '开户许可证', '资质证书', '许可证', '公司资料', '身份证', '居民身份证', '公民身份号码'],
  },
  {
    type: 'other',
    keywords: ['报价单', '对账单', '结算单', '付款申请', '银行回单', '验收报告', '会议纪要', '项目清单', '移交单', '移交记录', '交接单', '入户门'],
  },
]

const RECOGNITION_ERROR_CODES = new Set([
  'job-failed',
  'invalid-result',
  'invalid-response',
])

function parseArgs(argv) {
  const options = {
    root: '需过滤文件夹',
    mode: 'representative',
    perGroup: 1,
    concurrency: 1,
    maxRateLimitRetries: DEFAULT_MAX_RATE_LIMIT_RETRIES,
    retryBaseMs: DEFAULT_RETRY_BASE_MS,
    maxRetryDelayMs: DEFAULT_MAX_RETRY_DELAY_MS,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    baseUrl: 'http://localhost:3100',
    output: join(process.env.TEMP || process.env.TMP || '.', 'crm-new-ocr-sample-run'),
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
    else if (argument === '--concurrency') {
      options.concurrency = Number(argv[++index])
    }
    else if (argument === '--max-rate-limit-retries') {
      options.maxRateLimitRetries = Number(argv[++index])
    }
    else if (argument === '--retry-base-ms') {
      options.retryBaseMs = Number(argv[++index])
    }
    else if (argument === '--max-retry-delay-ms') {
      options.maxRetryDelayMs = Number(argv[++index])
    }
    else if (argument === '--request-delay-ms') {
      options.requestDelayMs = Number(argv[++index])
    }
    else if (argument === '--base-url') {
      options.baseUrl = argv[++index]
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
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1)
    throw new Error('--concurrency 必须是大于 0 的整数')
  if (!Number.isInteger(options.maxRateLimitRetries) || options.maxRateLimitRetries < 0)
    throw new Error('--max-rate-limit-retries 必须是大于等于 0 的整数')
  for (const [name, value] of [
    ['--retry-base-ms', options.retryBaseMs],
    ['--max-retry-delay-ms', options.maxRetryDelayMs],
    ['--request-delay-ms', options.requestDelayMs],
  ]) {
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`${name} 必须是大于等于 0 的整数`)
  }
  if (options.maxRetryDelayMs < options.retryBaseMs)
    throw new Error('--max-retry-delay-ms 不能小于 --retry-base-ms')
  if (!isAbsolute(options.output))
    throw new Error('--output 必须使用绝对路径，且应位于仓库外临时目录')

  const workspaceRoot = resolve(process.cwd())
  const outputPath = resolve(options.output)
  const workspaceVolume = parse(workspaceRoot).root.toLocaleLowerCase('zh-CN')
  const outputVolume = parse(outputPath).root.toLocaleLowerCase('zh-CN')
  const workspaceRelativeOutput = relative(workspaceRoot, outputPath)
  const isOutsideWorkspace = workspaceVolume !== outputVolume
    || (workspaceRelativeOutput !== ''
      && (workspaceRelativeOutput.startsWith(`..${sep}`) || workspaceRelativeOutput === '..'))
  if (!isOutsideWorkspace)
    throw new Error('--output 必须写入仓库外的临时目录；不会把原始 OCR 结果写回仓库')

  return options
}

function helpText() {
  return [
    '本地 OCR 真实样本运行器（通过本地 Nuxt 服务端代理调用官方 PaddleOCR）',
    '',
    '安全边界：不读取、不接收、不输出 Access Token；原始 OCR JSON 仅写到仓库外临时目录。',
    '',
    '用法：',
    '  node scripts/ocr-sample-runner.mjs [选项]',
    '',
    '选项：',
    '  --root <目录>          样本根目录，默认：需过滤文件夹',
    '  --mode representative  代表样本模式，默认每组 1 个',
    '  --mode all             全量样本模式',
    '  --per-group <数字>     代表模式每组数量，默认：1',
    '  --concurrency <数字>   并发请求数，默认：1；建议保持较低值避免触发接口限流',
    '  --max-rate-limit-retries <数字> 429 限流自动重试次数，默认：2；耗尽后标记 pending-retry',
    '  --retry-base-ms <数字> 限流退避基数，默认：15000；按指数退避',
    '  --max-retry-delay-ms <数字> 单次退避上限，默认：120000',
    '  --request-delay-ms <数字> 请求启动间隔，默认：1000；用于降低突发并发',
    '  --base-url <地址>      本地 Nuxt 地址，默认：http://localhost:3100',
    '  --output <绝对路径>    仓库外临时目录，默认：系统 TEMP/crm-new-ocr-sample-run',
  ].join('\n')
}

function compactText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function roundConfidence(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function classifyContent(text) {
  const normalizedText = String(text ?? '').toLocaleLowerCase('zh-CN')
  const ranked = CONTENT_CLASSIFICATION_RULES
    .map((rule) => {
      const evidenceKeywords = rule.keywords.filter(keyword =>
        normalizedText.includes(keyword.toLocaleLowerCase('zh-CN')),
      )
      return {
        type: rule.type,
        evidenceKeywords,
        score: evidenceKeywords.length,
      }
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.type.localeCompare(right.type, 'en'))

  const best = ranked[0]
  if (!best) {
    return {
      type: 'unknown',
      confidence: 0,
      evidenceKeywords: [],
      candidates: [],
      needsReview: true,
      source: 'ocr-content',
    }
  }

  const second = ranked[1]
  const ambiguous = Boolean(second && second.score === best.score)
  const lowEvidence = best.score < 2
  const type = ambiguous ? 'unknown' : best.type
  const confidence = ambiguous
    ? 0.35
    : roundConfidence(Math.min(0.96, 0.45 + best.score * 0.12))

  return {
    type,
    confidence,
    evidenceKeywords: best.evidenceKeywords,
    candidates: ranked.slice(0, 3).map(candidate => ({
      type: candidate.type,
      evidenceKeywords: candidate.evidenceKeywords,
      score: candidate.score,
    })),
    needsReview: ambiguous || lowEvidence || best.type === 'other',
    source: 'ocr-content',
  }
}

function compareClassifications(folderClassification, contentClassification) {
  const folderType = folderClassification?.type ?? 'unknown'
  const contentType = contentClassification?.type ?? 'unknown'
  if (folderType !== 'unknown' && contentType !== 'unknown' && folderType !== contentType) {
    return {
      status: 'conflict',
      kind: 'folder-content-mismatch',
      folderType,
      contentType,
      needsReview: true,
      suggestionAction: '保留原文件位置，仅标记待复核；不要自动移动原件或写入业务数据。',
    }
  }
  if (folderType === 'unknown' && contentType !== 'unknown') {
    return {
      status: 'needs-review',
      kind: 'folder-unclassified',
      folderType,
      contentType,
      needsReview: true,
      suggestionAction: '目录分类不明确，人工确认后再决定归档位置；不要自动移动原件。',
    }
  }
  if (folderType !== 'unknown' && contentType === 'unknown') {
    return {
      status: 'needs-review',
      kind: 'content-unclassified',
      folderType,
      contentType,
      needsReview: true,
      suggestionAction: 'OCR 内容证据不足，保留目录候选并人工查看原件；不要据此写入业务数据。',
    }
  }
  const needsReview = Boolean(folderClassification?.needsReview || contentClassification?.needsReview)
  return {
    status: needsReview ? 'needs-review' : 'consistent',
    kind: null,
    folderType,
    contentType,
    needsReview,
    suggestionAction: needsReview
      ? '目录与内容候选暂未冲突，但证据不足或存在低置信信号；保留原文件并人工复核。'
      : null,
  }
}

function dateHints(text) {
  return unique([...text.matchAll(/20\d{2}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}/g)]
    .map(match => match[0].replace(/[年月./]/g, '-').replace(/-+/g, '-').replace(/-$/, '')))
}

function labeledHints(text, labelPattern) {
  const values = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(labelPattern)
    if (match?.[1])
      values.push(compactText(match[1]))
  }
  return unique(values)
}

function amountHints(text) {
  const values = []
  const amountPattern = /(?:价税合计|含税金额|不含税金额|合计|总金额|金额|税额)\D{0,12}[\d,]+(?:\.\d{1,2})?/g
  for (const match of text.matchAll(amountPattern)) {
    const value = match[0].match(/[\d,]+(?:\.\d{1,2})?/)?.[0]
    if (value)
      values.push(value.replaceAll(',', ''))
  }
  return unique(values)
}

function lineItemCount(text) {
  const markdownRows = [...text.matchAll(/^\s*\|[^\n]*\|\s*$/gm)]
  const htmlRows = [...text.matchAll(/<tr\b[^>]*>/gi)]
  return Math.max(0, markdownRows.length - 2) + htmlRows.length
}

function ocrMarkdownPages(payload) {
  return Array.isArray(payload?.markdownPages)
    ? payload.markdownPages.filter(value => typeof value === 'string')
    : Array.isArray(payload?.pages)
      ? payload.pages.map(page => page?.markdown).filter(value => typeof value === 'string')
      : []
}

function folderClassificationFor(input) {
  if (input && typeof input === 'object' && input.folderClassification)
    return input.folderClassification
  const type = typeof input === 'string' ? input : 'unknown'
  return {
    type,
    confidence: null,
    evidenceKeywords: [],
    candidates: type === 'unknown' ? [] : [type],
    needsReview: true,
    source: 'folder-and-file-name',
  }
}

function parserPresenceDifference(field, recognizedPresent, localPresent) {
  return {
    field,
    recognizedPresent,
    localPresent,
    status: recognizedPresent === localPresent ? 'aligned' : 'needs-review',
  }
}

function parserCountDifference(field, recognizedCount, localCount) {
  return {
    field,
    recognizedCount,
    localCount,
    status: recognizedCount === localCount ? 'aligned' : 'needs-review',
  }
}

function localParserComparison({ text, markdownPages, folderClassification, contentClassification, recognizedHints, localParsers }) {
  const parserType = ['invoice', 'delivery'].includes(folderClassification.type)
    ? folderClassification.type
    : ['invoice', 'delivery'].includes(contentClassification.type)
        ? contentClassification.type
        : null
  if (!parserType) {
    return {
      status: 'not-applicable',
      parserType: null,
      sourceModule: null,
      fields: [],
      differences: [],
      note: '当前本地业务解析逻辑只覆盖发票与送货单；本样本类型暂不适用。',
    }
  }

  const parser = localParsers?.[parserType]
  if (!parser) {
    return {
      status: 'unavailable',
      parserType,
      sourceModule: `app/lib/recognize/${parserType === 'invoice' ? 'invoice-parse' : 'delivery-parse'}.ts`,
      fields: [],
      differences: ['本地解析器未能加载，未据此判定识别失败。'],
      note: '仅保留 OCR 摘要与分类结果，待本地解析器可用后重跑。',
    }
  }

  try {
    if (parserType === 'invoice') {
      const parsed = parser.parseInvoiceText(text)
      const fields = [
        parserPresenceDifference('invoiceNumber', recognizedHints.orderNumbers.length > 0, Boolean(parsed.invoiceNumber)),
        parserPresenceDifference('invoiceDate', recognizedHints.dates.length > 0, Boolean(parsed.invoiceDate)),
        parserPresenceDifference('counterparties', recognizedHints.counterparties.length > 0, Boolean(parsed.buyer || parsed.seller)),
        parserPresenceDifference('amounts', recognizedHints.amounts.length > 0, parsed.amount != null || parsed.taxAmount != null || parsed.totalAmount != null),
        parserCountDifference('lineItemCount', recognizedHints.lineItemCount, Array.isArray(parsed.items) ? parsed.items.length : 0),
      ]
      return {
        status: 'available',
        parserType,
        sourceModule: 'app/lib/recognize/invoice-parse.ts',
        fields,
        differences: fields.filter(field => field.status !== 'aligned').map(field => field.field),
        note: '只比较字段存在性与明细行数，不输出本地解析原值。',
      }
    }

    const parsed = parser.parseDeliveryMarkdown(markdownPages)
    const firstDocument = parsed.docs?.[0] ?? {}
    const localItems = Array.isArray(firstDocument.items) ? firstDocument.items.length : 0
    const fields = [
      parserPresenceDifference('deliveryDate', recognizedHints.dates.length > 0, Boolean(firstDocument.date)),
      parserPresenceDifference('orderNo', recognizedHints.orderNumbers.length > 0, Boolean(firstDocument.orderNo)),
      parserPresenceDifference('supplierOrCounterparty', recognizedHints.counterparties.length > 0, Boolean(parsed.supplier || firstDocument.supplier)),
      parserPresenceDifference('amounts', recognizedHints.amounts.length > 0, firstDocument.statedTotal != null),
      parserCountDifference('lineItemCount', recognizedHints.lineItemCount, localItems),
    ]
    return {
      status: 'available',
      parserType,
      sourceModule: 'app/lib/recognize/delivery-parse.ts',
      fields,
      differences: fields.filter(field => field.status !== 'aligned').map(field => field.field),
      note: '只比较字段存在性与明细行数，不输出本地解析原值。',
    }
  }
  catch {
    return {
      status: 'failed',
      parserType,
      sourceModule: `app/lib/recognize/${parserType === 'invoice' ? 'invoice-parse' : 'delivery-parse'}.ts`,
      fields: [],
      differences: ['本地解析器执行异常，需复核 OCR 摘要与原件。'],
      note: '解析器异常不等同于 OCR 识别失败，未修改业务数据。',
    }
  }
}

async function loadLocalParsers() {
  try {
    const { createJiti } = await import('jiti')
    const jiti = createJiti(process.cwd(), {
      alias: { '~': resolve(process.cwd(), 'app') },
    })
    const [invoice, delivery] = await Promise.all([
      jiti.import('./app/lib/recognize/invoice-parse.ts'),
      jiti.import('./app/lib/recognize/delivery-parse.ts'),
    ])
    return { invoice, delivery }
  }
  catch {
    return { invoice: null, delivery: null }
  }
}

function summarizeOcrPayload(payload, folderInput, localParsers = null) {
  const markdownPages = ocrMarkdownPages(payload)
  const text = markdownPages.join('\n')
  const folderClassification = folderClassificationFor(folderInput)
  const contentClassification = classifyContent(text)
  const classificationComparison = compareClassifications(folderClassification, contentClassification)
  const isInvoice = folderClassification.type === 'invoice'
  const recognizedHints = {
    dates: dateHints(text),
    orderNumbers: labeledHints(text, /(?:送货单号|销售单号|出货单号|单据编号|单据号|单号|编号|No\.?)\s{0,3}[:：]?\s{0,3}([^\s|，,]+)/i),
    counterparties: labeledHints(text, isInvoice
      ? /(?:购买方|购方|买方|销售方|销方|卖方|收款方|开票方)\s{0,3}[:：]?\s{0,3}([^|\n]{1,80})/
      : /(?:供货单位|供方|供应商|客户|需方|收货单位|项目名称|项目)\s{0,3}[:：]?\s{0,3}([^|\n]{1,80})/),
    amounts: amountHints(text),
    lineItemCount: lineItemCount(text),
  }
  const localParserSummary = localParserComparison({
    text,
    markdownPages,
    folderClassification,
    contentClassification,
    recognizedHints,
    localParsers,
  })

  return {
    folderClassification,
    contentClassification,
    classificationComparison,
    localParserComparison: localParserSummary,
    recognized: {
      fieldCounts: {
        dates: recognizedHints.dates.length,
        orderNumbers: recognizedHints.orderNumbers.length,
        counterparties: recognizedHints.counterparties.length,
        amounts: recognizedHints.amounts.length,
      },
      lineItemCount: recognizedHints.lineItemCount,
    },
    comparison: {
      status: 'pending',
      fields: {
        dates: { sourceValue: null, recognizedCount: recognizedHints.dates.length, status: 'pending', difference: null },
        orderNumbers: { sourceValue: null, recognizedCount: recognizedHints.orderNumbers.length, status: 'pending', difference: null },
        counterparties: { sourceValue: null, recognizedCount: recognizedHints.counterparties.length, status: 'pending', difference: null },
        amounts: { sourceValue: null, recognizedCount: recognizedHints.amounts.length, status: 'pending', difference: null },
      },
      lineItems: {
        sourceCount: null,
        recognizedCount: recognizedHints.lineItemCount,
        status: 'pending',
        difference: null,
      },
      differences: [],
      note: '源文件对照由 AI/人工复核填入摘要；本次不覆盖业务数据。',
    },
  }
}

function safeFileName(value) {
  return value.replace(/[^\w\-.\u3400-\u9FFF]+/g, '_').slice(-100)
}

function defaultSleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function errorPayload(payload) {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data))
    return payload.data
  return payload && typeof payload === 'object' ? payload : {}
}

function safeErrorMessage(value, fallback) {
  const message = compactText(value)
    .replace(/(?:access[_ -]?token|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1:[redacted]')
    .slice(0, 240)
  return message || fallback
}

function classifyResponseFailure(response, payload) {
  const data = errorPayload(payload)
  const errorCode = typeof data.code === 'string'
    ? data.code
    : `http-${response.status}`
  const message = safeErrorMessage(
    data.message ?? data.errorMsg ?? payload?.statusMessage,
    `HTTP ${response.status}`,
  )
  const isRateLimit = response.status === 429
    || errorCode === 'rate-limit'
    || /限流|请求过于频繁|rate[- ]?limit|too many requests/i.test(message)
  if (isRateLimit) {
    return {
      failureKind: 'rate-limit',
      errorCode: 'rate-limit',
      error: message,
      retryable: true,
    }
  }

  const failureKind = RECOGNITION_ERROR_CODES.has(errorCode)
    || /识别失败|识别结果|recognition|ocr result/i.test(message)
    ? 'recognition'
    : 'request'
  return {
    failureKind,
    errorCode,
    error: message,
    retryable: Boolean(data.retryable) || response.status >= 500,
  }
}

function retryAfterMs(response, now = Date.now) {
  const value = response.headers?.get?.('retry-after')
  if (!value)
    return null
  if (/^\d+(?:\.\d+)?$/.test(value.trim()))
    return Math.max(0, Math.round(Number(value) * 1000))
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now()) : null
}

function retryDelayMs(retryNumber, options, response, now = Date.now) {
  const serverDelay = retryAfterMs(response, now)
  const exponentialDelay = options.retryBaseMs * (2 ** retryNumber)
  return Math.min(
    options.maxRetryDelayMs,
    Math.max(serverDelay ?? 0, exponentialDelay),
  )
}

function blockedComparison(message) {
  return {
    status: 'blocked',
    differences: [message],
  }
}

async function recognizeSample(sample, rootDirectory, baseUrl, rawDirectory, index, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
  const sleep = dependencies.sleep ?? defaultSleep
  const now = dependencies.now ?? Date.now
  const maxRateLimitRetries = dependencies.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES
  const retryBaseMs = dependencies.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  const maxRetryDelay = dependencies.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
  const beforeAttempt = dependencies.beforeAttempt
  const localParsers = dependencies.localParsers ?? null
  const filePath = resolve(rootDirectory, sample.relativePath)
  const fileData = await readFile(filePath)
  const contentType = CONTENT_TYPES[extname(sample.fileName).toLocaleLowerCase('zh-CN')] ?? 'application/octet-stream'

  const startedAt = now()
  const rawResultFiles = []
  const retryEvents = []
  let attempts = 0
  let rateLimitRetries = 0
  let rateLimitResponses = 0
  while (true) {
    attempts += 1
    await beforeAttempt?.()
    const form = new FormData()
    const uploadFileName = safeFileName(sample.fileName) || `ocr-sample.${sample.format === 'image' ? 'jpg' : 'pdf'}`
    form.append('file', new Blob([fileData], { type: contentType }), uploadFileName)
    let response
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/ocr/recognize`, {
        method: 'POST',
        body: form,
      })
    }
    catch (error) {
      return {
        id: sample.id,
        relativePath: sample.relativePath,
        fileName: sample.fileName,
        documentType: sample.documentType,
        folderClassification: sample.folderClassification ?? null,
        format: sample.format,
        status: 'failed',
        failureKind: 'request',
        attempts,
        retryCount: rateLimitRetries,
        rateLimitResponses,
        retryEvents,
        elapsedMs: now() - startedAt,
        errorCode: 'network',
        error: safeErrorMessage(error instanceof Error ? error.message : error, '本地 OCR 服务不可达'),
        comparison: blockedComparison('OCR 请求失败，无法进行字段对照'),
      }
    }

    const responseText = await response.text()
    let payload
    try {
      payload = JSON.parse(responseText)
    }
    catch {
      payload = { rawResponseType: 'non-json', responseLength: responseText.length }
    }

    const rawPath = join(
      rawDirectory,
      `${String(index + 1).padStart(3, '0')}-${safeFileName(sample.fileName)}-attempt-${attempts}.json`,
    )
    await writeFile(rawPath, JSON.stringify(payload), 'utf8')
    rawResultFiles.push(rawPath)

    if (!response.ok) {
      const failure = classifyResponseFailure(response, payload)
      if (failure.failureKind === 'rate-limit')
        rateLimitResponses += 1
      if (failure.failureKind === 'rate-limit' && rateLimitRetries < maxRateLimitRetries) {
        const delay = retryDelayMs(rateLimitRetries, {
          retryBaseMs,
          maxRetryDelayMs: maxRetryDelay,
        }, response, now)
        retryEvents.push({
          attempt: attempts,
          errorCode: failure.errorCode,
          delayMs: delay,
        })
        rateLimitRetries += 1
        await sleep(delay)
        continue
      }

      const pendingRetry = failure.failureKind === 'rate-limit'
      return {
        id: sample.id,
        relativePath: sample.relativePath,
        fileName: sample.fileName,
        documentType: sample.documentType,
        folderClassification: sample.folderClassification ?? null,
        format: sample.format,
        status: pendingRetry ? 'pending-retry' : 'failed',
        failureKind: failure.failureKind,
        retryable: failure.retryable,
        attempts,
        retryCount: rateLimitRetries,
        rateLimitResponses,
        retryEvents,
        httpStatus: response.status,
        elapsedMs: now() - startedAt,
        errorCode: failure.errorCode,
        error: failure.error,
        rawResultFile: rawPath,
        rawResultFiles,
        comparison: blockedComparison(pendingRetry
          ? '命中 OCR 限流且已耗尽本轮重试，稍后再处理'
          : 'OCR 请求或识别失败，无法进行字段对照'),
      }
    }

    const summary = summarizeOcrPayload(payload, sample, localParsers)
    return {
      id: sample.id,
      relativePath: sample.relativePath,
      fileName: sample.fileName,
      documentType: sample.documentType,
      format: sample.format,
      status: 'succeeded',
      attempts,
      retryCount: rateLimitRetries,
      rateLimitResponses,
      retryEvents,
      httpStatus: response.status,
      elapsedMs: now() - startedAt,
      engine: payload?.engine ?? null,
      model: payload?.model ?? null,
      jobIdPresent: Boolean(payload?.jobId),
      pageCount: Array.isArray(payload?.pages) ? payload.pages.length : summary.recognized.fieldCounts.dates ? 1 : 0,
      rawResultFile: rawPath,
      rawResultFiles,
      ...summary,
    }
  }
}

async function run(options, dependencies = {}) {
  const sampleReport = await buildReport(options)
  const rootDirectory = resolve(options.root)
  const outputDirectory = resolve(options.output)
  const rawDirectory = join(outputDirectory, 'raw-ocr')
  await mkdir(rawDirectory, { recursive: true })

  const sleep = dependencies.sleep ?? defaultSleep
  const now = dependencies.now ?? Date.now
  const localParsers = dependencies.localParsers ?? await loadLocalParsers()
  const requestGate = { tail: Promise.resolve(), nextAllowedAt: 0 }
  async function waitForRequestSlot() {
    const previous = requestGate.tail
    let release
    requestGate.tail = new Promise((resolve) => {
      release = resolve
    })
    await previous
    try {
      const delay = Math.max(0, requestGate.nextAllowedAt - now())
      if (delay > 0)
        await sleep(delay)
      requestGate.nextAllowedAt = now() + options.requestDelayMs
    }
    finally {
      release()
    }
  }

  const results = Array.from({ length: sampleReport.samples.length })
  let nextIndex = 0
  async function worker() {
    while (true) {
      const index = nextIndex++
      const sample = sampleReport.samples[index]
      if (!sample)
        return
      results[index] = await recognizeSample(
        sample,
        rootDirectory,
        options.baseUrl,
        rawDirectory,
        index,
        {
          fetchImpl: dependencies.fetchImpl,
          sleep,
          now,
          maxRateLimitRetries: options.maxRateLimitRetries,
          retryBaseMs: options.retryBaseMs,
          maxRetryDelayMs: options.maxRetryDelayMs,
          beforeAttempt: waitForRequestSlot,
          localParsers,
        },
      )
    }
  }
  const workerCount = Math.min(options.concurrency, sampleReport.samples.length || 1)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const succeeded = results.filter(result => result.status === 'succeeded')
  const failed = results.filter(result => result.status === 'failed')
  const pendingRetry = results.filter(result => result.status === 'pending-retry')
  const rateLimited = results.filter(result => result.failureKind === 'rate-limit')
  const classificationConflicts = results
    .filter(result => result.classificationComparison?.status === 'conflict')
    .map(result => ({
      relativePath: result.relativePath,
      fileName: result.fileName,
      folderClassification: result.folderClassification,
      contentClassification: result.contentClassification,
      comparison: result.classificationComparison,
    }))
  const classificationStatuses = results.reduce((counts, result) => {
    const status = result.classificationComparison?.status
    if (status)
      counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    baseUrl: options.baseUrl,
    sourceRoot: rootDirectory,
    safety: {
      tokenReadByTool: false,
      tokenWrittenByTool: false,
      rawOcrStoredOutsideRepository: true,
      productDataMutation: false,
    },
    sampleSelection: {
      supportedFiles: sampleReport.totals.supportedFiles,
      selectedFiles: sampleReport.totals.selectedFiles,
      counts: sampleReport.counts,
    },
    totals: {
      attempted: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      pendingRetry: pendingRetry.length,
      rateLimited: rateLimited.length,
      requestFailures: results.filter(result => result.failureKind === 'request').length,
      recognitionFailures: results.filter(result => result.failureKind === 'recognition').length,
      retriedSuccesses: succeeded.filter(result => result.retryCount > 0).length,
      rateLimitAttempts: results.reduce((total, result) => total + (result.rateLimitResponses ?? 0), 0),
    },
    retryPolicy: {
      concurrency: options.concurrency,
      requestDelayMs: options.requestDelayMs,
      maxRateLimitRetries: options.maxRateLimitRetries,
      retryBaseMs: options.retryBaseMs,
      maxRetryDelayMs: options.maxRetryDelayMs,
      pendingRetryMeaning: '仅表示命中限流且本轮重试耗尽；不等同于 OCR 识别失败。',
    },
    classification: {
      contentAnalyzed: succeeded.length,
      statuses: classificationStatuses,
      conflictCount: classificationConflicts.length,
      conflicts: classificationConflicts,
    },
    results,
    failedReasons: failed.map(result => ({
      fileName: result.fileName,
      documentType: result.documentType,
      format: result.format,
      failureKind: result.failureKind,
      errorCode: result.errorCode,
      error: result.error,
    })),
    pendingRetrySamples: pendingRetry.map(result => ({
      relativePath: result.relativePath,
      fileName: result.fileName,
      documentType: result.documentType,
      failureKind: result.failureKind,
      errorCode: result.errorCode,
      retryCount: result.retryCount,
      retryEvents: result.retryEvents,
      nextAction: '稍后以较低并发重新运行该样本；不要把它计入识别失败。',
    })),
  }
  await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

export {
  amountHints,
  classifyContent,
  classifyResponseFailure,
  compareClassifications,
  dateHints,
  lineItemCount,
  recognizeSample,
  retryDelayMs,
  run,
  summarizeOcrPayload,
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(helpText())
      process.exit(0)
    }
    const report = await run(options)
    console.log(JSON.stringify({
      output: options.output,
      attempted: report.totals.attempted,
      succeeded: report.totals.succeeded,
      failed: report.totals.failed,
      pendingRetry: report.totals.pendingRetry,
      rateLimited: report.totals.rateLimited,
      classificationConflictCount: report.classification.conflictCount,
      failedReasons: report.failedReasons,
    }, null, 2))
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
