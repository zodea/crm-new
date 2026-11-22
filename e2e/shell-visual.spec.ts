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

test('Issue #419：外壳保持深色侧栏与清晰可读的全站导航尺寸', async ({ page }) => {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()
  const topbar = page.locator('[data-shell-topbar], main > header').first()
  const tabbar = page.locator('[data-shell-tabbar], main > div:has(> nav[aria-label="已打开页面"])').first()
  const workspace = page.locator('[data-shell-workspace], main > div:nth-of-type(2)').first()

  await expect(sidebar).toBeVisible()

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
    backgroundColor: 'rgb(24, 34, 55)',
    width: '208px',
  })
  expect(metrics[1]?.height).toBe('40px')
  expect(metrics[2]?.height).toBe('32px')
  expect(metrics[3]?.padding).toBe('12px 12px 16px')
})

test('Issue #419：侧栏保留品牌与单行图标导航', async ({ page }) => {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()

  await expect(sidebar.getByText('瑞航 CRM', { exact: true })).toBeVisible()
  await expect(sidebar.getByText('工程财务管理', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('本地工具 · 数据不上传', { exact: true })).toHaveCount(0)

  const homeLink = sidebar.getByRole('link', { name: '首页', exact: true })
  await expect(homeLink.locator('[data-nav-mark]')).toHaveClass(/i-lucide-house/)
  await expect(homeLink).toHaveCSS('height', '38px')
  await expect(homeLink.getByText('首页', { exact: true })).toHaveCSS('font-size', '14px')
  await expect(homeLink.locator('[data-nav-mark]')).toHaveCSS('width', '18px')
  await expect(sidebar.getByRole('searchbox', { name: '搜索菜单' })).toHaveCSS('font-size', '14px')
  await expect(sidebar.locator('[data-nav-group-label]').first()).toHaveCSS('font-size', '14px')
  await expect(sidebar.locator('[data-nav-group-label]').first()).toHaveCSS('color', 'rgb(200, 210, 225)')
  await expect(homeLink.getByText('总览', { exact: true })).toHaveCount(0)

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

test('Issue #419：紧凑顶栏保留路由标题、日期与数据入口', async ({ page }) => {
  const topbar = page.locator('[data-shell-topbar], main > header').first()

  await expect(topbar.getByRole('heading', { name: '首页' })).toBeVisible()
  await expect(topbar.getByText('在建工程总览', { exact: true })).toHaveCount(0)
  await expect(topbar.getByTestId('include-demo-toggle')).toBeVisible()
  await expect(topbar.getByText(/^\d{4}年\d{1,2}月\d{1,2}日 · 周[日一二三四五六]$/)).toBeVisible()
})

test('Issue #111：页签采用红圈式激活态', async ({ page }) => {
  const tabbar = page.locator('[data-shell-tabbar], main > div:has(> nav[aria-label="已打开页面"])').first()
  const activeTab = tabbar.locator('[data-shell-tab][data-active="true"]')

  await expect(activeTab).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(activeTab).toHaveCSS('color', 'rgb(57, 118, 198)')
  await expect(activeTab).toHaveCSS('font-weight', '500')
})

test('Issue #419：折叠轨道保持 48px，并支持悬浮临时展开', async ({ page }) => {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()
  const sidebarFrame = sidebar.locator('..')
  await page.getByRole('button', { name: '收起侧栏' }).click()
  await page.mouse.move(600, 300)

  await expect(sidebarFrame).toHaveCSS('width', '48px')
  await expect(sidebar.locator('[data-nav-mark]').first()).toHaveClass(/i-lucide-house/)
  await expect(sidebar.locator('[data-nav-rail-group]')).toHaveCount(9)
  await expect(sidebar.locator('[data-nav-item]')).toHaveCount(1)

  await sidebar.hover()
  await expect(sidebarFrame).toHaveCSS('width', '208px')
  await expect(sidebar.getByText('瑞航 CRM', { exact: true })).toBeVisible()
})

test('Issue #111：小于 1024px 时侧栏使用可关闭 Sheet', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 })
  await page.reload()
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: '切换侧边栏' }).click()
  const sheet = page.getByRole('dialog', { name: '导航菜单' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveCSS('background-color', 'rgb(24, 34, 55)')
  await sheet.getByRole('button', { name: '项目信息', exact: true }).click()
  await expect(sheet.getByRole('link', { name: '项目列表' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('Issue #419：390、768、1024、1440px 外壳无整页横滚且导航可达', async ({ page }) => {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('[data-shell-topbar]')).toHaveCSS('height', '40px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

    if (width < 1024) {
      const trigger = page.getByRole('button', { name: '切换侧边栏' })
      await trigger.focus()
      await page.keyboard.press('Enter')
      const sheet = page.getByRole('dialog', { name: '导航菜单' })
      await expect(sheet).toBeVisible()
      const search = sheet.getByRole('searchbox', { name: '搜索菜单' })
      await expect(sheet).toHaveCSS('width', '208px')
      await expect(search).toHaveCSS('font-size', '14px')
      await search.fill('分供方')
      const supplierLink = sheet.getByRole('link', { name: '分供方', exact: true })
      await expect(supplierLink).toBeInViewport()
      await expect(supplierLink.getByText('分供方', { exact: true })).toHaveCSS('font-size', '14px')
      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await expect(trigger).toBeFocused()
    }
    else {
      await expect(page.locator('[data-sidebar="sidebar"]').first()).toHaveCSS('width', '208px')
    }
  }
})

test('Issue #111：通知中心入口保持可用', async ({ page }) => {
  await page.getByRole('button', { name: '打开通知中心' }).click()
  const drawer = page.getByRole('dialog', { name: '消息中心' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('tab', { name: /待办/ })).toBeVisible()
  await drawer.getByRole('button', { name: '关闭消息中心' }).click()
  await expect(drawer).toBeHidden()
})

for (const sample of [
  { path: '/project', title: '项目列表' },
  { path: '/finance/ledger', title: '发票台账' },
  { path: '/material/delivery', title: '送货单识别' },
] as const) {
  test(`Issue #111：${sample.title}不产生整页横向穿透`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(sample.path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-shell-topbar]').getByRole('heading', { name: sample.title })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    )
    expect(pageErrors).toEqual([])
  })
}
