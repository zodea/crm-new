import { expect, test } from '@playwright/test'

test.describe('工资与考勤浏览器接管边界', () => {
  test('工资台账保三态多选，无格式新建仍进入A且空范围不生成工资', async ({ page }) => {
    await page.goto('/subcontract/payroll?origin=real&status=%5B%22draft%22%2C%22checked%22%5D')
    await expect(page.getByRole('heading', { name: '工资台账', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '工资状态，已选 2 项', exact: true })).toBeVisible()
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET')
        requests.push(request.url())
    })
    await page.goto('/subcontract/payroll/new?origin=real&month=2026-08')
    await expect(page.getByRole('heading', { name: '新建 A 工资草稿', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '工资档位', exact: true }).locator('option')).toHaveText(['月度请款', '工程结算', '尾款'])
    await expect(page.getByRole('button', { name: '保存工资草稿', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '确认实际发放', exact: true })).toHaveCount(0)
    expect(requests.filter(url => /\/api\/(?:commands|migrations)/.test(url))).toEqual([])
  })
  test('中央考勤空范围不登记，签工仍保原来源只读边界', async ({ page }) => {
    await page.goto('/subcontract/attendance')
    await expect(page.getByRole('heading', { name: '考勤管理', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('请选择项目和月份后查看日期矩阵。', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '月度考勤矩阵', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存考勤', exact: true })).toHaveCount(0)
    await page.goto('/subcontract/daywork')
    await expect(page.getByRole('heading', { name: '工资来源', exact: true })).toBeVisible()
    await expect(page.getByText('请选择项目查看独立来源。', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: /新增|保存|确认签工/ })).toHaveCount(0)
    await expect(page.getByRole('form', { name: '新增签工记录' })).toHaveCount(0)
  })
  test('五档入口和原生筛选不撑破页面，未选项目不会补首项', async ({ page }) => {
    await page.goto('/subcontract/attendance?origin=real')
    await expect(page.getByRole('heading', { name: '考勤管理', exact: true })).toBeVisible({ timeout: 30_000 })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 960 })
      await expect(page.getByRole('combobox', { name: '考勤项目', exact: true })).toHaveValue('')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
  })
})
