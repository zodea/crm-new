import type { Download, Page, TestInfo } from '@playwright/test'
import type { ProjectSupplierWorkbenchReadDTO } from '../app/lib/project-supplier/read-contract'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import { updateProductionSnapshot } from './helpers/browser-production-snapshot'

const projectId = 'project-real-320'
const supplierId = 'supplier-real-327'
const original = cooperationPdfFixture('Central original')
const second = cooperationPdfFixture('Second original')
const sourceZip = new Uint8Array(Buffer.from('UEsDBBQAAAAAAGkIK111epnAFAAAABQAAAAMAAAAb3JpZ2luYWwudHh0T3JpZ2luYWwgWklQIGNvbnRlbnRQSwECFAAUAAAAAABpCCtddXqZwBQAAAAUAAAADAAAAAAAAAAAAAAAgAEAAAAAb3JpZ2luYWwudHh0UEsFBgAAAAABAAEAOgAAAD4AAAAAAA==', 'base64'))
const filePattern = /\/api\/read\/project-suppliers\/[^/]+\/[^/]+\/files\//
const sessions = new WeakMap<Page, string>()
const headers = (page: Page) => ({ 'x-ruihang-test-session': sessions.get(page)! })

function testSession(info: TestInfo) {
  return Buffer.from(info.testId).toString('base64url')
}

async function prepare(page: Page, info: TestInfo) {
  const session = testSession(info)
  sessions.set(page, session)
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
  for (const domain of ['project-suppliers', 'construction-contracts']) {
    const reset = await page.request.post(`/api/testing/${domain}/reset`, {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session },
      data: { scenario: 'ready' },
    })
    expect(reset.ok()).toBe(true)
  }
  await page.addInitScript(() => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'false')
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
  })
}

async function appendFiles(page: Page, targetSupplier: string, files: Array<{ name: string, bytes: Uint8Array, mimeType: string }>) {
  const contextResponse = await page.request.get(`/api/read/project-suppliers/${projectId}/import-context`, { headers: headers(page) })
  expect(contextResponse.ok(), await contextResponse.text()).toBe(true)
  const context = await contextResponse.json()
  const supplier = context.suppliers.find((row: { id: string }) => row.id === targetSupplier)
  const response = await page.request.post('/api/commands/project-suppliers/import', { headers: headers(page), data: {
    projectId,
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    requiredCapability: 'project-supplier:write',
    commandId: randomUUID(),
    baseVersion: context.sourceVersion,
    groups: [{ supplierId: targetSupplier, supplierName: supplier.name, files: files.map(file => ({
      fileName: file.name,
      fileSize: file.bytes.byteLength,
      mimeType: file.mimeType,
      category: '合同',
      payloadBase64: Buffer.from(file.bytes).toString('base64'),
    })) }],
  } })
  expect(response.ok(), await response.text()).toBe(true)
}

async function workbench(page: Page, targetSupplier = supplierId): Promise<ProjectSupplierWorkbenchReadDTO> {
  const response = await page.request.get(`/api/read/project-suppliers/${projectId}/${targetSupplier}?origin=real&includeDemo=false`, { headers: headers(page) })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json()
}

function fileUrl(data: ProjectSupplierWorkbenchReadDTO, index = 0) {
  const file = data.files[index]!
  const query = new URLSearchParams({ origin: 'real', includeDemo: 'false', relationId: data.relation.id, ownerType: file.ownerType, ownerId: file.ownerId })
  return `/api/read/project-suppliers/${data.project.id}/${data.supplier.id}/files/${file.file.id}?${query}`
}

async function downloadedBytes(download: Download) {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!)
    chunks.push(Buffer.from(chunk))
  return new Uint8Array(Buffer.concat(chunks))
}

function zipEntries(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes)
  const result = new Map<string, Uint8Array>()
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034B50) {
    const size = buffer.readUInt32LE(offset + 18)
    const nameSize = buffer.readUInt16LE(offset + 26)
    const extraSize = buffer.readUInt16LE(offset + 28)
    const start = offset + 30 + nameSize + extraSize
    result.set(buffer.subarray(offset + 30, offset + 30 + nameSize).toString('utf8'), new Uint8Array(buffer.subarray(start, start + size)))
    offset = start + size
  }
  return result
}

// 完整 Chromium 支持内建 PDF 查看器；默认 headless shell 不支持 PDF 导航。
test.use({ channel: 'chromium' })

test.describe('Issue #438 合作档案中央原件', () => {
  test.setTimeout(150_000)

  test('真实多页 PDF 导入刷新、预览、下载及同名 ZIP 保持原始字节，五档视口可用', async ({ page }, info) => {
    await prepare(page, info)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/project/${projectId}?origin=real`)
    await expect(page.getByRole('heading', { name: '中央正式施工项目' })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: '从文件导入分供方' }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '选择文件', exact: true }).click()
    await (await chooser).setFiles({ name: '合成438合作分供方-合同.pdf', mimeType: 'application/pdf', buffer: Buffer.from(original) })
    await page.getByRole('button', { name: '下一步：自动分类' }).click()
    const candidate = page.locator('article').filter({ hasText: '合成438合作分供方-合同.pdf' })
    await candidate.getByRole('textbox', { name: /新分供方名称/ }).fill('合成438合作分供方')
    await candidate.getByRole('checkbox').check()
    await page.getByRole('button', { name: '下一步：确认生成' }).click()
    await page.getByRole('button', { name: '确认生成并返回项目' }).click()
    await page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: '合成438合作分供方', exact: true }).click()
    await expect(page.getByRole('heading', { name: '中央正式施工项目 × 合成438合作分供方' })).toBeVisible()
    const targetSupplier = new URL(page.url()).pathname.split('/').at(-1)!
    await appendFiles(page, targetSupplier, [
      { name: '合成438合作分供方-合同.pdf', bytes: second, mimeType: 'application/pdf' },
      { name: '原始附件.zip', bytes: sourceZip, mimeType: 'application/zip' },
    ])
    const data = await workbench(page, targetSupplier)
    expect(data.files).toHaveLength(3)
    expect(JSON.stringify(data)).not.toContain(Buffer.from(original).toString('base64'))
    const central = data.files[0]!
    // 中央详情不会初始化本地业务库；进入现有本地台账后再安装冲突快照。
    await page.goto('/finance/ledger')
    await expect(page.getByRole('button', { name: '导出 Excel', exact: true })).toBeVisible()
    await updateProductionSnapshot(page, (database) => {
      database.run('INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_size, category, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)', [central.file.id, central.ownerType, central.ownerId, central.file.label, 5, '合同', 'application/pdf'])
      database.run('INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES (?, ?, ?)', [central.file.id, 'base64', Buffer.from('LOCAL').toString('base64')])
    })
    await page.goto(`/project/${projectId}/supplier/${targetSupplier}?origin=real`)
    await page.reload()
    const panel = page.getByRole('region', { name: '合作文件' })
    const download = panel.getByRole('button', { name: '下载 合成438合作分供方-合同.pdf', exact: true }).first()
    await expect(download).toBeEnabled({ timeout: 30_000 })
    const downloaded = page.waitForEvent('download')
    await download.click()
    expect(await downloadedBytes(await downloaded)).toEqual(original)
    const popupEvent = page.waitForEvent('popup')
    await panel.getByRole('button', { name: '预览 合成438合作分供方-合同.pdf', exact: true }).first().click()
    const popup = await popupEvent
    await expect.poll(() => popup.url()).toContain('blob:')
    const previewBytes = await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), popup.url())
    expect(new Uint8Array(previewBytes)).toEqual(original)
    await popup.close()
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await getDocument({ data: new Uint8Array(previewBytes), useSystemFonts: true }).promise
    expect(pdf.numPages).toBe(2)
    const text: string[] = []
    for (let number = 1; number <= pdf.numPages; number++)
      text.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(''))
    expect(text).toEqual(['Central original page 1', 'Central original page 2'])
    await pdf.destroy()
    await panel.getByRole('checkbox', { name: '全选合作档案原件' }).check()
    const archiveEvent = page.waitForEvent('download')
    await panel.getByRole('button', { name: '下载选中 ZIP' }).click()
    const entries = zipEntries(await downloadedBytes(await archiveEvent))
    expect(entries.get('01_原件/合成438合作分供方-合同.pdf')).toEqual(original)
    expect(entries.get('01_原件/合成438合作分供方-合同 (2).pdf')).toEqual(second)
    expect(entries.get('01_原件/原始附件.zip')).toEqual(sourceZip)
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('00_文件清单.json')))
    for (const file of manifest.files)
      expect(createHash('sha256').update(entries.get(file.archiveName)!).digest('hex')).toBe(file.sha256)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await panel.scrollIntoViewIfNeeded()
      await panel.getByRole('button', { name: '下载选中 ZIP' }).focus()
      await expect(panel.getByRole('button', { name: '下载选中 ZIP' })).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    expect(errors).toEqual([])
  })

  test('正文请求拒绝其他身份、来源、会话及已删除当前祖先；hash 故障保留选择后可重试', async ({ page }, info) => {
    await prepare(page, info)
    await appendFiles(page, supplierId, [{ name: '隔离合同.pdf', bytes: original, mimeType: 'application/pdf' }])
    const data = await workbench(page)
    const url = fileUrl(data)
    for (const change of [
      url.replace(projectId, 'missing-project'),
      url.replace(supplierId, 'missing-supplier'),
      url.replace(`relationId=${data.relation.id}`, 'relationId=other'),
      url.replace('ownerType=project_supplier', 'ownerType=invoice'),
      url.replace(`ownerId=${data.relation.id}`, 'ownerId=other'),
      url.replace('origin=real', 'origin=demo'),
    ]) {
      const response = await page.request.get(change, { headers: headers(page) })
      expect(response.ok()).toBe(false)
      expect(await response.text()).not.toContain(Buffer.from(original).toString('base64'))
    }
    expect((await page.request.get(url, { headers: { 'x-ruihang-test-session': 'other-438-session' } })).ok()).toBe(false)
    await page.goto(`/project/${projectId}/supplier/${supplierId}?origin=real`)
    const panel = page.getByRole('region', { name: '合作文件' })
    await panel.getByRole('checkbox', { name: '选择 隔离合同.pdf' }).check()
    await page.route(filePattern, async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...await response.json(), sha256: '0'.repeat(64) } })
    })
    await panel.getByRole('button', { name: '下载选中 ZIP' }).click()
    await expect(panel.getByRole('alert')).toContainText('校验失败')
    await expect(panel.getByRole('checkbox', { name: '选择 隔离合同.pdf' })).toBeChecked()
    await page.unroute(filePattern)
    const downloaded = page.waitForEvent('download')
    await panel.getByRole('button', { name: '下载选中 ZIP' }).click()
    await downloadedBytes(await downloaded)
    const reset = await page.request.post('/api/testing/projects/reset', { headers: { ...headers(page), 'x-ruihang-test-reset': '1' }, data: { scenario: 'forbidden' } })
    expect(reset.ok()).toBe(true)
    expect((await page.request.get(url, { headers: headers(page) })).status()).toBe(403)
    await page.request.post('/api/testing/projects/reset', { headers: { ...headers(page), 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
    expect((await page.request.get(url, { headers: headers(page) })).status()).toBe(404)
  })

  test('慢响应下载在用户激活仍有效时请求保存位置', async ({ page }, info) => {
    await prepare(page, info)
    await appendFiles(page, supplierId, [{ name: '慢响应合同.pdf', bytes: original, mimeType: 'application/pdf' }])
    await page.goto(`/project/${projectId}/supplier/${supplierId}?origin=real`)
    const button = page.getByRole('button', { name: '下载 慢响应合同.pdf' })
    await expect(button).toBeEnabled({ timeout: 30_000 })
    await page.evaluate(() => {
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
        const activated = navigator.userActivation.isActive
        console.warn(`438-picker-activation:${activated}`)
        if (!activated)
          throw new DOMException('用户激活已失效', 'SecurityError')
        return {
          name: '合成验收目录',
          async getFileHandle(name: string, options: { create: boolean }) {
            if (!options.create)
              throw new DOMException('不存在', 'NotFoundError')
            let bytes: number[] = []
            return { createWritable: async () => ({
              write: async (data: Uint8Array) => { bytes = Array.from(data) },
              close: async () => { console.warn(`438-written:${JSON.stringify({ name, bytes })}`) },
            }) }
          },
        }
      } })
    })
    await page.route(filePattern, async (route) => {
      await new Promise(resolve => setTimeout(resolve, 6500))
      await route.continue()
    })
    // 不在等待期间轮询 DOM：CDP 的反复 evaluate 可能重新提供自动化用户激活。
    const activation = page.waitForEvent('console', { predicate: message => message.text().startsWith('438-picker-activation:'), timeout: 15_000 })
    const written = page.waitForEvent('console', { predicate: message => message.text().startsWith('438-written:'), timeout: 15_000 })
    await button.click()
    expect((await activation).text()).toBe('438-picker-activation:true')
    const saved = JSON.parse((await written).text().slice('438-written:'.length))
    expect(saved.name).toBe('慢响应合同.pdf')
    expect(new Uint8Array(saved.bytes)).toEqual(original)
  })
})
