import type { Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off', hasTouch: true })

function sessionId(info: TestInfo) {
  return `issue421-supplier-${Buffer.from(info.testId).toString('base64url')}`
}

async function reset(page: Page, info: TestInfo, sensitiveRead = false) {
  const response = await page.context().request.post('/api/testing/suppliers/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId(info) },
    data: { scenario: 'ready', sensitiveRead },
  })
  expect(response.ok()).toBe(true)
}

test.beforeEach(async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId(info) })
  await reset(page, info, info.title.startsWith('中央导入：信用代码'))
})

test.afterEach(async ({ page }, info) => {
  await reset(page, info)
})

async function uploadCsv(page: Page, rows: string[], matched: string[], replaceId?: string) {
  await page.getByRole('button', { name: '导入分供方', exact: true }).click()
  await expect(page).toHaveURL(/\/import\/mapping\/supplier$/)
  await page.getByLabel('选择导入文件').setInputFiles({
    name: 'supplier-verification.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rows.join('\n'), 'utf-8'),
  })
  for (const key of matched)
    await expect(page.locator(`[data-field="${key}"]`)).toHaveAttribute('data-status', 'matched')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  if (replaceId) {
    await expect(page.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled()
    const review = page.getByRole('region', { name: '分供方重复资料核对' })
    await expect(review).toContainText('已有：中央导入验收供方')
    await expect(review).toContainText('张三')
    await expect(review).toContainText('王五')
    await review.getByLabel('第 2 行处理方式').selectOption(`replace:${replaceId}`)
  }
  const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/suppliers/import') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始导入', exact: true }).click()
  const response = await saved
  expect(response.ok()).toBe(true)
  const result = await response.json()
  await expect(page).toHaveURL(/\/base\/supplier$/)
  return result.id as string
}

test('中央导入：信用代码和唯一识别码独立映射，确认后重导更新并保留未映射资料', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/base/supplier')
  await expect(page.getByRole('heading', { name: '全部分供方' })).toBeVisible()
  const id = await uploadCsv(page, [
    '公司全称,分供方类别,唯一识别码,统一社会信用代码,主要联系人,主营业务,劳务承包范围,外部旧ID',
    '中央导入验收供方,专业分包商,RH-IMPORT-421,914401014210000001,张三,建筑施工,"石材安装\n楼梯铺贴",HQ-IMPORT-421',
  ], ['name', 'supplierCategory', 'uniqueCode', 'taxNo', 'contact', 'mainBusiness', 'laborScope', 'externalRef'])
  const list = page.locator('.supplier-reference-list')
  await expect(list.getByRole('link', { name: '中央导入验收供方', exact: true })).toBeVisible()
  const response = await page.context().request.get(`/api/read/suppliers/${id}/form`, { headers: { 'x-ruihang-test-session': sessionId(info) } })
  expect(response.ok()).toBe(true)
  expect(await response.json()).toMatchObject({ draft: { uniqueCode: 'RH-IMPORT-421', taxNo: '914401014210000001', laborScope: '石材安装\n楼梯铺贴' } })
  const updatedId = await uploadCsv(page, ['公司全称,主要联系人,外部旧ID', '中央导入验收供方,王五,HQ-IMPORT-421'], ['name', 'contact', 'externalRef'], id)
  expect(updatedId).toBe(id)
  await list.getByRole('searchbox').fill('中央导入验收供方')
  await expect(list.getByText('共 1 条', { exact: true })).toBeVisible()
  await list.getByRole('link', { name: '中央导入验收供方', exact: true }).click()
  await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
  await expect(page.getByLabel('主要联系人 *', { exact: true })).toHaveValue('王五')
  await expect(page.getByLabel('唯一识别码', { exact: true })).toHaveValue('RH-IMPORT-421')
  await expect(page.getByLabel('统一社会信用代码', { exact: true })).toHaveValue('914401014210000001')
  await expect(page.getByLabel('劳务承包范围', { exact: true })).toHaveValue('石材安装\n楼梯铺贴')
  await expect(page.getByLabel('主营业务', { exact: true })).toHaveValue('建筑施工')
  expect(errors).toEqual([])
})

test('同一个文件中有重复资料时可逐行跳过，不会静默创建两份', async ({ page }) => {
  await page.goto('/base/supplier')
  await page.getByRole('button', { name: '导入分供方', exact: true }).click()
  await page.getByLabel('选择导入文件').setInputFiles({
    name: 'duplicate-synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('公司全称,主要联系人\n合成重复公司,联系人甲\n合成重复公司,联系人乙', 'utf-8'),
  })
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  const review = page.getByRole('region', { name: '分供方重复资料核对' })
  await expect(review).toContainText('第 2 行')
  await expect(review).toContainText('第 3 行')
  await expect(page.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled()
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `${width}px 分供方重复核对`)
  }
  const choice = review.getByLabel('第 3 行处理方式')
  await choice.focus()
  await expect(choice).toBeFocused()
  await page.keyboard.press('End')
  await expect(choice).toHaveValue('skip')
  await expect(page.getByRole('button', { name: '开始导入', exact: true })).toBeEnabled()
  const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/suppliers/import') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始导入', exact: true }).click()
  expect((await saved).ok()).toBe(true)
  await expect(page).toHaveURL(/\/base\/supplier$/)
  const list = page.locator('.supplier-reference-list')
  await list.getByRole('searchbox').fill('合成重复公司')
  await expect(list.getByText('共 1 条', { exact: true })).toBeVisible()
})

test('问号帮助可悬浮、键盘及触摸打开且各宽度不越出视口，劳务范围保存和清空后可回读', async ({ page }) => {
  const widths = [390, 768, 1024, 1440] as const
  const name = '表单验收供方'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/base/supplier')
  await page.getByRole('button', { name: '新增分供方', exact: true }).click()
  const category = page.getByRole('dialog', { name: '选择分供方类别' })
  await category.getByRole('radio', { name: '劳务分包商', exact: true }).check()
  await category.getByRole('button', { name: '进入新建表单' }).click()
  await page.getByLabel('公司全称 *', { exact: true }).fill(name)
  await page.getByLabel('主要联系人 *', { exact: true }).fill('验收联系人')
  const help = page.getByRole('button', { name: '查看纳税人类型说明', exact: true })
  await help.hover()
  const tooltip = page.locator('[data-ui="context-help-tooltip"]')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('官网未查到不等于小规模纳税人')
  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()
  await help.focus()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Enter')
  const popover = page.locator('[data-ui="context-help-popover"]')
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(help).toBeFocused()
  await expect(tooltip).toBeHidden()
  await help.tap()
  await expect(popover).toBeVisible()
  await page.getByRole('button', { name: '关闭纳税人类型说明', exact: true }).click()
  await expect(help).toBeFocused()
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.keyboard.press('Enter')
    await expect(popover).toBeVisible()
    const bounds = await popover.boundingBox()
    expect(bounds!.x, `${width}px 帮助弹层左缘`).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width, `${width}px 帮助弹层右缘`).toBeLessThanOrEqual(width)
    await expectNoPageOverflow(page, `${width}px 问号帮助`)
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
    await expect(help).toBeFocused()
  }
  await page.getByLabel('主营业务', { exact: true }).fill('房屋施工')
  await page.getByLabel('劳务承包范围', { exact: true }).fill('石材安装\n幕墙施工')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
  await expect(page.getByLabel('劳务承包范围', { exact: true })).toHaveValue('石材安装\n幕墙施工')
  await expect(page.getByLabel('主营业务', { exact: true })).toHaveValue('房屋施工')
  await page.getByLabel('劳务承包范围', { exact: true }).fill('')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
  await expect(page.getByLabel('劳务承包范围', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('主营业务', { exact: true })).toHaveValue('房屋施工')
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `${width}px 供应商表单`)
  }
  expect(errors).toEqual([])
})
