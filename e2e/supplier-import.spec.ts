import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

test('分供方导入：映射页签真实入库并归一类别、资料状态与别名', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/base/supplier')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('共 10 家')).toBeVisible()

  await page.getByRole('button', { name: '导入', exact: true }).click()
  await expect(page).toHaveURL(/\/import\/mapping\/supplier$/)
  await expect(page.getByText('分供方 · 模板驱动，源列映射到系统字段')).toBeVisible()

  await page.getByLabel('选择导入文件').setInputFiles({
    name: 'suppliers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      '公司全称,分供方类别,资料状态,简称/别名,统一社会信用代码,主要联系人,联系方式,注册资金（万元）,外部旧ID',
      '导入分供方甲,专业分包商,合格,华东；东建,914401010000000001,张三,13800138001,280.5,OLD-SUP-A',
      '导入分供方乙,未知类别,,测试乙,914401010000000002,李四,13800138002,,OLD-SUP-B',
    ].join('\n'), 'utf-8'),
  })

  const fieldRow = (key: string) => page.locator(`[data-field="${key}"]`)
  for (const key of ['name', 'supplierCategory', 'credentialStatus', 'aliases', 'registeredCapital', 'externalRef'])
    await expect(fieldRow(key)).toHaveAttribute('data-status', 'matched')

  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByRole('table')).toContainText('导入分供方甲')
  await page.getByRole('button', { name: '开始导入' }).click()

  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已导入 2 行：分供方', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/base\/supplier$/)
  await expect(page.getByText('共 12 家')).toBeVisible()

  // 二次修正只映射名称、联系人和外部旧 ID；未映射的类别/状态/别名等必须保留。
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.getByLabel('选择导入文件').setInputFiles({
    name: 'supplier-contact-correction.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      '公司全称,主要联系人,外部旧ID',
      '导入分供方甲,王五,OLD-SUP-A',
    ].join('\n'), 'utf-8'),
  })
  for (const key of ['name', 'contact', 'externalRef'])
    await expect(fieldRow(key)).toHaveAttribute('data-status', 'matched')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '开始导入' }).click()
  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已导入 1 行：分供方', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/base\/supplier$/)
  await expect(page.getByText('共 12 家')).toBeVisible()

  const toolbar = page.locator('section').filter({
    has: page.getByRole('heading', { name: '分供方资料库', exact: true }),
  })
  const search = page.getByPlaceholder('搜索公司名、税号、简称…')
  await search.fill('导入分供方甲')
  await expect(toolbar).toContainText('当前 1 家')
  await expect(page.getByRole('link', { name: '导入分供方甲', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '专业分包商', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '合格', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '华东、东建', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '王五', exact: true })).toBeVisible()

  await search.fill('导入分供方乙')
  await expect(toolbar).toContainText('当前 1 家')
  await expect(page.getByRole('link', { name: '导入分供方乙', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '其他', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '资料缺失', exact: true })).toBeVisible()

  expect(pageErrors, '分供方导入旅程不应产生客户端运行错误').toEqual([])
})
