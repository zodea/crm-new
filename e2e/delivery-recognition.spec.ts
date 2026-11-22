import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { installMaterialProductionFixture, MATERIAL_PRODUCTION_FIXTURE } from './helpers/material-production-fixture'

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64')
const fixtures = new WeakMap<Page, Awaited<ReturnType<typeof installMaterialProductionFixture>>>()
const cases = [
  { name: '整数数量', no: 'SH-E2E-INTEGER', date: '2026-07-17', ocrDate: '2026.07.17', qty: '4', alteredQty: '5', price: '155.50', amount: '622', ocrAmount: '622.00', wrongAmount: '600' },
  { name: '小数数量与闰日', no: 'SH-E2E-DECIMAL', date: '2028-02-29', ocrDate: '2028.02.29', qty: '0.5', alteredQty: '1', price: '12.50', amount: '6.25', ocrAmount: '6.25', wrongAmount: '7' },
] as const

function markdown(input: typeof cases[number], supplier: string = MATERIAL_PRODUCTION_FIXTURE.supplierName) {
  return `# ${supplier}销售单\n客户名称：广州市瑞航建筑工程有限公司\n送货地址：${MATERIAL_PRODUCTION_FIXTURE.projectName}\n单号：${input.no}\n日期：${input.ocrDate}\n<table><tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr><tr><td>1</td><td>普通硅酸盐水泥</td><td>P.O 42.5</td><td>袋</td><td>${input.qty}</td><td>${input.price}</td><td>${input.ocrAmount}</td></tr><tr><td></td><td>合计</td><td></td><td></td><td></td><td></td><td>${input.ocrAmount}</td></tr></table>`
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000)
  fixtures.set(page, await installMaterialProductionFixture(page))
  await page.clock.install({ time: new Date('2026-08-06T04:00:00.000Z') })
})

async function chooseLookup(page: Page, label: string, name: string) {
  await page.getByLabel(label, { exact: true }).fill(name)
  await page.getByRole('option').filter({ hasText: name }).first().click()
}

async function scan(page: Page) {
  return Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 900
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = '#222'
    context.lineWidth = 3
    context.beginPath()
    context.moveTo(0, 1)
    context.lineTo(canvas.width, 1)
    context.stroke()
    context.strokeStyle = '#d33'
    context.strokeRect(185, 160, 230, 620)
    for (let y = 220; y < 780; y += 70) {
      context.beginPath()
      context.moveTo(185, y)
      context.lineTo(415, y)
      context.stroke()
    }
    return canvas.toDataURL('image/png').split(',')[1]!
  }), 'base64')
}

for (const input of cases) {
  test(`正式送货闭环：上传识别、主数据匹配、人工核对、打印和原件留痕：${input.name}`, async ({ page }) => {
    const fixture = fixtures.get(page)!
    const errors: string[] = []
    let derived = false
    let orientationDisabled = false
    page.on('pageerror', error => errors.push(error.message))
    const content = markdown(input)
    await page.route('**/api/ocr/recognize', (route) => {
      const multipart = route.request().postDataBuffer()?.toString('latin1') ?? ''
      derived = multipart.includes('.ocr.png')
      orientationDisabled = multipart.includes('useDocOrientationClassify') && multipart.includes('false')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ engine: 'paddleocr-official-api', model: 'PaddleOCR-VL-1.6', jobId: `job-delivery-${input.no}`, pages: [{ pageIndex: 0, markdown: content, prunedResult: {}, layoutRegions: [] }], markdownPages: [content], dataInfo: { numPages: 1 } }) })
    })
    await page.goto('/material/delivery')
    await expect(page.getByRole('button', { name: '上传送货单', exact: true })).toBeVisible()
    const picker = page.waitForEvent('filechooser')
    const buffer = await scan(page)
    await page.getByRole('button', { name: '上传送货单', exact: true }).click()
    await (await picker).setFiles({ name: `${input.no}-送货单.png`, mimeType: 'image/png', buffer })
    const review = page.locator('.delivery-review-panel')
    await expect(review.getByText('单号', { exact: true }).locator('..').locator('input')).toHaveValue(input.no)
    await expect(review.getByPlaceholder('材料名称').first()).toHaveValue('普通硅酸盐水泥')
    await expect(review.locator('select').first()).toHaveValue(fixture.projectId)
    await expect(review.getByPlaceholder('搜索分供方名称')).toHaveValue(fixture.supplierName)
    await expect(page.getByText('金额已勾稽', { exact: true })).toBeVisible()
    expect(derived).toBe(true)
    expect(orientationDisabled).toBe(true)
    const row = review.locator('tbody tr').first()
    const qty = row.locator('input[type="number"]').nth(0)
    const amount = row.locator('input[type="number"]').nth(2)
    await amount.fill(input.wrongAmount)
    await expect(page.getByText('1 行金额不平', { exact: true }).first()).toBeVisible()
    await qty.fill(input.alteredQty)
    await expect(amount).toHaveValue(input.wrongAmount)
    await qty.fill(input.qty)
    await amount.fill(input.amount)
    await expect(page.getByText('金额已勾稽', { exact: true })).toBeVisible()
    await review.getByRole('button', { name: '确认人工归档', exact: true }).click()
    const archiveResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/deliveries')
    await page.getByRole('dialog').getByRole('button', { name: '确认人工归档', exact: true }).click()
    const result = await archiveResponse
    expect(result.ok(), await result.text()).toBe(true)
    await expect(page.getByText('已归档 · 待打印', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    const records = (await (await page.request.get('/api/read/deliveries?origin=real')).json()).records
    const archived = records.find((record: { orderNo: string }) => record.orderNo === input.no)
    expect(archived).toMatchObject({ projectId: fixture.projectId, supplierId: fixture.supplierId, deliveryDate: input.date, totalAmount: Number(input.amount), printDisposition: 'pending' })
    await page.reload()
    await expect(page).toHaveURL(url => url.pathname === '/material/delivery')
    await expect(page.getByText('已归档 · 待打印', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '登记已打印', exact: true }).first().click()
    const print = page.getByRole('dialog', { name: '登记实际打印回执', exact: true })
    await expect(print).toContainText('只打开过预览或取消打印时不要确认')
    await print.getByRole('button', { name: '确认已实际打印', exact: true }).click()
    await expect(page.getByText('已登记打印成功，文件已移出待打印范围', { exact: true })).toBeVisible()
    await expect(page.getByText('上传 PDF 或图片开始识别', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '归档库', exact: true }).click()
    await page.getByRole('link', { name: input.no, exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === `/material/delivery/archive/${archived.id}` && url.searchParams.get('origin') === 'real')
    const image = page.getByTestId('delivery-source-image')
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', /^blob:/)
    await expect(page.getByRole('button', { name: '替换原件', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '编辑', exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === `/material/delivery/archive/form/${archived.id}` && url.searchParams.get('origin') === 'real')
    await expect(page.getByTestId('delivery-source-panel').getByTestId('delivery-source-image')).toBeVisible()
    await expect(page.getByText('归档不是终态：归属与结构化字段可修正；原件和 OCR 原文只留痕，不随修改覆盖。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '替换原件', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('未保存原件的正式送货记录：详情补传需原因及确认，编辑回读保留原件', async ({ page }) => {
  const fixture = fixtures.get(page)!
  await page.goto('/material/delivery/archive?origin=real')
  await page.getByRole('link', { name: '新增送货单', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新建 · 送货单归档', exact: true })).toBeVisible()
  await chooseLookup(page, '检索项目', fixture.projectName)
  await chooseLookup(page, '依据原件选择分供方', fixture.supplierName)
  await page.getByLabel('送货单号', { exact: true }).fill('SH-E2E-NO-SOURCE')
  await page.getByLabel('送货日期 *', { exact: true }).fill('2026-08-06')
  await page.getByLabel('材料名称', { exact: true }).fill('手工补录材料')
  await page.getByLabel('单位', { exact: true }).fill('袋')
  await page.getByLabel('数量', { exact: true }).fill('1')
  const saving = page.waitForResponse(response => response.url().endsWith('/api/commands/deliveries') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存送货单', exact: true }).click()
  await page.getByRole('dialog', { name: '确认按价格待补录归档', exact: true }).getByRole('button', { name: '确认待补录', exact: true }).click()
  await expect(page.getByText('送货单归档已新增', { exact: true })).toBeVisible()
  const saved = await saving
  expect(saved.ok(), await saved.text()).toBe(true)
  const receipt = await saved.json()
  await expect(page).toHaveURL(url => url.pathname === `/material/delivery/archive/${receipt.id}` && url.searchParams.get('origin') === 'real')
  const detailUrl = page.url()
  const panel = page.getByTestId('delivery-source-panel')
  await expect(panel.getByText('历史记录未保存原件', { exact: true })).toBeVisible()
  const picker = page.waitForEvent('filechooser')
  await panel.getByRole('button', { name: '补传原件', exact: true }).click()
  await (await picker).setFiles({ name: '手工补传原件.png', mimeType: 'image/png', buffer: PNG_1PX })
  await panel.getByLabel('原件修订原因 *', { exact: true }).fill('补传纸质归档的合成原件')
  await panel.getByRole('button', { name: '确认保存原件', exact: true }).click()
  await expect(panel.getByTestId('delivery-source-image')).toBeVisible()
  await page.getByRole('link', { name: '编辑', exact: true }).click()
  await expect(page.getByTestId('delivery-source-image')).toBeVisible()
  await expect(page.getByText('归档不是终态：归属与结构化字段可修正；原件和 OCR 原文只留痕，不随修改覆盖。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '补传原件', exact: true })).toHaveCount(0)
  await page.goto(detailUrl)
  await expect(page.getByTestId('delivery-source-image')).toHaveAttribute('src', /^blob:/)
})

test('模糊分供方只给建议，人工采用后才绑定正式分供方并记为别名', async ({ page }) => {
  const fixture = fixtures.get(page)!
  const fuzzyName = fixture.supplierName.replace('司', '可')
  const content = markdown(cases[0], fuzzyName)
  await page.route('**/api/ocr/recognize', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ engine: 'paddleocr-official-api', model: 'PaddleOCR-VL-1.6', jobId: 'job-delivery-fuzzy', pages: [{ pageIndex: 0, markdown: content, prunedResult: {}, layoutRegions: [] }], markdownPages: [content], dataInfo: { numPages: 1 } }) }))
  await page.goto('/material/delivery')
  const picker = page.waitForEvent('filechooser')
  const buffer = await scan(page)
  await page.getByRole('button', { name: '上传送货单', exact: true }).click()
  await (await picker).setFiles({ name: 'E2E模糊分供方送货单.png', mimeType: 'image/png', buffer })
  const review = page.locator('.delivery-review-panel')
  await expect(review.getByPlaceholder('搜索分供方名称')).toHaveValue('')
  const aliasCommand = page.waitForResponse(response => new URL(response.url()).pathname === `/api/commands/suppliers/${fixture.supplierId}` && response.request().method() === 'PUT')
  await page.getByRole('button', { name: '采用并记为别名', exact: true }).click()
  await expect(review.getByPlaceholder('搜索分供方名称')).toHaveValue(fixture.supplierName)
  const saved = await aliasCommand
  expect(saved.ok(), await saved.text()).toBe(true)
  expect((await saved.json()).id).toBe(fixture.supplierId)
  const source = await (await page.request.get('/api/read/deliveries/context?origin=real')).json()
  expect(source.suppliers.find((supplier: { id: string }) => supplier.id === fixture.supplierId).aliases).toContain(fuzzyName)
})
