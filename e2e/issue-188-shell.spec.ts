import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const ROUTES_FOR_OVERFLOW = [
  '项目列表',
  '施工合同',
  '分包合同',
  '工程量管理',
  '材料采购合同',
  '发票台账',
  '分供方',
] as const

async function openSidebarRoute(page: Page, label: string) {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first()
  const navSearch = sidebar.getByRole('searchbox', { name: '搜索菜单' })
  // 分组导航按当前路由保持单组展开；跨组操作应走共享搜索，而不是依赖
  // 某个非当前分组恰好保持展开。这样验收的是真实用户可达路径。
  await navSearch.fill(label)
  const link = sidebar.getByRole('link', { name: label, exact: true })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page.locator('[data-shell-topbar] h1')).toHaveText(label)
}

async function openOverflowingTabs(page: Page) {
  for (const label of ROUTES_FOR_OVERFLOW)
    await openSidebarRoute(page, label)
}

async function openTabs(page: Page, labels: readonly string[]) {
  for (const label of labels)
    await openSidebarRoute(page, label)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('ruihang-sidebar-pinned')
    localStorage.removeItem('ruihang-sidebar-groups')
  })
})

test('Issue #188：导航搜索与页签溢出均可由键盘可达控件操作', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const navSearch = page.getByRole('searchbox', { name: '搜索菜单' })
  await navSearch.fill('合同')
  const firstResult = page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: '施工合同' })
  await expect(firstResult).toBeVisible()
  await expect(firstResult).toBeInViewport()
  await expect(page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: '项目列表' })).toHaveCount(0)
  await navSearch.fill('')

  await openOverflowingTabs(page)

  const tabList = page.getByRole('navigation', { name: '已打开页面' })
  const previous = page.getByRole('button', { name: '向前翻动页签' })
  const next = page.getByRole('button', { name: '向后翻动页签' })

  await expect(previous).toBeVisible()
  await expect(next).toBeVisible()
  await expect(next).toBeEnabled()
  expect(await tabList.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)

  const before = await tabList.evaluate(element => element.scrollLeft)
  await next.click()
  await expect.poll(() => tabList.evaluate(element => element.scrollLeft)).toBeGreaterThan(before)

  const afterNext = await tabList.evaluate(element => element.scrollLeft)
  await previous.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => tabList.evaluate(element => element.scrollLeft)).toBeLessThan(afterNext)

  const sidebarFrame = page.locator('[data-sidebar="sidebar"]').first().locator('..')
  await page.getByRole('button', { name: '收起侧栏' }).click()
  await page.mouse.move(800, 700)
  await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(68)
  await expect(previous).toHaveCount(0)
  await expect(next).toHaveCount(0)

  await page.getByRole('button', { name: '固定侧栏' }).click()
  await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(248)
  await expect(previous).toBeVisible()
  await expect(next).toBeVisible()
})

test('Issue #188：真实详情长标题会重新计算页签溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await openTabs(page, [
    '项目列表',
    '施工合同',
    '分包合同',
    '工程量管理',
    '分供方',
  ])

  const tabList = page.getByRole('navigation', { name: '已打开页面' })
  const next = page.getByRole('button', { name: '向后翻动页签' })
  await expect(next).toHaveCount(0)
  expect(await tabList.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  const supplierName = '广州市大板东建材有限公司'
  await page.getByPlaceholder('搜索公司名、税号、简称…').fill(supplierName)
  await page.getByRole('link', { name: supplierName, exact: true }).click()
  await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_001$/)
  await expect(page.locator('[data-shell-tab][data-active="true"] [data-tab-trigger]'))
    .toHaveText(supplierName)

  await expect(next).toBeVisible()
  expect(await tabList.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
})

for (const sample of [
  { width: 390, height: 844, placement: 'bottom' },
  { width: 768, height: 900, placement: 'bottom' },
  { width: 1024, height: 900, placement: 'right' },
  { width: 1440, height: 1000, placement: 'right' },
] as const) {
  test(`Issue #188：通知 Sheet @ ${sample.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: sample.width, height: sample.height })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const trigger = page.getByRole('button', { name: /打开通知中心，\d+ 条未读/ })
    await trigger.click()

    const sheet = page.getByRole('dialog', { name: '消息中心' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('data-sheet-placement', sample.placement)
    await expect(page.locator('[data-shell-workspace]')).toHaveCSS('overflow-y', 'hidden')
    await sheet.evaluate(element =>
      Promise.all(element.getAnimations().map(animation => animation.finished)),
    )

    const box = await sheet.boundingBox()
    expect(box).not.toBeNull()
    if (sample.placement === 'bottom') {
      await expect(sheet.locator('[data-sheet-handle]')).toBeVisible()
      expect(Math.round(box!.width)).toBe(sample.width)
      expect(Math.round(box!.y + box!.height)).toBe(sample.height)
    }
    else {
      await expect(sheet.locator('[data-sheet-handle]')).toHaveCount(0)
      expect(Math.round(box!.width)).toBe(390)
      expect(Math.round(box!.x + box!.width)).toBe(sample.width)
    }

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(page.locator('[data-shell-workspace]')).toHaveCSS('overflow-y', 'auto')
  })
}
