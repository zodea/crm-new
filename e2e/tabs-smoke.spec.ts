import { expect, test } from '@playwright/test'

test('首页固定，并能从侧栏打开项目列表页签', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  expect(pageErrors, '首页加载不应产生客户端运行错误').toEqual([])

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  const homeTab = tabBar.getByRole('button', { name: '首页', exact: true })

  await expect(homeTab).toBeVisible()
  await expect(homeTab).toHaveAttribute('aria-current', 'page')
  await expect(tabBar.getByRole('button', { name: '关闭 首页' })).toHaveCount(0)

  await page.getByRole('link', { name: '项目列表', exact: true }).click()

  await expect(page).toHaveURL(/\/project$/)
  await expect(homeTab).toBeVisible()

  const projectTab = tabBar.getByRole('button', { name: '项目列表', exact: true })
  await expect(projectTab).toBeVisible()
  await expect(projectTab).toHaveAttribute('aria-current', 'page')
  await expect(tabBar.getByRole('button', { name: '关闭 项目列表' })).toBeVisible()
})
