#!/usr/bin/env node

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

function parseArgs(argv) {
  const options = {
    root: '需过滤文件夹',
    mode: 'representative',
    perGroup: 1,
    concurrency: 1,
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

function summarizeOcrPayload(payload, documentType) {
  const markdownPages = Array.isArray(payload?.markdownPages)
    ? payload.markdownPages.filter(value => typeof value === 'string')
    : Array.isArray(payload?.pages)
      ? payload.pages.map(page => page?.markdown).filter(value => typeof value === 'string')
      : []
  const text = markdownPages.join('\n')
  const isInvoice = documentType === 'invoice'
  const recognized = {
    dates: dateHints(text),
    orderNumbers: labeledHints(text, /(?:送货单号|销售单号|出货单号|单据编号|单据号|单号|编号|No\.?)\s{0,3}[:：]?\s{0,3}([^\s|，,]+)/i),
    counterparties: labeledHints(text, isInvoice
      ? /(?:购买方|购方|买方|销售方|销方|卖方|收款方|开票方)\s{0,3}[:：]?\s{0,3}([^|\n]{1,80})/
      : /(?:供货单位|供方|供应商|客户|需方|收货单位|项目名称|项目)\s{0,3}[:：]?\s{0,3}([^|\n]{1,80})/),
    amounts: amountHints(text),
    lineItemCount: lineItemCount(text),
  }

  return {
    recognized,
    comparison: {
      status: 'pending',
      fields: {
        dates: { sourceValue: null, recognizedValue: recognized.dates, status: 'pending', difference: null },
        orderNumbers: { sourceValue: null, recognizedValue: recognized.orderNumbers, status: 'pending', difference: null },
        counterparties: { sourceValue: null, recognizedValue: recognized.counterparties, status: 'pending', difference: null },
        amounts: { sourceValue: null, recognizedValue: recognized.amounts, status: 'pending', difference: null },
      },
      lineItems: {
        sourceCount: null,
        recognizedCount: recognized.lineItemCount,
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

async function recognizeSample(sample, rootDirectory, baseUrl, rawDirectory, index) {
  const filePath = resolve(rootDirectory, sample.relativePath)
  const fileData = await readFile(filePath)
  const form = new FormData()
  const contentType = CONTENT_TYPES[extname(sample.fileName).toLocaleLowerCase('zh-CN')] ?? 'application/octet-stream'
  form.append('file', new Blob([fileData], { type: contentType }), sample.fileName)

  const startedAt = Date.now()
  let response
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/ocr/recognize`, {
      method: 'POST',
      body: form,
    })
  }
  catch (error) {
    return {
      id: sample.id,
      fileName: sample.fileName,
      documentType: sample.documentType,
      format: sample.format,
      status: 'failed',
      elapsedMs: Date.now() - startedAt,
      errorCode: 'network',
      error: error instanceof Error ? error.message : String(error),
      comparison: { status: 'blocked', differences: ['本地 OCR 服务不可达'] },
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

  const rawPath = join(rawDirectory, `${String(index + 1).padStart(3, '0')}-${safeFileName(sample.fileName)}.json`)
  await writeFile(rawPath, JSON.stringify(payload), 'utf8')

  if (!response.ok) {
    const errorData = payload?.data ?? payload
    return {
      id: sample.id,
      fileName: sample.fileName,
      documentType: sample.documentType,
      format: sample.format,
      status: 'failed',
      httpStatus: response.status,
      elapsedMs: Date.now() - startedAt,
      errorCode: errorData?.code ?? `http-${response.status}`,
      error: compactText(errorData?.message ?? payload?.statusMessage ?? `HTTP ${response.status}`),
      rawResultFile: rawPath,
      comparison: { status: 'blocked', differences: ['OCR 请求失败，无法进行字段对照'] },
    }
  }

  const summary = summarizeOcrPayload(payload, sample.documentType)
  return {
    id: sample.id,
    fileName: sample.fileName,
    documentType: sample.documentType,
    format: sample.format,
    status: 'succeeded',
    httpStatus: response.status,
    elapsedMs: Date.now() - startedAt,
    engine: payload?.engine ?? null,
    model: payload?.model ?? null,
    jobIdPresent: Boolean(payload?.jobId),
    pageCount: Array.isArray(payload?.pages) ? payload.pages.length : summary.recognized.dates.length ? 1 : 0,
    rawResultFile: rawPath,
    ...summary,
  }
}

async function run(options) {
  const sampleReport = await buildReport(options)
  const rootDirectory = resolve(options.root)
  const outputDirectory = resolve(options.output)
  const rawDirectory = join(outputDirectory, 'raw-ocr')
  await mkdir(rawDirectory, { recursive: true })

  const results = Array.from({ length: sampleReport.samples.length })
  let nextIndex = 0
  async function worker() {
    while (true) {
      const index = nextIndex++
      const sample = sampleReport.samples[index]
      if (!sample)
        return
      results[index] = await recognizeSample(sample, rootDirectory, options.baseUrl, rawDirectory, index)
    }
  }
  const workerCount = Math.min(options.concurrency, sampleReport.samples.length || 1)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const succeeded = results.filter(result => result.status === 'succeeded')
  const failed = results.filter(result => result.status === 'failed')
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
    },
    results,
    failedReasons: failed.map(result => ({
      fileName: result.fileName,
      documentType: result.documentType,
      format: result.format,
      errorCode: result.errorCode,
      error: result.error,
    })),
  }
  await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

export { amountHints, dateHints, lineItemCount, run, summarizeOcrPayload }

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
      failedReasons: report.failedReasons,
    }, null, 2))
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
