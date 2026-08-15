import { expect, test } from '@playwright/test'

// 项目列表已经使用中央后台 DTO；详情页迁移由后续切片处理。本文件守住当前
// 可演示的只读关联跳转与页签复用，不再断言本地编辑会回写中央列表。

test('项目列表↔详情：中央列表可打开现有只读详情并复用同一页签', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  const tabBar = page.getByRole('navigation', { name: '已打开页面' })

  await page.getByRole('link', { name: '合和新城', exact: true }).first().click()
  await expect(page).toHaveURL(/\/project\/proj_demo_001$/)
  await expect(tabBar.getByRole('button', { name: '合和新城', exact: true }))
    .toHaveCount(1)
  await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
    .toBeVisible()

  const tabCount = (await page.getByTitle('当前页签数量').textContent() ?? '').trim()
  await tabBar.getByRole('button', { name: '项目列表', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)
  await page.getByRole('link', { name: '合和新城', exact: true }).first().click()
  await expect(page).toHaveURL(/\/project\/proj_demo_001$/)
  await expect(page.getByTitle('当前页签数量')).toContainText(tabCount)
  await expect(tabBar.getByRole('button', { name: '合和新城', exact: true }))
    .toHaveCount(1)

  expect(pageErrors, '列表到详情的只读关联旅程不应产生客户端运行错误').toEqual([])
})

test('项目详情：缺失实体显示明确空态而非永远加载中', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project/__missing_project__')
  await expect(page.getByText('项目不存在或已被删除')).toBeVisible()
  await expect(page.getByRole('link', { name: '返回项目列表' })).toBeVisible()

  expect(pageErrors, '详情缺失态不应产生客户端运行错误').toEqual([])
})
