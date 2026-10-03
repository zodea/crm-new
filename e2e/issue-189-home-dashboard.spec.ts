import { expect, test } from '@playwright/test'
import { installScheduleProductionFixture } from './helpers/quantity-production-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-06T04:00:00.000Z'))
})

test('Issue #189：首页默认工作台只展示真实排程并保持项目、分组与下钻入口可达', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  const fixture = await installScheduleProductionFixture(page)
  await page.goto(`/?project=${fixture.projectId}&origin=real`)

  await expect(page.getByTestId('project-switcher-trigger')).toContainText('E2E正式工程量项目')
  await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '全部项目', exact: true }))
    .toHaveAttribute('href', '/project')

  await page.evaluate(() => {
    window.history.pushState({}, '', '/?project=project-missing&origin=real&group=stale-group&task=stale-task')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('alert', { name: '首页施工进度加载失败' })).toBeVisible()
  await expect(page).toHaveURL(/project=project-missing/)
  await page.goto(`/?project=${fixture.projectId}&origin=real`)

  const expandedGroup = page.getByRole('button', { name: '折叠分组：正式一栋组', exact: true })
  const task = page.getByRole('button', { name: /卫生间回填及防水/ }).first()
  await expect(task).toBeVisible()
  await expandedGroup.click()
  await expect(task).toBeHidden()
  await page.getByRole('button', { name: '展开分组：正式一栋组', exact: true }).click()
  await expect(task).toBeVisible()

  await expectNoPageOverflow(page, '首页分组折叠')
})

for (const state of [
  { query: 'loading', role: 'status', title: '正在读取首页施工进度' },
  { query: 'schedule-empty', role: 'status', title: '状态预览项目还没有施工排程' },
  { query: 'partial', role: 'status', title: '部分排程数据尚未就绪' },
  { query: 'error', role: 'alert', title: '首页施工进度加载失败' },
] as const) {
  test(`Issue #189：首页状态预览 ${state.query} 保留对应恢复行为`, async ({ page }) => {
    await page.goto(`/dev/home-dashboard?state=${state.query}`)
    const panel = page.getByRole(state.role, { name: state.title, exact: true })
    await expect(panel).toBeVisible()
    if (state.query === 'schedule-empty') {
      await expect(page.getByRole('link', { name: '新建楼栋分组', exact: true })).toHaveAttribute('href', /\/schedule\/new\?project=project-preview/)
      await expect(page.getByRole('link', { name: '打开施工进度', exact: true })).toHaveAttribute('href', /\/schedule\?project=project-preview/)
    }
    if (state.query === 'error') {
      await panel.getByRole('button', { name: '重新加载', exact: true }).click()
      await expect(page.getByRole('status', { name: '部分排程数据尚未就绪', exact: true })).toBeVisible()
    }
    if (state.query === 'partial' || state.query === 'error')
      await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
  })
}
