import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installScheduleProductionFixture } from './helpers/quantity-production-fixture'
import { EQUIVALENT_200_PERCENT_VIEWPORT, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-06T04:00:00.000Z'))
})

test('首页正式项目切换、排程与工程量下钻使用同一回执身份和工序上下文', async ({ page }) => {
  test.setTimeout(90_000)
  const fixture = await installScheduleProductionFixture(page)
  const session = await (await page.request.get('/api/read/business-session')).json()
  const created = await page.request.post('/api/commands/projects', { data: { ...session, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: 'E2E尚无排程项目', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
  expect(created.ok(), await created.text()).toBe(true)
  const emptyProject = await created.json()
  const snapshot = (await fixture.readSchedule()).snapshot
  const task = snapshot.groups[0]!.tasks.find(task => task.name === '卫生间回填及防水')!
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`/?project=${fixture.projectId}&origin=real`)
  await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
  await expect(page.getByText('图表待实现 (#7)', { exact: true })).toHaveCount(0)
  await expect(page.getByText('合同总额', { exact: true })).toHaveCount(0)
  const switcher = page.getByTestId('project-switcher-trigger')
  await expect(switcher).toContainText('E2E正式工程量项目')
  await expect(page.getByText('正式一栋组', { exact: true })).toBeVisible()
  await expect(page.getByText('计划区间', { exact: true })).toBeVisible()
  await expect(page.getByTestId('home-schedule-scroll').getByText('今天', { exact: true })).toBeVisible()
  await switcher.focus()
  await page.keyboard.press('ArrowDown')
  const search = page.getByRole('combobox', { name: '搜索项目', exact: true })
  await expect(search).toBeFocused()
  await search.fill('E2E尚无排程项目')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('project') === emptyProject.id && url.searchParams.get('origin') === 'real')
  await expect(page.getByRole('status', { name: 'E2E尚无排程项目还没有施工排程', exact: true })).toBeVisible()
  await switcher.click()
  await search.fill('E2E正式工程量项目')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /卫生间回填及防水/ }).first().click()
  await expect(page).toHaveURL(url => url.pathname === '/subcontract/quantity' && url.searchParams.get('project') === fixture.projectId && url.searchParams.get('origin') === 'real' && url.searchParams.get('from') === 'home')
  await expect(page.getByText('来自首页施工进度 · 正式一栋组', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回首页该工序', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('project') === fixture.projectId && url.searchParams.get('group') === snapshot.groups[0]!.id && url.searchParams.get('task') === task.id)
  await expect(page.getByText('正式一栋组', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /卫生间回填及防水/ }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('首页项目切换器键盘可用，各宽度甘特局部滚动和施工入口可达', async ({ page }) => {
  const fixture = await installScheduleProductionFixture(page)
  await page.goto(`/?project=${fixture.projectId}&origin=real`)
  await expect(page.getByRole('link', { name: '打开施工进度', exact: true })).toHaveAttribute('href', `/schedule?project=${fixture.projectId}&origin=real&from=home`)
  await expect(page.getByTestId('home-schedule-scroll').getByText('今天', { exact: true })).toBeVisible()
  const switcher = page.getByTestId('project-switcher-trigger')
  await expect(switcher).toContainText('E2E正式工程量项目')
  const scroll = page.getByTestId('home-schedule-scroll')
  for (const viewport of [...RESPONSIVE_WIDTHS.map(width => ({ width, height: width === 390 ? 844 : 1000 })), EQUIVALENT_200_PERCENT_VIEWPORT]) {
    await page.setViewportSize(viewport)
    // 跨过窄屏断点时触发器会重建；等浏览器完成布局和响应式更新再实际聚焦。
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.getByRole('link', { name: '全部项目', exact: true })).toBeVisible()
    await switcher.focus()
    await expect(switcher).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('combobox', { name: '搜索项目', exact: true })).toBeFocused()
    await expect(page.getByRole('option', { name: /E2E正式工程量项目/ }).last()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(switcher).toBeFocused()
    await expect(scroll).toBeVisible()
    const metrics = await scroll.evaluate((element) => {
      element.scrollLeft = 0
      element.scrollLeft = element.scrollWidth
      return { client: element.clientWidth, width: element.scrollWidth, left: element.scrollLeft }
    })
    if (viewport.width <= 768) {
      expect(metrics.width, `${viewport.width}px`).toBeGreaterThan(metrics.client)
      expect(metrics.left, `${viewport.width}px`).toBeGreaterThan(0)
    }
    else {
      expect(metrics.width, `${viewport.width}px`).toBeGreaterThanOrEqual(metrics.client)
      expect(metrics.left, `${viewport.width}px`).toBe(metrics.width - metrics.client)
    }
    await expectNoPageOverflow(page, `${viewport.width}px 首页排程`)
  }
})
