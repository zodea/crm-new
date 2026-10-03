import { expect, test } from '@playwright/test'

// 当前项目列表与详情均使用中央 DTO；测试来源必须显式授权且保持只读。
const PROJECTS = [
  { id: 'proj_demo_001', name: '合和新城' },
  { id: 'proj_demo_002', name: '锦绣华庭' },
] as const

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
})

for (const project of PROJECTS) {
  test(`项目列表↔详情：${project.name} 保留来源且复用同一页签`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/project')
    const tabBar = page.getByRole('navigation', { name: '已打开页面' })

    await page.getByRole('link', { name: project.name, exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/project/${project.id}\\?origin=demo`))
    await expect(tabBar.getByRole('button', { name: project.name, exact: true }))
      .toHaveCount(1)
    await expect(page.getByRole('heading', { name: project.name, exact: true }))
      .toBeVisible()

    const tabCount = await tabBar.locator('[data-tab-trigger]').count()
    await tabBar.getByRole('button', { name: '项目列表', exact: true }).click()
    await expect(page).toHaveURL(/\/project$/)
    await page.getByRole('link', { name: project.name, exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/project/${project.id}\\?origin=demo`))
    await expect(tabBar.locator('[data-tab-trigger]')).toHaveCount(tabCount)
    await expect(tabBar.getByRole('button', { name: project.name, exact: true }))
      .toHaveCount(1)

    expect(pageErrors, '列表到详情的只读关联旅程不应产生客户端运行错误').toEqual([])
  })
}

test('项目详情：缺失实体显示明确空态而非永远加载中', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project/__missing_project__')
  await expect(page.getByText('项目不存在或当前来源不可见')).toBeVisible()
  await expect(page.getByRole('link', { name: '返回项目列表' })).toBeVisible()

  expect(pageErrors, '详情缺失态不应产生客户端运行错误').toEqual([])
})
