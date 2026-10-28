import type { Download, Locator, Page } from '@playwright/test'
import type { DeliveryCentralRecord, DeliveryContext } from '../app/lib/delivery-record/contract'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

const original = cooperationPdfFixture('Delivery original')
const widths = [390, 768, 1024, 1280, 1440]
test.use({ channel: 'chromium', actionTimeout: 15_000 })
test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `delivery-441-${randomUUID()}` })
  await page.addInitScript(() => {
    if (window.top !== window || !['http:', 'https:'].includes(location.protocol))
      return
    localStorage.setItem('ruihang:workspace-default:include-demo', 'false')
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
  })
  const session = await (await page.request.get('/api/read/business-session')).json()
  for (const [domain, draft] of [
    ['projects', { name: '合成441送货项目', manager: '合成经办', status: '筹备中' }],
    ['suppliers', { name: '合成441送货分供方', supplierCategory: '材料供应商', aliases: [] }],
  ] as const) {
    const response = await page.request.post(`/api/commands/${domain}`, { data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: domain === 'projects' ? 'project:write' : 'supplier:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
  }
})

async function records(page: Page): Promise<DeliveryCentralRecord[]> {
  const response = await page.request.get('/api/read/deliveries?origin=real')
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).records
}
async function context(page: Page): Promise<DeliveryContext> {
  const response = await page.request.get('/api/read/deliveries/context?origin=real')
  expect(response.ok(), await response.text()).toBe(true)
  const context: DeliveryContext = await response.json()
  return { ...context, projects: context.projects.filter(row => row.name === '合成441送货项目'), suppliers: context.suppliers.filter(row => row.name === '合成441送货分供方') }
}
async function bytes(download: Download): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return new Uint8Array(Buffer.concat(chunks))
}
function storedZip(bytes: Uint8Array) {
  const data = Buffer.from(bytes)
  const result = new Map<string, Uint8Array>()
  let offset = 0
  while (data.readUInt32LE(offset) === 0x04034B50) {
    expect(data.readUInt16LE(offset + 8)).toBe(0)
    const size = data.readUInt32LE(offset + 18)
    const nameLength = data.readUInt16LE(offset + 26)
    const start = offset + 30 + nameLength + data.readUInt16LE(offset + 28)
    result.set(data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), new Uint8Array(data.subarray(start, start + size)))
    offset = start + size
  }
  return result
}
function markdown(project: string, supplier: string, index: number) {
  return `# ${supplier}销售单\n送货地址：${project}\n单号：DL-441-${index}\n日期：2026.09.11\n<table><tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr><tr><td>1</td><td>水泥${index}</td><td>42.5</td><td>吨</td><td>2</td><td>10</td><td>20</td></tr></table>`
}

async function waitForPdfPaint(preview: Locator) {
  await expect(preview).toBeVisible()
  await expect.poll(async () => {
    const handle = await preview.elementHandle()
    const sourceFrame = await handle?.contentFrame()
    await handle?.dispose()
    const viewerFrame = sourceFrame?.childFrames().find(frame => frame.url().startsWith('chrome-extension://'))
    if (!viewerFrame)
      return false
    return viewerFrame.evaluate(() => {
      const viewer = document.querySelector('pdf-viewer') as HTMLElement & {
        initialLoadComplete_?: boolean
        loadState_?: string
        documentDimensions?: { pageDimensions?: unknown[] }
      } | null
      const bounds = viewer?.shadowRoot?.querySelector('embed')?.getBoundingClientRect()
      return viewer?.initialLoadComplete_ === true && viewer.loadState_ === 'success'
        && viewer.documentDimensions?.pageDimensions?.length === 2 && Boolean(bounds && bounds.width > 0 && bounds.height > 0)
    }).catch(() => false)
  }, { message: '当前原件已载入两页，原生 PDF 绘制区域可见', timeout: 15_000 }).toBe(true)
  // Chromium 原生 PDF 在视口变化后异步重排，完成信号之后再等待绘制帧稳定。
  await preview.page().evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test('两页真实 PDF 经人工核对形成共享原件的两张逻辑记录，刷新修订下载与五档界面保持同源', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const archiveRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('the server responded with a status of 409'))
      errors.push(message.text())
  })
  page.on('requestfailed', request => archiveRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`))
  page.on('response', async (response) => {
    if (response.url().includes('/api/commands/deliveries') || (!response.ok() && response.url().includes('/api/')))
      archiveRequests.push(`${response.status()} ${response.url()} ${await response.text().catch(() => 'response unavailable')}`)
  })
  const source = await context(page)
  const project = source.projects[0]!
  const supplier = source.suppliers[0]!
  const markdownPages = [1, 2].map(index => markdown(project.name, supplier.name, index))
  await page.route('**/api/ocr/recognize', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ engine: 'paddleocr-official-api', model: 'PaddleOCR-VL-1.6', jobId: 'delivery-441-synthetic', pages: markdownPages.map((markdown, pageIndex) => ({ pageIndex, markdown, prunedResult: {}, layoutRegions: [] })), markdownPages, dataInfo: { numPages: 2 } }) }))
  await page.goto('/material/delivery')
  await expect(page.getByRole('button', { name: '上传送货单', exact: true })).toBeVisible({ timeout: 60_000 })
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传送货单', exact: true }).click()
  const recognized = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ocr/recognize' && response.request().method() === 'POST')
  await (await picker).setFiles({ name: '双页送货原件.pdf', mimeType: 'application/pdf', buffer: Buffer.from(original) })
  const recognition = await recognized
  expect(recognition.ok(), await recognition.text()).toBe(true)
  const review = page.locator('.delivery-review-panel')
  for (const index of [1, 2]) {
    await expect(review.getByPlaceholder('未识别时可手工填写', { exact: true })).toHaveValue(`DL-441-${index}`)
    await review.locator('select').first().selectOption(project.id)
    await review.getByPlaceholder('搜索分供方名称').fill(supplier.name)
    await review.getByRole('button', { name: supplier.name, exact: true }).click()
    if (index === 1) {
      await expect(page.getByText('已识别 1 个文件', { exact: true })).not.toBeVisible({ timeout: 10_000 })
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        const reviewTab = page.getByRole('tab', { name: '校对', exact: true })
        if (await reviewTab.isVisible()) {
          await reviewTab.focus()
          await reviewTab.press('Enter')
        }
        await expect(review).toBeVisible()
        await expectNoPageOverflow(page, `送货核对 ${width}`)
        if (width >= 1280)
          await waitForPdfPaint(page.getByTitle('双页送货原件.pdf 原始 PDF', { exact: true }))
        await review.getByText('材料明细', { exact: true }).scrollIntoViewIfNeeded()
        await review.locator('table tbody input').first().scrollIntoViewIfNeeded()
        await expectNoPageOverflow(page, `送货核对材料与确认 ${width}`)
      }
    }
    await review.getByRole('button', { name: '确认人工归档', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认人工归档', exact: true }).click()
    try {
      await expect.poll(async () => (await records(page)).length).toBe(index)
    }
    catch (cause) {
      await info.attach('归档请求诊断', { body: JSON.stringify({ errors, archiveRequests }, null, 2), contentType: 'application/json' })
      throw new Error(`${String(cause)}\n归档请求诊断：${JSON.stringify({ errors, archiveRequests })}`)
    }
  }
  const archived = await records(page)
  expect(archived[0]!.assetId).toBe(archived[1]!.assetId)
  expect(archived[0]!.uploadBatchId).toBe(archived[1]!.uploadBatchId)
  const first = archived.find(record => record.orderNo === 'DL-441-1')!
  const second = archived.find(record => record.orderNo === 'DL-441-2')!
  expect(archived.every(record => record.archived && record.printDisposition === 'pending')).toBe(true)
  expect(JSON.stringify(archived)).not.toContain(Buffer.from(original).toString('base64'))
  await page.reload()
  // 识别处理区属于写态，页签恢复按既定规则返回首页；通过可见菜单重新进入。
  await expect(page).toHaveURL(url => url.pathname === '/')
  const restoredQueue = page.waitForResponse(response => new URL(response.url()).pathname === '/api/read/deliveries' && response.request().method() === 'GET')
  await page.getByRole('navigation').getByRole('link', { name: '送货单识别', exact: true }).click()
  const restoredResponse = await restoredQueue
  expect(restoredResponse.ok(), await restoredResponse.text()).toBe(true)
  const restoredRecords: DeliveryCentralRecord[] = (await restoredResponse.json()).records
  expect(restoredRecords.map(record => record.id)).toEqual(expect.arrayContaining([first.id, second.id]))
  await expect(page.getByText('已归档 · 待打印', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('link', { name: '归档库', exact: true }).click()
  await page.locator('[data-ui="kit-table"]').getByRole('link', { name: first.orderNo, exact: true }).click()
  await expect(page.getByTestId('delivery-source-pdf')).toHaveAttribute('src', /^blob:/)
  await page.reload()
  await expect(page).toHaveURL(url => url.pathname === `/material/delivery/archive/${first.id}`)
  await expect(page.getByTestId('delivery-source-pdf')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载原件', exact: true }).click()
  expect(await bytes(await downloaded)).toEqual(original)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await getDocument({ data: new Uint8Array(original), useSystemFonts: true }).promise
  expect(pdf.numPages).toBe(2)
  const pageTexts: string[] = []
  for (let number = 1; number <= pdf.numPages; number++) pageTexts.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(''))
  expect(pageTexts).toEqual(['Delivery original page 1', 'Delivery original page 2'])
  await pdf.destroy()
  await page.getByRole('link', { name: '编辑', exact: true }).click()
  await page.getByLabel('修订原因', { exact: false }).fill('核对原件后修正日期和材料名称')
  await page.getByLabel('送货日期', { exact: false }).fill('2026-09-10')
  await page.getByLabel('材料名称', { exact: true }).fill('复核水泥')
  await page.mouse.move(5, 500)
  await expect(page.getByText(/已导出到\s*浏览器下载\s*文件夹/)).not.toBeVisible({ timeout: 15_000 })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByLabel('修订原因', { exact: false }).focus()
    await expect(page.getByLabel('修订原因', { exact: false })).toBeFocused()
    await expectNoPageOverflow(page, `送货修订 ${width}`)
  }
  const concurrent = await page.request.post('/api/commands/deliveries', { data: {
    workspaceId: source.workspaceId,
    actorId: source.actorId,
    requiredCapability: 'delivery:write',
    origin: 'real',
    action: 'revise',
    commandId: randomUUID(),
    id: first.id,
    baseVersion: first.version,
    reason: '另一经办同步核对',
    draft: { projectId: first.projectId, supplierId: first.supplierId, orderNo: first.orderNo, deliveryDate: first.deliveryDate, note: '另一经办最新备注', rawSiteText: first.rawSiteText, reviewFlag: first.reviewFlag, confirmations: {}, lines: first.lines.map(({ deliveryRecordId: _recordId, currentValueConfirmed: _confirmed, sortOrder: _order, ...line }) => line) },
  } })
  expect(concurrent.ok(), await concurrent.text()).toBe(true)
  await page.getByRole('button', { name: '保存归档修改', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认修改', exact: true }).click()
  await page.getByRole('button', { name: '重新核对当前记录', exact: true }).click()
  const currentReview = page.getByRole('region', { name: '核对当前送货记录' })
  await expect(currentReview).toContainText('另一经办最新备注')
  await expect(page.getByLabel('材料名称', { exact: true })).toHaveValue('复核水泥')
  await expect(page.getByLabel('修订原因', { exact: false })).toHaveValue('核对原件后修正日期和材料名称')
  await page.mouse.move(5, 500)
  await expect(page.getByText(/保存失败：送货记录已更新/)).not.toBeVisible({ timeout: 15_000 })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await currentReview.getByRole('heading', { name: '核对当前送货记录' }).scrollIntoViewIfNeeded()
    await expectNoPageOverflow(page, `送货冲突核对 ${width}`)
  }
  await currentReview.getByRole('button', { name: '采用已核对的当前版本', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '继续核对', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await records(page)).find(record => record.id === first.id)!.note).toBe('另一经办最新备注')
  await expect(page.getByLabel('材料名称', { exact: true })).toHaveValue('复核水泥')
  await currentReview.getByRole('button', { name: '采用已核对的当前版本', exact: true }).focus()
  await currentReview.getByRole('button', { name: '采用已核对的当前版本', exact: true }).press('Enter')
  const adopt = page.getByRole('dialog').getByRole('button', { name: '已核对，保留人工稿', exact: true })
  await adopt.focus()
  await expect(adopt).toBeFocused()
  await adopt.press('Enter')
  await page.getByRole('button', { name: '保存归档修改', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认修改', exact: true }).click()
  await expect(page.getByText('复核水泥', { exact: true }).first()).toBeVisible()
  const revised = (await records(page)).find(record => record.id === first.id)!
  expect(revised.assetId).toBe(first.assetId)
  expect(revised.lines[0]!.id).toBe(first.lines[0]!.id)
  expect((await records(page)).find(record => record.id === second.id)).toEqual(second)
  await page.getByRole('button', { name: '查看修订历史' }).click()
  const history = page.getByRole('region', { name: '送货修订历史' })
  await expect(history).toContainText('核对原件后修正日期和材料名称')
  await history.getByRole('button', { name: '修改前', exact: true }).click()
  await expect(history.getByText('水泥1', { exact: true })).toBeVisible()
  await expect(page.getByText('送货单归档已更新', { exact: true })).not.toBeVisible()
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('link', { name: '编辑', exact: true }).scrollIntoViewIfNeeded()
    await page.getByRole('link', { name: '编辑', exact: true }).focus()
    await expect(page.getByRole('link', { name: '编辑', exact: true })).toBeFocused()
    await expectNoPageOverflow(page, `送货详情 ${width}`)
    await waitForPdfPaint(page.getByTestId('delivery-source-pdf').first())
    await history.getByText('核对原件后修正日期和材料名称', { exact: true }).scrollIntoViewIfNeeded()
    await expect(history.getByText('核对原件后修正日期和材料名称', { exact: true })).toBeInViewport()
    await expectNoPageOverflow(page, `送货历史 ${width}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTitle('返回归档库').click()
  const zip = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出原件包', exact: true }).click()
  const entries = storedZip(await bytes(await zip))
  expect([...entries.keys()].filter(name => name.startsWith('原件/PDF/'))).toHaveLength(1)
  expect([...entries.values()].some(value => Buffer.from(value).equals(Buffer.from(original)))).toBe(true)
  await page.mouse.move(5, 500)
  await expect(page.getByText(/已导出到\s*浏览器下载\s*文件夹/)).not.toBeVisible({ timeout: 15_000 })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `送货归档库 ${width}`)
  }
  await page.getByRole('navigation').getByRole('link', { name: '送货单识别', exact: true }).click()
  const printQueue = page.locator('aside').filter({ hasText: '处理队列' })
  await expect(printQueue.getByRole('button', { name: '打开打印', exact: true })).toBeVisible()
  const printedWindow = page.waitForEvent('popup')
  await printQueue.getByRole('button', { name: '打开打印', exact: true }).click()
  const preview = await printedWindow
  await expect(preview).toHaveURL(/^blob:/)
  await preview.close()
  expect((await records(page)).every(record => record.printDisposition === 'pending')).toBe(true)
  await printQueue.getByRole('button', { name: '登记已打印', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '暂不登记', exact: true }).click()
  expect((await records(page)).every(record => record.printDisposition === 'pending')).toBe(true)
  await printQueue.getByRole('button', { name: '排除打印', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '排除打印', exact: true }).click()
  await expect.poll(async () => (await records(page)).every(record => record.printDisposition === 'excluded' && record.printedAt === '')).toBe(true)
  expect(errors).toEqual([])
})

test('中央隔离拒绝越权与旧版本，缺原件经失败重试补传再替换，历史仍可下载旧字节', async ({ page }) => {
  test.setTimeout(120_000)
  const source = await context(page)
  const envelope = { workspaceId: source.workspaceId, actorId: source.actorId, requiredCapability: 'delivery:write', origin: 'real' }
  const draft = { projectId: source.projects[0]!.id, supplierId: source.suppliers[0]!.id, orderNo: 'DL-441-API', deliveryDate: '2026-09-11', note: '', rawSiteText: '', reviewFlag: '', confirmations: {}, lines: [{ materialName: '材料', spec: '', unit: '吨', qty: 1, unitPrice: 0, amount: 0, note: '' }] }
  const command = { ...envelope, action: 'archive', commandId: randomUUID(), baseVersion: null, uploadBatchId: null, source: null, draft }
  const response = await page.request.post('/api/commands/deliveries', { data: command })
  expect(response.ok(), await response.text()).toBe(true)
  const saved = await response.json()
  expect(await (await page.request.post('/api/commands/deliveries', { data: command })).json()).toEqual(saved)
  const record = (await records(page))[0]!
  expect(record.hasSourceFile).toBe(false)
  expect(record.assetId).toBeNull()
  expect((await page.request.post('/api/commands/deliveries', { data: { ...envelope, action: 'revise', commandId: randomUUID(), id: saved.id, baseVersion: 'wrong', reason: '旧版本', draft } })).status()).toBe(409)
  expect((await page.request.post('/api/commands/deliveries', { data: { ...command, commandId: randomUUID(), actorId: 'forged' } })).status()).toBe(403)
  expect((await page.request.get(`/api/read/deliveries/${saved.id}/record?origin=demo`)).status()).toBe(403)
  expect((await page.request.get(`/api/read/deliveries/${saved.id}/record?origin=real`, { headers: { 'x-ruihang-test-session': 'unrelated-delivery-441' } })).status()).toBe(404)
  const wrongFileRelation = await page.request.get(`/api/read/deliveries/${saved.id}/files/other?origin=real&projectId=wrong`)
  expect(wrongFileRelation.status()).toBe(404)
  expect(await wrongFileRelation.json()).toMatchObject({ data: { code: 'relationship-mismatch' } })
  await page.goto(`/material/delivery/archive/${saved.id}?origin=real`)
  await expect(page.getByTestId('delivery-source-empty')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: '补传原件', exact: true })).toBeVisible()
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '补传原件', exact: true }).click()
  await (await picker).setFiles({ name: '补传原件.pdf', mimeType: 'application/pdf', buffer: Buffer.from(original) })
  await page.getByLabel('原件修订原因').fill('找回原件，补齐来源')
  let interrupted = false
  await page.route('**/api/commands/deliveries', async (route) => {
    if (!interrupted && route.request().postDataJSON().action === 'source') {
      interrupted = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: '合成网络中断' }) })
      return
    }
    await route.continue()
  })
  const failed = page.waitForResponse(response => response.url().endsWith('/api/commands/deliveries') && response.status() === 503)
  await page.getByRole('button', { name: '确认保存原件', exact: true }).click()
  await failed
  await expect(page.getByLabel('原件修订原因')).toHaveValue('找回原件，补齐来源')
  await expect(page.getByRole('button', { name: '确认保存原件', exact: true })).toBeEnabled()
  expect((await records(page))[0]!.assetId).toBeNull()
  await page.getByRole('button', { name: '确认保存原件', exact: true }).click()
  await expect(page.getByTestId('delivery-source-pdf')).toHaveAttribute('src', /^blob:/)
  const supplemented = (await records(page))[0]!
  expect(supplemented.assetId).toBeTruthy()
  expect(supplemented.lines).toEqual(record.lines)
  const replacement = cooperationPdfFixture('Replacement original')
  const replacementPicker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '替换原件', exact: true }).click()
  await (await replacementPicker).setFiles({ name: '更清晰原件.pdf', mimeType: 'application/pdf', buffer: Buffer.from(replacement) })
  await page.getByLabel('原件修订原因').fill('以清晰扫描替换当前引用，保留旧件')
  await page.getByRole('button', { name: '确认保存原件', exact: true }).click()
  await expect(page.getByLabel('原件修订原因')).toHaveCount(0)
  const replaced = (await records(page))[0]!
  expect(replaced.assetId).not.toBe(supplemented.assetId)
  expect(replaced.lines).toEqual(record.lines)
  const currentDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载原件', exact: true }).click()
  expect(await bytes(await currentDownload)).toEqual(replacement)
  await page.getByRole('button', { name: '查看修订历史', exact: true }).click()
  const history = page.getByRole('region', { name: '送货修订历史' })
  await expect(history).toContainText('以清晰扫描替换当前引用，保留旧件')
  await expect(history).toContainText(source.actorId)
  await history.getByRole('button', { name: '修改前', exact: true }).click()
  await expect(history.getByTestId('delivery-source-pdf')).toHaveAttribute('src', /^blob:/)
  const oldDownload = page.waitForEvent('download')
  await history.getByRole('button', { name: '下载原件', exact: true }).click()
  expect(await bytes(await oldDownload)).toEqual(original)
  await expectNoPageOverflow(page, '补传与旧原件历史')
  await page.getByRole('navigation').getByRole('link', { name: '送货单识别', exact: true }).click()
  await page.locator('aside').filter({ hasText: '处理队列' }).getByRole('button', { name: '登记已打印', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认已实际打印', exact: true }).click()
  await expect.poll(async () => (await records(page))[0]!.printDisposition).toBe('printed')
  expect((await records(page))[0]!.printedAt).toBeTruthy()
})
