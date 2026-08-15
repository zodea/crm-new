import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  DELIVERY_EXPORT_JPEG_BASE64,
  DELIVERY_EXPORT_PNG_BASE64,
} from '../tests/fixtures/delivery-export-images'

interface StoredZipEntry {
  name: string
  data: Uint8Array
}

function storedZipEntries(data: Uint8Array): StoredZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  const entries: StoredZipEntry[] = []
  let offset = 0
  while (offset + 4 <= data.length && view.getUint32(offset, true) === 0x04034B50) {
    const compression = view.getUint16(offset + 8, true)
    if (compression !== 0)
      throw new Error(`browser smoke 只支持读取 store ZIP，实际 compression=${compression}`)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const payloadStart = nameStart + nameLength + extraLength
    entries.push({
      name: decoder.decode(data.subarray(nameStart, nameStart + nameLength)),
      data: data.slice(payloadStart, payloadStart + size),
    })
    offset = payloadStart + size
  }
  return entries
}

async function resolvePopplerExecutable(command: 'pdfinfo' | 'pdftoppm'): Promise<string> {
  if (process.platform !== 'win32')
    return command
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const candidates = pathEntries.flatMap(directory => [
    path.join(directory, `${command}.exe`),
    path.resolve(directory, '..', '..', 'native', 'poppler', 'Library', 'bin', `${command}.exe`),
  ])
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    }
    catch {
      // 继续查找 PATH 中的下一个 Poppler 入口。
    }
  }
  return command
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} 执行失败：${stderr || error.message}`))
          return
        }
        resolve(stdout)
      },
    )
  })
}

async function pdfPageCount(filePath: string): Promise<number> {
  const output = await runCommand(await resolvePopplerExecutable('pdfinfo'), [filePath])
  const pages = /^Pages:\s+(\d+)\s*$/m.exec(output)?.[1]
  if (!pages)
    throw new Error(`pdfinfo 未返回页数：${output}`)
  return Number(pages)
}

async function renderPdfPage(filePath: string, page: number, outputPrefix: string): Promise<string> {
  await runCommand(await resolvePopplerExecutable('pdftoppm'), [
    '-f',
    String(page),
    '-l',
    String(page),
    '-singlefile',
    '-png',
    '-r',
    '144',
    filePath,
    outputPrefix,
  ])
  const outputPath = `${outputPrefix}.png`
  expect((await stat(outputPath)).size).toBeGreaterThan(50)
  return outputPath
}

// 精确浏览器能力 smoke：单 PR 不跑整套 E2E；在修复证据或批次 gate 中单文件执行。
test('Chromium 真实图片 API 生成图片 PDF，保留项目 PDF 原字节并通过 Poppler 首末页渲染', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const repoRoot = process.cwd()
  const sourcePdfName = '瑞航CRM_送货单归档与原件包导出使用说明.pdf'
  const sourcePdfBytes = await readFile(path.join(repoRoot, 'output', 'pdf', sourcePdfName))
  const modulePath = path.join(repoRoot, 'app', 'lib', 'delivery', 'export.ts').replaceAll('\\', '/')
  const moduleUrl = `/_nuxt/@fs/${modulePath}`

  await page.goto('/')
  const browserResult = await page.evaluate(async (input) => {
    const archiveModule = await import(input.moduleUrl)
    const decodeBase64 = (value: string): Uint8Array => {
      const binary = atob(value)
      return Uint8Array.from(binary, character => character.charCodeAt(0))
    }
    const encodeBase64 = (bytes: Uint8Array): string => {
      let binary = ''
      const chunkSize = 0x8000
      for (let offset = 0; offset < bytes.length; offset += chunkSize)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
      return btoa(binary)
    }
    const record = (id: string, orderNo: string, fileName: string) => ({
      id,
      projectId: 'project-browser-smoke',
      supplierId: 'supplier-browser-smoke',
      rawSiteText: '',
      orderNo,
      deliveryDate: '2026-08-11',
      fileName,
      filePath: '',
      ocrStatus: 'reviewed',
      reviewStatus: 'reviewed',
      naturalKeyDuplicate: false,
      currentValuesConfirmed: true,
      archived: true,
      stored: true,
      printBatchId: id,
      printDisposition: 'pending',
      printedAt: '',
      printExcludedAt: '',
      reviewFlag: '',
      note: '',
      createdAt: '',
      updatedAt: '',
      hasSourceFile: true,
      lines: [{
        id: `line-${id}`,
        deliveryRecordId: id,
        materialName: '浏览器能力验证材料',
        spec: '',
        unit: '件',
        qty: 1,
        unitPrice: 1,
        amount: 1,
        amountSource: 'manual',
        currentValueConfirmed: true,
        note: '',
        sortOrder: 0,
      }],
      totalAmount: 1,
    })
    const pngBytes = decodeBase64(input.pngBase64)
    const jpegBytes = decodeBase64(input.jpegBase64)
    const pdfBytes = decodeBase64(input.pdfBase64)
    const records = [
      record('browser-png', 'BROWSER-001', 'browser-valid.png'),
      record('browser-jpeg', 'BROWSER-002', 'browser-valid.jpg'),
      record('browser-pdf', 'BROWSER-003', input.sourcePdfName),
    ]
    const sources = new Map([
      ['browser-png', { fileName: 'browser-valid.png', mimeType: 'image/png', fileSize: pngBytes.length, bytes: pngBytes }],
      ['browser-jpeg', { fileName: 'browser-valid.jpg', mimeType: 'image/jpeg', fileSize: jpegBytes.length, bytes: jpegBytes }],
      ['browser-pdf', { fileName: input.sourcePdfName, mimeType: 'application/pdf', fileSize: pdfBytes.length, bytes: pdfBytes }],
    ])
    const result = await archiveModule.createDeliveryArchiveZip(records, {
      projectName: () => '浏览器验证项目',
      supplierName: () => '浏览器验证供应商',
    }, {
      convertImagesToPdf: true,
      loadSource: async (current: { id: string }) => sources.get(current.id) ?? null,
    })
    return {
      zipBase64: encodeBase64(result.data),
      imagePdfFileName: result.imagePdfFileName,
      pdfSourceCount: result.pdfSourceCount,
    }
  }, {
    moduleUrl,
    pngBase64: DELIVERY_EXPORT_PNG_BASE64,
    jpegBase64: DELIVERY_EXPORT_JPEG_BASE64,
    pdfBase64: sourcePdfBytes.toString('base64'),
    sourcePdfName,
  })

  expect(browserResult).toMatchObject({
    imagePdfFileName: '图片原件合并.pdf',
    pdfSourceCount: 1,
  })
  const entries = storedZipEntries(Buffer.from(browserResult.zipBase64, 'base64'))
  const imagePdf = entries.find(entry => entry.name === '图片原件合并.pdf')
  const sourcePdf = entries.find(entry => entry.name === `原件/PDF/${sourcePdfName}`)
  expect(imagePdf).toBeDefined()
  expect(new TextDecoder().decode(imagePdf!.data.subarray(0, 8))).toBe('%PDF-1.7')
  expect(new TextDecoder().decode(imagePdf!.data)).toContain('/Count 2')
  expect(sourcePdf).toBeDefined()
  expect(Buffer.compare(Buffer.from(sourcePdf!.data), sourcePdfBytes)).toBe(0)
  expect(entries.filter(entry => entry.name.startsWith('原件/PDF/'))).toHaveLength(1)

  const artifactDir = testInfo.outputPath('poppler')
  await mkdir(artifactDir, { recursive: true })
  const imagePdfPath = path.join(artifactDir, 'image-originals.pdf')
  const preservedPdfPath = path.join(artifactDir, 'preserved-project-guide.pdf')
  await writeFile(imagePdfPath, imagePdf!.data)
  await writeFile(preservedPdfPath, sourcePdf!.data)

  const imagePdfPages = await pdfPageCount(imagePdfPath)
  expect(imagePdfPages).toBe(2)
  const imageFirst = await renderPdfPage(imagePdfPath, 1, path.join(artifactDir, 'image-first'))
  const imageLast = await renderPdfPage(imagePdfPath, imagePdfPages, path.join(artifactDir, 'image-last'))
  await testInfo.attach('图片合并 PDF 首面', { path: imageFirst, contentType: 'image/png' })
  await testInfo.attach('图片合并 PDF 末面', { path: imageLast, contentType: 'image/png' })

  const projectPdfPages = await pdfPageCount(preservedPdfPath)
  expect(projectPdfPages).toBeGreaterThan(1)
  const projectFirst = await renderPdfPage(preservedPdfPath, 1, path.join(artifactDir, 'project-first'))
  const projectLast = await renderPdfPage(preservedPdfPath, projectPdfPages, path.join(artifactDir, 'project-last'))
  await testInfo.attach('项目 PDF 首面', { path: projectFirst, contentType: 'image/png' })
  await testInfo.attach('项目 PDF 末面', { path: projectLast, contentType: 'image/png' })
})
