import type { Page, TestInfo } from '@playwright/test'
import type { SupplierCredentialSnapshot } from '../app/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { test as base, expect } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'

const widths = [390, 768, 1024, 1280, 1440]
const test = base.extend<{ migrated: boolean, credentialSession: string }>({
  migrated: [false, { option: true }],
  credentialSession: async ({ migrated }, use) => { await use(migrated ? 'default' : `credential-${randomUUID()}`) },
})
const supplierInput = { name: '证照中央验收合成供应商（同一工商主档、原件、资料核验和列表回读）', contact: '合成联系人', category: '材料供应商', search: '证照中央验收', reviewNote: '合成原件均已人工核对' }
const uploads = [
  { category: '营业执照', captureDialog: true, loseResponse: false },
  { category: '法人身份证', captureDialog: false, loseResponse: false },
  { category: '银行账户资料', captureDialog: false, loseResponse: true },
]
const migratedSuppliers = [
  { label: '完整迁入证照分供方', status: 'qualified', state: 'available', count: 1 },
  { label: '旧路径缺少正文分供方', status: 'incomplete', state: 'missing', count: 0 },
]
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })
const pdf = Buffer.from(cooperationPdfFixture('Synthetic credential 446'))
async function evidence(page: Page, info: TestInfo, state: string) {
  await page.mouse.move(1, 1)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    if (!/^0[236]-/.test(state))
      await page.locator('[data-shell-workspace]').evaluate(element => element.scrollTo({ top: 0 }))
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
    if (state.startsWith('12-')) {
      await page.getByRole('button', { name: '筛选营业执照', exact: true }).scrollIntoViewIfNeeded()
      const originalLink = page.getByRole('link', { name: '1 份', exact: true })
      await originalLink.scrollIntoViewIfNeeded()
      await expect.poll(async () => {
        const header = await page.getByRole('button', { name: '筛选营业执照', exact: true }).evaluate((element) => {
          const box = element.closest('th')!.getBoundingClientRect()
          return { left: box.left, right: box.right }
        })
        const cell = await originalLink.evaluate((element) => {
          const box = element.closest('td')!.getBoundingClientRect()
          return { left: box.left, right: box.right }
        })
        return Math.max(Math.abs(header.left - cell.left), Math.abs(header.right - cell.right))
      }).toBeLessThanOrEqual(2)
    }
    await page.screenshot({ path: info.outputPath(`${state}-${width}.png`), fullPage: true, animations: 'disabled' })
    if (width <= 1024 && /^(?:04|05|07|09|10|11)-/.test(state)) {
      await page.getByLabel('证照原件表，可横向滚动', { exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`${state}-originals-${width}.png`), fullPage: true, animations: 'disabled' })
      await page.locator('[data-shell-workspace]').evaluate(element => element.scrollTo({ top: 0 }))
    }
  }
}
test.beforeEach(async ({ page, credentialSession }) => {
  const currentSession = credentialSession
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': currentSession })
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': currentSession })
  const reset = await page.request.post('/api/testing/suppliers/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': currentSession }, data: { scenario: 'ready' } })
  expect(reset.ok()).toBe(true)
})
test.afterEach(async ({ page, credentialSession }) => {
  const currentSession = credentialSession
  const reset = await page.request.post('/api/testing/suppliers/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': currentSession }, data: { scenario: 'ready' } })
  expect(reset.ok()).toBe(true)
  if (currentSession === 'default') {
    const core = await page.request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
    expect(core.ok(), await core.text()).toBe(true)
  }
})

test.describe('历史证照完整迁入', () => {
  test.use({ migrated: true })
  test('真实旧库完整图迁入、历史凭证回读、同原件撤回与缺正文不冒充齐全', async ({ page, request }, info) => {
    test.setTimeout(300_000)
    const reset = await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
    expect(reset.ok(), await reset.text()).toBe(true)
    const destination = info.outputPath('supplier-credential-source.json')
    await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/supplier-credential-migration-source.ts'), destination])
    const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(destination, 'utf8'))
    const session = await (await request.get('/api/read/business-session')).json()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId, requiredCapability: 'core:migration:write' })
    const preflight = await request.post('/api/migrations/core/preflight', { data: { ...envelope('credential-http-preflight'), source, backup: null } })
    expect(preflight.ok(), await preflight.text()).toBe(true)
    const dry = await request.post('/api/migrations/core/dry-run', { data: { ...envelope('credential-http-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } } })
    expect(dry.ok(), await dry.text()).toBe(true)
    const batch = await dry.json()
    expect(batch.issues).toEqual([])
    for (const action of ['import', 'import', 'confirm', 'confirm']) {
      const response = await request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(`credential-http-${action}`), batchId: batch.batchId } })
      expect(response.ok(), await response.text()).toBe(true)
    }
    const supplierList = await (await request.get('/api/read/suppliers')).json()
    const full = supplierList.items.find((row: { supplier: { label: string } }) => row.supplier.label === migratedSuppliers[0]!.label)
    const missing = supplierList.items.find((row: { supplier: { label: string } }) => row.supplier.label === migratedSuppliers[1]!.label)
    for (const input of migratedSuppliers) {
      const row = supplierList.items.find((entry: { supplier: { label: string } }) => entry.supplier.label === input.label)
      expect(row).toMatchObject({ credentialStatus: input.status, businessLicense: { state: input.state, fileCount: input.count } })
    }
    const read = async (id: string): Promise<SupplierCredentialSnapshot> => (await request.get(`/api/read/supplier-credentials/${id}?origin=real`)).json()
    const initial = await read(full.supplier.id)
    expect(initial.credentials).toHaveLength(uploads.length)
    expect(initial.review).toMatchObject({ actorId: null, note: '迁入前已逐件人工核对' })
    await page.goto(`/base/supplier/credential/${full.supplier.id}?origin=real`)
    await expect(page.getByRole('heading', { name: '完整迁入证照分供方 · 证照附件' })).toBeVisible()
    await page.reload()
    await expect(page.getByText('迁入前已逐件人工核对')).toBeVisible()
    await evidence(page, info, '09-migrated-manual-proof-and-ocr-history')
    const deletion = initial.audits.find(row => row.canRestore)!
    await page.getByRole('button', { name: '撤回本次删除', exact: true }).click()
    const restore = page.getByRole('dialog', { name: '撤回本次删除' })
    await restore.getByRole('button', { name: '确认撤回' }).click()
    await expect(restore).toHaveCount(0)
    const restored = await read(full.supplier.id)
    expect(restored.status).toBe('qualified')
    const original = restored.credentials.find(row => row.id === deletion.credentialId)!
    const file = await (await request.get(`/api/read/supplier-credentials/${full.supplier.id}/files/${original.file!.id}?origin=real&credentialId=${original.id}`)).json()
    expect(file.state).toBe('available')
    expect(Buffer.from(file.payloadBase64, 'base64')).toEqual(pdf)
    await evidence(page, info, '10-migrated-deletion-restores-same-original')
    const rollback = await request.post(`/api/migrations/core/${batch.batchId}/rollback`, { data: { ...envelope('credential-http-rollback'), batchId: batch.batchId } })
    expect(rollback.status()).toBe(409)
    expect((await read(full.supplier.id)).credentials).toHaveLength(4)
    await page.goto(`/base/supplier/credential/${missing.supplier.id}?origin=real`)
    await expect(page.getByText(/缺少正文，请重新上传/)).toBeVisible()
    await expect(page.getByRole('button', { name: '人工核验通过', exact: true })).toBeDisabled()
    await evidence(page, info, '11-legacy-path-is-not-a-readable-original')
  })
})

test('中央建档、原件上传与恢复提交、人工核验、冷刷新及原件删除撤回', async ({ page, credentialSession: sessionId }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/base/supplier')
  await expect(page.getByRole('button', { name: '新增分供方', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '新增分供方' }).click()
  const typeDialog = page.getByRole('dialog', { name: '选择分供方类别' })
  await typeDialog.getByRole('radio', { name: supplierInput.category }).check()
  await typeDialog.getByRole('button', { name: '进入新建表单' }).click()
  const name = supplierInput.name
  await page.getByLabel('公司全称 *', { exact: true }).fill(name)
  await page.getByLabel('主要联系人 *', { exact: true }).fill(supplierInput.contact)
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const supplierId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.getByRole('link', { name: '返回分供方列表' }).click()
  await page.getByPlaceholder('搜索关键词…').fill(supplierInput.search)
  await page.getByRole('link', { name, exact: true }).first().click()
  await page.getByRole('link', { name: '证照附件', exact: true }).click()
  await expect(page.getByRole('button', { name: '上传原件', exact: true })).toBeVisible()
  await evidence(page, info, '01-empty-current-supplier')
  const snapshot = async (): Promise<SupplierCredentialSnapshot> => {
    const response = await page.request.get(`/api/read/supplier-credentials/${supplierId}?origin=real`, { headers: { 'x-ruihang-test-session': sessionId } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const commandIds: string[] = []
  for (const input of uploads) {
    const category = input.category
    await page.getByRole('button', { name: '上传原件', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '上传证照原件' })
    await editor.getByLabel('选择原件').setInputFiles({ name: `${category}－仅用于隔离验收的超长文件名称与中文原件.pdf`, mimeType: 'application/pdf', buffer: pdf })
    await editor.getByRole('combobox', { name: /^证照类别/ }).selectOption(category)
    if (input.captureDialog) {
      await evidence(page, info, '02-original-upload-dialog')
      await page.keyboard.press('Tab')
      expect(await editor.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    if (input.loseResponse) {
      let first = true
      await page.route('**/api/commands/supplier-credentials', async (route) => {
        commandIds.push(route.request().postDataJSON().commandId)
        if (first) {
          first = false
          await route.fetch()
          await route.abort('failed')
        }
        else { await route.continue() }
      })
    }
    await editor.getByRole('button', { name: '保存原件', exact: true }).click()
    if (input.loseResponse) {
      await expect(editor.getByRole('button', { name: '恢复原提交' })).toBeVisible()
      await evidence(page, info, '03-lost-response-retained-draft')
      await editor.getByRole('button', { name: '恢复原提交' }).click()
      await page.unroute('**/api/commands/supplier-credentials')
    }
    await expect(editor).toHaveCount(0)
  }
  expect(new Set(commandIds).size).toBe(1)
  expect((await snapshot()).credentials).toHaveLength(uploads.length)
  await expect(page.getByRole('button', { name: '人工核验通过', exact: true })).toBeEnabled()
  await evidence(page, info, '04-complete-awaiting-review')
  await page.getByRole('button', { name: '人工核验通过', exact: true }).click()
  const review = page.getByRole('dialog', { name: '人工核验通过' })
  await review.getByLabel('核验备注（选填）').fill(supplierInput.reviewNote)
  await review.getByRole('button', { name: '确认通过', exact: true }).click()
  await expect(review).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(supplierInput.reviewNote)).toBeVisible()
  const qualified = await snapshot()
  expect(qualified.status).toBe('qualified')
  await evidence(page, info, '05-qualified-after-cold-refresh')
  const original = qualified.credentials.find(row => row.category === uploads[0]!.category)!
  await page.getByRole('button', { name: `下载 ${original.file!.fileName}`, exact: true }).scrollIntoViewIfNeeded()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: `下载 ${original.file!.fileName}`, exact: true }).click()
  const downloaded = await download
  expect(await readFile((await downloaded.path())!)).toEqual(pdf)
  await page.getByRole('button', { name: `预览 ${original.file!.fileName}`, exact: true }).click()
  const preview = page.getByRole('dialog', { name: original.file!.fileName, exact: true })
  await expect(preview.getByTitle('证照 PDF 原件预览')).toBeVisible()
  await expect(preview.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(page.getByRole('button', { name: `预览 ${original.file!.fileName}`, exact: true })).toBeFocused()
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 720
    canvas.height = 420
    const paint = canvas.getContext('2d')!
    paint.fillStyle = '#ffffff'
    paint.fillRect(0, 0, 720, 420)
    paint.fillStyle = '#204775'
    paint.fillRect(0, 0, 720, 76)
    paint.fillStyle = '#ffffff'
    paint.font = 'bold 28px sans-serif'
    paint.fillText('原件预览验收 · 合成资料', 32, 48)
    paint.fillStyle = '#1e293b'
    paint.font = '24px sans-serif'
    paint.fillText('资料编号：SYNTHETIC-446', 32, 140)
    paint.fillText('用途：测试中央原件上传、预览和下载', 32, 194)
    paint.fillText('此图不包含真实证照或真实个人资料', 32, 248)
    paint.fillStyle = '#426755'
    paint.fillRect(32, 306, 656, 2)
    paint.font = '18px sans-serif'
    paint.fillText('QA ONLY · Generated fixture · Image original', 32, 354)
    return canvas.toDataURL('image/png').split(',')[1]!
  }), 'base64')
  await page.getByRole('button', { name: '上传原件', exact: true }).click()
  const imageEditor = page.getByRole('dialog', { name: '上传证照原件' })
  await imageEditor.getByLabel('选择原件').setInputFiles({ name: '合成资料原件.png', mimeType: 'image/png', buffer: png })
  await imageEditor.getByRole('combobox', { name: /^证照类别/ }).selectOption('其他')
  await imageEditor.getByRole('button', { name: '保存原件', exact: true }).click()
  await expect(imageEditor).toHaveCount(0)
  expect((await snapshot()).status).toBe('qualified')
  await page.getByRole('button', { name: '预览 合成资料原件.png', exact: true }).click()
  const imagePreview = page.getByRole('dialog', { name: '合成资料原件.png', exact: true })
  await expect(imagePreview.getByAltText('合成资料原件.png')).toHaveJSProperty('naturalWidth', 720)
  await expect(imagePreview.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await evidence(page, info, '06-controlled-original-preview')
  await page.keyboard.press('Escape')
  await expect(imagePreview).toHaveCount(0)
  await expect(page.getByRole('button', { name: '预览 合成资料原件.png', exact: true })).toBeFocused()
  await page.getByRole('button', { name: `删除 ${original.file!.fileName}`, exact: true }).click()
  await page.getByRole('dialog', { name: '删除证照', exact: true }).getByRole('button', { name: '确认删除' }).click()
  expect((await snapshot()).status).toBe('incomplete')
  const deletedFile = await page.request.get(`/api/read/supplier-credentials/${supplierId}/files/${original.file!.id}?origin=real&credentialId=${original.id}`, { headers: { 'x-ruihang-test-session': sessionId } })
  expect(deletedFile.status()).toBe(404)
  await page.getByRole('button', { name: '撤回本次删除', exact: true }).click()
  await page.getByRole('dialog', { name: '撤回本次删除' }).getByRole('button', { name: '确认撤回' }).click()
  expect((await snapshot()).status).toBe('reviewing')
  expect((await snapshot()).credentials.find(row => row.id === original.id)?.file?.id).toBe(original.file!.id)
  await evidence(page, info, '07-restored-original-requires-review')
  await page.getByRole('link', { name: '返回分供方详情' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回分供方列表' }).click()
  await expect(page.getByPlaceholder('搜索关键词…')).toHaveValue(supplierInput.search)
  await expect(page.getByRole('link', { name, exact: true }).first()).toBeFocused()
  await evidence(page, info, '08-list-same-status-and-original-count')
  await page.getByRole('button', { name: '筛选营业执照', exact: true }).click()
  const filter = page.getByRole('dialog', { name: '筛选营业执照', exact: true })
  await filter.getByRole('checkbox', { name: '缺少原件', exact: true }).check()
  await filter.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page.getByRole('status', { name: '没有符合条件的分供方' })).toBeVisible()
  await page.getByRole('button', { name: '筛选营业执照', exact: true }).click()
  await filter.getByRole('checkbox', { name: '缺少原件', exact: true }).uncheck()
  await filter.getByRole('checkbox', { name: '有原件', exact: true }).check()
  await filter.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible()
  await evidence(page, info, '12-business-license-filter-uses-current-originals')
  expect(errors).toEqual([])
})
