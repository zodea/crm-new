import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import type { SupplierCredentialSnapshot } from '../app/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import { startSyntheticCredentialOcr } from './helpers/synthetic-credential-ocr'

const sessionId = 'supplier-credential-447-e2e'
const pdf = Buffer.from(cooperationPdfFixture('Synthetic credential 447'))
let synthetic: Awaited<ReturnType<typeof startSyntheticCredentialOcr>>
let sequence = 0
test.use({ actionTimeout: 15000, navigationTimeout: 30000, extraHTTPHeaders: { 'x-ruihang-test-session': sessionId } })
test.beforeAll(async () => {
  synthetic = await startSyntheticCredentialOcr(pdf)
})
test.afterAll(async () => {
  await synthetic?.close()
})
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
  expect((await page.request.post('/api/testing/suppliers/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })).ok()).toBe(true)
})
test.afterEach(async ({ page }) => {
  expect((await page.request.post('/api/testing/suppliers/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })).ok()).toBe(true)
})
async function snapshot(request: APIRequestContext, id: string): Promise<SupplierCredentialSnapshot> {
  const response = await request.get(`/api/read/supplier-credentials/${id}?origin=real`)
  expect(response.ok(), await response.text()).toBe(true)
  return response.json()
}
async function seed(request: APIRequestContext) {
  const session = await (await request.get('/api/read/business-session')).json()
  const response = await request.post('/api/commands/suppliers', { data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', commandId: `create-${++sequence}`, action: 'save', baseVersion: null, attachments: {}, draft: { name: 'OCR 中央核对合成公司', supplierCategory: '其他', contact: '合成联系人', uniqueCode: 'INTERNAL-447', taxNo: 'CURRENT-TAX-447', taxpayerType: '一般纳税人' } } })
  expect(response.ok(), await response.text()).toBe(true)
  const { id } = await response.json()
  for (const category of ['营业执照', '法人身份证', '银行账户资料']) {
    const current = await snapshot(request, id)
    const uploaded = await request.post('/api/commands/supplier-credentials', { data: { commandId: `upload-${++sequence}`, supplierId: id, origin: 'real', workspaceId: current.workspaceId, actorId: current.actorId, requiredCapability: 'supplier-credential:write', baseSupplierVersion: current.supplierVersion, baseCredentialVersion: current.credentialVersion, action: 'upload', draft: { category, validFrom: '', expiresAt: '', longTerm: false, fileName: `合成${category}.pdf`, fileSize: pdf.length, mimeType: 'application/pdf', payloadBase64: pdf.toString('base64') } } })
    expect(uploaded.ok(), await uploaded.text()).toBe(true)
  }
  return id as string
}
async function changeMaster(request: APIRequestContext, id: string, patch: Record<string, unknown>) {
  const session = await (await request.get('/api/read/business-session')).json()
  const current = await (await request.get(`/api/read/suppliers/${id}/form`)).json()
  const changed = await request.put(`/api/commands/suppliers/${id}`, { data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', commandId: `master-${++sequence}`, action: 'save', baseVersion: current.version, id, attachments: {}, draft: { ...current.draft, ...patch } } })
  expect(changed.ok(), await changed.text()).toBe(true)
  expect((await changed.json()).version).not.toBe(current.version)
}
async function evidence(page: Page, info: TestInfo, name: string, focus?: Locator) {
  await page.mouse.move(1, 1)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    if (focus)
      await focus.scrollIntoViewIfNeeded()
    if (name === '14-taxpayer-saved-proof') {
      await focus!.evaluate(element => element.closest('.field-block')!.scrollIntoView({ block: 'center' }))
      await expect(focus!).toContainText('官网未查到，保持未核验')
      await expect(focus!).toContainText(/来源：\s*广东省电子税务局/)
      const statusBox = await focus!.boundingBox()
      const headingBox = await page.getByRole('heading', { name: '编辑 · 分供方', exact: true }).boundingBox()
      expect(statusBox!.y).toBeGreaterThan(headingBox!.y + headingBox!.height)
      expect(statusBox!.y + statusBox!.height).toBeLessThan(width === 390 ? 844 : 960)
    }
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const dialog = page.getByRole('dialog')
    if (await dialog.count()) {
      const box = await dialog.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
    if (name === '04-conflicting-tax-number-choices' && width <= 768) {
      const fields = page.getByLabel('OCR 字段核对表，可横向滚动', { exact: true })
      await fields.evaluate(element => element.scrollTo({ left: 0 }))
      await fields.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => fields.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(0)
      await focus!.scrollIntoViewIfNeeded()
    }
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
}

test('授权合成原件识别失败重试、稍后冷读、税号矛盾和陈旧确认保选择、重新识别保留确认', async ({ page }, info) => {
  test.setTimeout(300000)
  const id = await seed(page.request)
  await page.goto(`/base/supplier/credential/${id}?origin=real`)
  const recognize = page.getByRole('button', { name: '识别当前原件 合成营业执照.pdf', exact: true })
  await expect(recognize).toBeVisible()
  await evidence(page, info, '01-current-original', recognize)
  synthetic.failOnce()
  await recognize.click()
  const dialog = page.getByRole('dialog', { name: '证照识别与人工核对' })
  await expect(dialog.getByRole('alert')).toContainText('合成识别服务故障', { timeout: 20000 })
  await evidence(page, info, '02-recognition-failure-retains-original', dialog.getByRole('alert'))
  await dialog.getByRole('button', { name: '识别原件', exact: true }).click()
  await expect(dialog.getByText('识别候选已保存，请人工核对；也可以稍后继续。', { exact: true })).toBeVisible({ timeout: 20000 })
  const saved = await snapshot(page.request, id)
  expect(saved.masterValues).toMatchObject({ taxNo: 'CURRENT-TAX-447', uniqueCode: 'INTERNAL-447' })
  expect(synthetic.captured.at(-1)?.bytes.equals(pdf)).toBe(true)
  expect(saved.credentials[0]?.ocrReviewStatus).toBe('pending')
  await dialog.getByRole('button', { name: '稍后核对', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '核对识别结果 合成营业执照.pdf', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await evidence(page, info, '03-pending-candidates-after-refresh', dialog.getByRole('heading', { name: '证照识别与人工核对' }))
  const tax = dialog.getByRole('group', { name: '统一社会信用代码 / 税号', exact: true })
  await expect(tax.getByRole('radio', { name: '保留当前值', exact: true })).toBeChecked()
  await expect(tax.getByText('913100001234567890', { exact: true })).toBeVisible()
  await expect(tax.getByText('913100009876543210', { exact: true })).toBeVisible()
  const selected = tax.getByRole('radio', { name: '使用识别值 2：纳税人识别号', exact: true })
  await selected.check()
  await evidence(page, info, '04-conflicting-tax-number-choices', selected)
  await changeMaster(page.request, id, { taxNo: 'HUMAN-CONCURRENT-447' })
  await dialog.getByRole('button', { name: '保存核对结果', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('变化')
  await expect(selected).toBeChecked()
  await evidence(page, info, '05-stale-confirmation-retains-choices', dialog.getByRole('alert'))
  await dialog.getByRole('button', { name: '重新核对当前资料', exact: true }).click()
  await expect(tax.getByText('HUMAN-CONCURRENT-447', { exact: true })).toBeVisible()
  await expect(selected).toBeChecked()
  const confirmationCommands: string[] = []
  let loseConfirmation = true
  await page.route('**/api/commands/supplier-credentials', async (route) => {
    if (route.request().postDataJSON().action !== 'ocr-confirm') {
      await route.continue()
      return
    }
    confirmationCommands.push(route.request().postDataJSON().commandId)
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    if (loseConfirmation) {
      loseConfirmation = false
      await route.abort('failed')
    }
    else {
      await route.fulfill({ response })
    }
  })
  await dialog.getByRole('button', { name: '保存核对结果', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '恢复原提交', exact: true })).toBeVisible()
  await expect(selected).toBeChecked()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click({ force: true })
  await expect(dialog).toBeVisible()
  await evidence(page, info, '13-ocr-confirmation-lost-response', dialog.getByRole('button', { name: '恢复原提交', exact: true }))
  await dialog.getByRole('button', { name: '恢复原提交', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(confirmationCommands).toHaveLength(2)
  expect(confirmationCommands[0]).toBe(confirmationCommands[1])
  await page.unroute('**/api/commands/supplier-credentials')
  await expect(page.getByRole('button', { name: '核对识别结果 合成营业执照.pdf', exact: true })).toBeFocused()
  const confirmed = await snapshot(page.request, id)
  expect(confirmed.masterValues).toMatchObject({ taxNo: '913100009876543210', uniqueCode: 'INTERNAL-447' })
  expect(confirmed.credentials[0]?.ocrReviewStatus).toBe('confirmed')
  await page.goto(`/base/supplier/form/${id}?origin=real`)
  await expect(page.getByLabel('统一社会信用代码', { exact: true })).toHaveValue('913100009876543210')
  await expect(page.getByLabel('唯一识别码', { exact: true })).toHaveValue('INTERNAL-447')
  await evidence(page, info, '06-confirmed-master-readback', page.getByLabel('统一社会信用代码', { exact: true }))
  await page.goto(`/base/supplier/credential/${id}?origin=real`)
  await recognize.click()
  await expect(dialog.getByText('识别候选已保存，请人工核对；也可以稍后继续。', { exact: true })).toBeVisible({ timeout: 20000 })
  const reread = await snapshot(page.request, id)
  expect(reread.credentials[0]).toMatchObject({ ocrReviewStatus: 'pending', ocrConfirmedAt: confirmed.credentials[0]!.ocrConfirmedAt, ocrConfirmedResult: confirmed.credentials[0]!.ocrConfirmedResult })
  await dialog.getByText('历史识别与人工确认记录', { exact: true }).click()
  await expect(dialog.getByRole('region', { name: '上次人工确认', exact: true })).toContainText('913100009876543210')
  await evidence(page, info, '07-rerecognition-preserves-confirmation', dialog.getByText('历史识别与人工确认记录', { exact: true }))
  await dialog.getByRole('button', { name: '关闭', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(recognize).toBeFocused()
})

test('人工税务核验失响应同键恢复、保留主档未保存备注、并发核验保稿及冷读', async ({ page }, info) => {
  test.setTimeout(300000)
  const id = await seed(page.request)
  await page.goto(`/base/supplier/form/${id}?origin=real`)
  const note = page.getByPlaceholder('补充说明', { exact: true })
  await note.fill('当前窗口尚未保存的经营备注')
  const trigger = page.getByRole('button', { name: '记录人工核验', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '记录纳税人核验结果' })
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await dialog.getByRole('combobox', { name: /^核验结果/ }).selectOption('not_found')
  await dialog.getByLabel('核验备注', { exact: true }).fill('合成核验：未查到，继续待确认')
  await evidence(page, info, '08-taxpayer-manual-dialog', dialog.getByRole('combobox', { name: /^核验结果/ }))
  const commands: string[] = []
  const endpoint = `**/api/commands/suppliers/${id}/taxpayer-verification`
  let loseResponse = true
  await page.route(endpoint, async (route) => {
    commands.push(route.request().postDataJSON().commandId)
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    if (loseResponse) {
      loseResponse = false
      await route.abort('failed')
    }
    else { await route.fulfill({ response }) }
  })
  await dialog.getByRole('button', { name: '保存核验记录', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '恢复原提交', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('核验备注', { exact: true })).toHaveValue('合成核验：未查到，继续待确认')
  await evidence(page, info, '09-taxpayer-lost-response-retains-input', dialog.getByLabel('核验备注', { exact: true }))
  await dialog.getByRole('button', { name: '恢复原提交', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(commands).toHaveLength(2)
  expect(commands[0]).toBe(commands[1])
  await page.unroute(endpoint)
  await expect(note).toHaveValue('当前窗口尚未保存的经营备注')
  let current = await (await page.request.get(`/api/read/suppliers/${id}/form`)).json()
  expect(current.draft).toMatchObject({ taxpayerVerificationStatus: 'not_found', taxpayerType: '未核验', note: '' })
  await evidence(page, info, '10-taxpayer-proof-and-unsaved-note', note)
  await evidence(page, info, '14-taxpayer-saved-proof', page.getByRole('status', { name: '纳税人核验留痕', exact: true }))
  await trigger.click()
  await dialog.getByRole('combobox', { name: /^核验结果/ }).selectOption('manually_confirmed')
  await dialog.getByRole('combobox', { name: /^人工确认类型/ }).selectOption('一般纳税人')
  await dialog.getByLabel('核验备注', { exact: true }).fill('合成人工复核结果，版本冲突仍保留')
  await changeMaster(page.request, id, { note: '另一窗口已保存备注' })
  await dialog.getByRole('button', { name: '保存核验记录', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '重新核对当前主档', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('核验备注', { exact: true })).toHaveValue('合成人工复核结果，版本冲突仍保留')
  await evidence(page, info, '11-taxpayer-stale-input', dialog.getByLabel('核验备注', { exact: true }))
  await dialog.getByRole('button', { name: '重新核对当前主档', exact: true }).click()
  await dialog.getByRole('button', { name: '保存核验记录', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(note).toHaveValue('当前窗口尚未保存的经营备注')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '保留我的内容', exact: true }).click()
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'OCR 中央核对合成公司', exact: true })).toBeVisible()
  current = await (await page.request.get(`/api/read/suppliers/${id}/form`)).json()
  expect(current.draft).toMatchObject({ taxpayerVerificationStatus: 'manually_confirmed', taxpayerType: '一般纳税人', taxpayerVerificationNote: '合成人工复核结果，版本冲突仍保留', note: '当前窗口尚未保存的经营备注' })
  expect(current.draft.taxpayerVerifiedAt).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'OCR 中央核对合成公司', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
  await expect(page.getByLabel('统一社会信用代码', { exact: true })).toHaveValue('CURRENT-TAX-447')
  await expect(note).toHaveValue('当前窗口尚未保存的经营备注')
  await trigger.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '查看纳税人类型说明', exact: true }).click()
  const proof = page.locator('[data-ui="context-help-popover"]')
  await expect(proof).toContainText('合成人工复核结果，版本冲突仍保留')
  await evidence(page, info, '12-taxpayer-cold-proof', page.getByRole('button', { name: '查看纳税人类型说明', exact: true }))
})
