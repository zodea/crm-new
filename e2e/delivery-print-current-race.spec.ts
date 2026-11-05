import type { APIResponse, Page, Route } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'

test.use({ channel: 'chromium', headless: true })

const diagnostics = new WeakMap<Page, { pageErrors: string[], failedRequests: string[] }>()
test.beforeEach(async ({ page }) => {
  const current = { pageErrors: [] as string[], failedRequests: [] as string[] }
  diagnostics.set(page, current)
  page.on('pageerror', error => current.pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_nuxt/') || url.pathname.startsWith('/@vite/'))
      current.failedRequests.push(`${request.method()} ${url.pathname}: ${request.failure()?.errorText ?? 'unknown'}`)
  })
})
test.afterEach(async ({ page }, info) => {
  await info.attach('delivery-race-browser-diagnostics', { body: Buffer.from(JSON.stringify(diagnostics.get(page) ?? {}, null, 2)), contentType: 'application/json' })
})

async function json(response: APIResponse) {
  expect(response.ok(), await response.text()).toBe(true)
  return response.json()
}

test('当前原件替换期间不输出旧件，重读后打开新件且历史原件仍可读', async ({ page }) => {
  test.setTimeout(120_000)
  const sessionId = `delivery-print-race-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
  await page.addInitScript(() => {
    if (window.top === window && ['http:', 'https:'].includes(location.protocol))
      localStorage.setItem('ruihang:workspace-default:include-demo', 'false')
  })
  const session = await json(await page.request.get('/api/read/business-session'))
  const identity = { workspaceId: session.workspaceId, actorId: session.actorId }
  const project = await json(await page.request.post('/api/commands/projects', { data: { ...identity, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: '合成打印竞态项目', manager: '合成经办', status: '筹备中' }, attachments: {} } }))
  const supplier = await json(await page.request.post('/api/commands/suppliers', { data: { ...identity, requiredCapability: 'supplier:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: '合成打印竞态分供方', supplierCategory: '材料供应商', aliases: [] }, attachments: {} } }))
  const originalA = Buffer.from(cooperationPdfFixture('Delivery race A'))
  const originalB = Buffer.from(cooperationPdfFixture('Delivery race B'))
  const source = (fileName: string, bytes: Buffer) => ({ fileName, mimeType: 'application/pdf', fileSize: bytes.length, payloadBase64: bytes.toString('base64') })
  const envelope = { ...identity, requiredCapability: 'delivery:write', origin: 'real' }
  const created = await json(await page.request.post('/api/commands/deliveries', { data: {
    ...envelope,
    action: 'archive',
    commandId: randomUUID(),
    baseVersion: null,
    uploadBatchId: null,
    source: source('竞态原件A.pdf', originalA),
    draft: { projectId: project.id, supplierId: supplier.id, orderNo: 'DELIVERY-PRINT-RACE', deliveryDate: '2026-11-05', note: '', rawSiteText: '', reviewFlag: '', confirmations: {}, lines: [{ materialName: '合成材料', spec: '', unit: '件', qty: 1, unitPrice: 10, amount: 10, amountSource: 'manual', note: '' }] },
  } }))
  const recordUrl = `/api/read/deliveries/${encodeURIComponent(created.id)}/record?origin=real`
  const before = await json(await page.request.get(recordUrl))
  expect(before).toMatchObject({ id: created.id, version: created.version, printDisposition: 'pending', projectId: project.id, supplierId: supplier.id })
  expect(before.assetId).toBeTruthy()
  const originalPath = `/api/read/deliveries/${encodeURIComponent(created.id)}/files/${encodeURIComponent(before.assetId)}`

  await page.goto('/material/delivery')
  await expect(page.getByRole('button', { name: '上传送货单', exact: true })).toBeVisible({ timeout: 60_000 })
  const queue = page.locator('aside').filter({ hasText: '处理队列' })
  await expect(queue.getByText('竞态原件A.pdf', { exact: true })).toBeVisible()
  await expect(page.locator('iframe[title="竞态原件A.pdf 原始 PDF"]')).toHaveAttribute('src', /^blob:/)

  let release!: () => void
  let replacementVersion = ''
  const gate = new Promise<void>(resolve => release = resolve)
  let intercepted = false
  const matchOriginal = (url: URL) => url.pathname === originalPath
  const holdOriginal = async (route: Route) => {
    intercepted = true
    await gate
    await route.continue()
  }
  await page.route(matchOriginal, holdOriginal)
  try {
    const opening = page.waitForEvent('popup')
    await queue.getByRole('button', { name: '打开打印', exact: true }).click()
    const popup = await opening
    const navigations: string[] = []
    popup.on('framenavigated', (frame) => {
      if (frame === popup.mainFrame())
        navigations.push(frame.url())
    })
    await expect(popup).toHaveURL('about:blank')
    await expect.poll(() => intercepted, { message: '旧原件请求已暂停' }).toBe(true)
    const closed = popup.waitForEvent('close')
    const replacement = await json(await page.request.post('/api/commands/deliveries', { data: { ...envelope, action: 'source', commandId: randomUUID(), id: created.id, baseVersion: before.version, reason: '核验后替换原件', source: source('竞态原件B.pdf', originalB) } }))
    replacementVersion = replacement.version
    const current = await json(await page.request.get(recordUrl))
    expect(current).toMatchObject({ id: created.id, version: replacement.version, printDisposition: 'pending', printedAt: '' })
    expect(current.assetId).not.toBe(before.assetId)
    release()
    await closed
    expect(navigations.filter(url => url.startsWith('blob:'))).toEqual([])
    await expect(page.getByText(/送货原件身份、正文或摘要校验失败|待打印送货单或当前原件已变化/)).toBeVisible()
    expect(await json(await page.request.get(recordUrl))).toMatchObject({ version: replacement.version, printDisposition: 'pending', printedAt: '' })
  }
  finally {
    release()
    await page.unroute(matchOriginal, holdOriginal)
  }

  const query = new URLSearchParams({ origin: 'real', projectId: project.id, supplierId: supplier.id })
  const historical = await json(await page.request.get(`${originalPath}?${query}`))
  expect(Buffer.from(historical.payloadBase64, 'base64')).toEqual(originalA)
  const unrelated = await page.request.get(`${originalPath}?${query}`, { headers: { 'x-ruihang-test-session': `other-${randomUUID()}` } })
  expect(unrelated.status()).toBe(404)

  await page.reload()
  await expect(page).toHaveURL(url => url.pathname === '/')
  await page.getByRole('navigation').getByRole('link', { name: '送货单识别', exact: true }).click()
  await expect(page.getByRole('button', { name: '上传送货单', exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(queue.getByText('竞态原件B.pdf', { exact: true })).toBeVisible()
  await expect(page.locator('iframe[title="竞态原件B.pdf 原始 PDF"]')).toHaveAttribute('src', /^blob:/)
  const openingNew = page.waitForEvent('popup')
  await queue.getByRole('button', { name: '打开打印', exact: true }).click()
  const popupNew = await openingNew
  await expect(popupNew).toHaveURL(/^blob:/)
  const openedBytes = await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), popupNew.url())
  expect(Buffer.from(openedBytes)).toEqual(originalB)
  await popupNew.close()
  expect(await json(await page.request.get(recordUrl))).toMatchObject({ version: replacementVersion, printDisposition: 'pending', printedAt: '' })
})
