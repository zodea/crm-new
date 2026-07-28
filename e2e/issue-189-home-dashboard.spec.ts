import { expect, test } from '@playwright/test'

test('Issue #189：首页默认工作台只展示真实排程并保持项目、分组与下钻入口可达', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/?project=proj_demo_001')
  await page.waitForLoadState('networkidle')

  await expect(page.getByTestId('project-switcher-trigger')).toContainText('合和新城')
  await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '全部项目', exact: true }))
    .toHaveAttribute('href', '/project')

  await page.evaluate(() => {
    window.history.pushState({}, '', '/?project=project-missing&group=stale-group&task=stale-task')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL('/?project=proj_demo_001')

  const group = page.getByRole('button', { name: /户内1栋-2栋/ })
  const task = page.getByRole('button', { name: /卫生间回填及防水/ }).first()
  await expect(task).toBeVisible()
  await group.click()
  await expect(task).toBeHidden()
  await group.click()
  await expect(task).toBeVisible()

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
})

test('Issue #189：首页 loading、empty、partial-data 与 error 都有可恢复行为', async ({ page }) => {
  await page.goto('/dev/home-dashboard?state=loading')
  await expect(page.getByRole('status', { name: '正在读取首页施工进度' })).toBeVisible()

  await page.goto('/dev/home-dashboard?state=schedule-empty')
  await expect(page.getByRole('status', { name: '状态预览项目还没有施工排程' })).toBeVisible()
  await expect(page.getByRole('link', { name: '新建楼栋分组' }))
    .toHaveAttribute('href', /\/schedule\/new\?project=project-preview/)
  await expect(page.getByRole('link', { name: '打开施工进度' }))
    .toHaveAttribute('href', /\/schedule\?project=project-preview/)

  await page.goto('/dev/home-dashboard?state=partial')
  await expect(page.getByRole('status', { name: '部分排程数据尚未就绪' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()

  await page.goto('/dev/home-dashboard?state=error')
  const error = page.getByRole('alert', { name: '首页施工进度加载失败' })
  await expect(error).toBeVisible()
  await error.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByRole('status', { name: '部分排程数据尚未就绪' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
})
