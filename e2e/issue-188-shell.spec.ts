import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const ROUTES_FOR_OVERFLOW = [
  '项目列表',
  '施工合同',
  '分包合同',
  '工程量管理',
  '材料采购合同',
  '发票台账',
  '分供方',
  '费用报销',
  '库存盘点',
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
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `shell-ui-${randomUUID()}` })
  await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  await page.addInitScript(() => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
    localStorage.setItem('ruihang-sidebar-pinned', 'true')
    localStorage.removeItem('ruihang-sidebar-groups')
  })
})

test('首页项目读取迟到时，侧栏跳转仍能完成', async ({ page }) => {
  let releaseProjectRead!: () => void
  let releaseRouteModule!: () => void
  let markProjectRead!: () => void
  let markRouteModule!: () => void
  const projectRead = new Promise<void>((resolve) => {
    markProjectRead = resolve
  })
  const routeModule = new Promise<void>((resolve) => {
    markRouteModule = resolve
  })
  const projectGate = new Promise<void>((resolve) => {
    releaseProjectRead = resolve
  })
  const routeGate = new Promise<void>((resolve) => {
    releaseRouteModule = resolve
  })
  await page.route(/\/api\/read\/projects\/[^/?]+(?:\?|$)/, async (route) => {
    markProjectRead()
    await projectGate
    await route.continue()
  })
  // 只延迟真正的页面模块，不能拦截启动时收集路由元信息的 ?macro=true 请求。
  await page.route('**/_nuxt/pages/project/index.vue', async (route) => {
    markRouteModule()
    await routeGate
    await route.continue()
  })
  try {
    await page.setViewportSize({ width: 1024, height: 900 })
    // 受控的异步请求故意保持未完成；按页面可见状态继续，不能等待整个文档 load。
    await page.goto('/', { waitUntil: 'commit' })
    await projectRead
    const sidebar = page.locator('[data-sidebar="sidebar"]').first()
    await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill('项目列表')
    await sidebar.getByRole('link', { name: '项目列表', exact: true }).click()
    await routeModule
    releaseProjectRead()
    await expect(page.getByTestId('project-switcher-trigger')).not.toContainText('正在加载项目')
    releaseRouteModule()
    await expect(page).toHaveURL('/project')
    await expect(page.locator('[data-shell-topbar] h1')).toHaveText('项目列表')
  }
  finally {
    releaseProjectRead()
    releaseRouteModule()
  }
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
  await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(48)
  await expect(previous).toHaveCount(0)
  await expect(next).toHaveCount(0)
  await sidebarFrame.hover()
  await expect(sidebarFrame).toHaveAttribute('data-peek-open', 'true')
  await page.mouse.move(800, 700)
  await expect(sidebarFrame).not.toHaveAttribute('data-peek-open', 'true')
  await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(48)
  await expect(page.locator('[data-overlay-backdrop]')).toHaveCount(0)

  await page.getByRole('button', { name: '固定侧栏' }).click()
  await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(208)
  await expect(previous).toBeVisible()
  await expect(next).toBeVisible()
})

for (const supplier of [
  { name: '广州市大板东建材有限公司', id: 'sup_demo_001' },
  { name: '穗建五金机电经营部', id: 'sup_demo_004' },
]) {
  test(`Issue #188：只读演示详情标题会重新计算页签溢出：${supplier.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await openTabs(page, ROUTES_FOR_OVERFLOW)
    await openSidebarRoute(page, '分供方')

    const tabList = page.getByRole('navigation', { name: '已打开页面' })
    const next = page.getByRole('button', { name: '向后翻动页签' })
    await expect(next).toHaveCount(0)
    expect(await tabList.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

    let release!: () => void
    const pending = new Promise<void>(resolve => release = resolve)
    await page.route(`**/api/read/suppliers/${supplier.id}?*`, async (route) => {
      const response = await route.fetch()
      await pending
      await route.fulfill({ response })
    })
    await page.getByRole('searchbox', { name: '搜索关键词…' }).fill(supplier.name)
    await page.getByRole('link', { name: supplier.name, exact: true }).click()
    try {
      await expect(tabList.getByRole('button', { name: '分供方详情', exact: true })).toHaveAttribute('aria-current', 'page')
      const geometry = await tabList.evaluate((element) => {
        const bounds = [...element.querySelectorAll('[data-shell-tab]')].map(item => item.getBoundingClientRect())
        const style = getComputedStyle(element)
        return { client: element.clientWidth, content: Math.max(...bounds.map(rect => rect.right)) - Math.min(...bounds.map(rect => rect.left)) + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight) }
      })
      const width = Math.ceil(1440 - geometry.client + geometry.content + 8)
      expect(width).toBeGreaterThanOrEqual(1024)
      await page.setViewportSize({ width, height: 800 })
      await expect(next).toHaveCount(0)
      expect(await tabList.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    finally { release() }
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/base/supplier/${supplier.id}`)
    expect(new URL(page.url()).searchParams.get('origin')).toBe('demo')
    await expect(page.getByRole('heading', { name: supplier.name, exact: true })).toBeVisible()
    await expect(page.locator('[data-shell-topbar] h1')).toHaveText('分供方详情')
    await expect(tabList.getByRole('button', { name: supplier.name, exact: true })).toHaveAttribute('aria-current', 'page')

    await expect(next).toBeVisible()
    expect(await tabList.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  })
}

for (const sample of [
  { width: 390, height: 844, placement: 'bottom' },
  { width: 768, height: 900, placement: 'bottom' },
  { width: 1024, height: 900, placement: 'right' },
  { width: 1280, height: 900, placement: 'right' },
  { width: 1440, height: 1000, placement: 'right' },
] as const) {
  test(`Issue #188：通知 Sheet @ ${sample.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: sample.width, height: sample.height })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const trigger = page.getByRole('button', { name: /^打开通知中心/ })
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
