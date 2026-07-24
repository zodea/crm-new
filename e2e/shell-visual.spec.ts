import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('ruihang-shell-theme')
    localStorage.removeItem('ruihang-sidebar-pinned')
    localStorage.removeItem('ruihang-sidebar-groups')
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
})

test('Issue #111：外壳尺寸、颜色与内容留白', async ({ page }, testInfo) => {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()
  const topbar = page.locator('[data-shell-topbar], main > header').first()
  const tabbar = page.locator('[data-shell-tabbar], main > div:has(> nav[aria-label="已打开页面"])').first()
  const workspace = page.locator('[data-shell-workspace], main > div:nth-of-type(2)').first()

  await expect(sidebar).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('shell-home.png'), fullPage: true })

  const metrics = await Promise.all([sidebar, topbar, tabbar, workspace].map(async (locator) => {
    return locator.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        height: style.height,
        padding: style.padding,
        width: style.width,
      }
    })
  }))

  expect(metrics[0]).toMatchObject({
    backgroundColor: 'rgb(255, 255, 255)',
    width: '248px',
  })
  expect(metrics[1]?.height).toBe('64px')
  expect(metrics[2]?.height).toBe('40px')
  expect(metrics[3]?.padding).toBe('20px 24px 36px')
})

test('Issue #111：侧栏品牌、单字导航与锁定分组', async ({ page }) => {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()

  await expect(sidebar.getByText('瑞航 CRM', { exact: true })).toBeVisible()
  await expect(sidebar.getByText('工程财务管理', { exact: true })).toBeVisible()

  const homeLink = sidebar.getByRole('link', { name: /首页/ })
  await expect(homeLink.locator('[data-nav-mark]')).toHaveText('首')
  await expect(homeLink.getByText('总览', { exact: true })).toBeVisible()

  await expect(sidebar.locator('[data-nav-group]')).toHaveCount(9)
  await expect(sidebar.locator('[data-nav-group-label]')).toHaveText([
    '项目信息',
    '主合同管理',
    '分包及人工',
    '乙供材管理',
    '甲供材管理',
    '资金管理',
    '项目其他合同',
    '基础信息',
    '设置',
  ])
})

test('Issue #111：顶栏显示路由标题、副标与日期', async ({ page }) => {
  const topbar = page.locator('[data-shell-topbar], main > header').first()

  await expect(topbar.getByRole('heading', { name: '首页' })).toBeVisible()
  await expect(topbar.getByText('在建工程总览', { exact: true })).toBeVisible()
  await expect(topbar.getByText(/^\d{4}年\d{1,2}月\d{1,2}日 · 周[日一二三四五六]$/)).toBeVisible()
})

test('Issue #111：页签采用红圈式激活态', async ({ page }) => {
  const tabbar = page.locator('[data-shell-tabbar], main > div:has(> nav[aria-label="已打开页面"])').first()
  const activeTab = tabbar.locator('[data-shell-tab][data-active="true"]')

  await expect(activeTab).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(activeTab).toHaveCSS('color', 'rgb(57, 118, 198)')
  await expect(activeTab).toHaveCSS('font-weight', '800')
})

test('Issue #111：折叠轨道保持 68px，并支持悬浮临时展开', async ({ page }) => {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()
  const sidebarFrame = sidebar.locator('..')
  await page.getByRole('button', { name: '收起侧栏' }).click()
  await page.mouse.move(600, 300)

  await expect(sidebarFrame).toHaveCSS('width', '68px')
  await expect(sidebar.locator('[data-nav-mark]').first()).toHaveText('首')
  await expect(sidebar.locator('[data-nav-rail-group]')).toHaveCount(9)
  await expect(sidebar.locator('[data-nav-item]')).toHaveCount(1)

  await sidebar.hover()
  await expect(sidebarFrame).toHaveCSS('width', '248px')
  await expect(sidebar.getByText('工程财务管理', { exact: true })).toBeVisible()
})

test('Issue #111：小于 1024px 时侧栏使用可关闭 Sheet', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 })
  await page.reload()
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: '切换侧边栏' }).click()
  const sheet = page.getByRole('dialog', { name: '导航菜单' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(sheet.getByRole('link', { name: '项目列表' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('Issue #111：通知中心入口保持可用', async ({ page }) => {
  await page.getByRole('button', { name: '打开通知中心' }).click()
  const drawer = page.getByRole('dialog', { name: '消息中心' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('tab', { name: /待办/ })).toBeVisible()
  await drawer.getByRole('button', { name: '关闭消息中心' }).click()
  await expect(drawer).toBeHidden()
})

test('Issue #111：三个业务屏不产生整页横向穿透', async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  const samples = [
    { path: '/project', title: '项目列表', screenshot: 'project-list.png' },
    { path: '/finance/ledger', title: '发票台账', screenshot: 'invoice-ledger.png' },
    { path: '/material/delivery', title: '送货单识别', screenshot: 'delivery-recognition.png' },
  ] as const

  for (const sample of samples) {
    await page.goto(sample.path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-shell-topbar]').getByRole('heading', { name: sample.title })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    )
    await page.screenshot({ path: testInfo.outputPath(sample.screenshot), fullPage: true })
  }

  expect(pageErrors).toEqual([])
})
