import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

const key = 'ruihang:tab-session:v1:workspace-default:actor-default'
const paths = ['/project', '/base/customer', '/base/supplier', '/base/crew', '/base/worker', '/schedule', '/contract/construction', '/contract/subcontract', '/contract/material', '/finance/receipt', '/finance/payment', '/finance/ledger', '/material/arrival', '/material/use', '/material/requisition']
function snapshot(routes: string[], activeKey: string) {
  return {
    schemaVersion: 1,
    scope: { workspaceId: 'workspace-default', actorId: 'actor-default' },
    activeKey,
    tabs: routes.map((fullPath, index) => ({
      key: fullPath.split('?')[0],
      title: '旧页签名称',
      fullPath,
      origin: fullPath.includes('origin=demo') ? 'demo' : null,
      targetVersion: 1,
      sourceVersion: null,
      updatedAt: index + 1,
      closable: true,
    })),
  }
}

test.beforeEach(async ({ page }, testInfo) => {
  const sessionId = Buffer.from(testInfo.testId).toString('base64url')
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
  const result = await page.request.post('/api/testing/projects/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario: 'ready' } })
  expect(result.ok()).toBe(true)
})

test.afterEach(async ({ page }, testInfo) => {
  const sessionId = Buffer.from(testInfo.testId).toString('base64url')
  const result = await page.request.post('/api/testing/projects/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario: 'ready' } })
  expect(result.ok()).toBe(true)
})

test('初始导航完成后才恢复活动页，刷新与关闭保留正确集合', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify(value))
  }, { key, value: snapshot(['/project?search=恢复', '/base/supplier'], '/base/supplier') })
  await page.goto('/')
  await expect(page.locator('[data-shell-tabbar]')).toBeVisible({ timeout: 30000 })
  await expect(page).toHaveURL('/base/supplier')
  const tabs = page.getByRole('navigation', { name: '已打开页面' })
  await expect(tabs.locator('[data-shell-tab]')).toHaveCount(3)
  await expect(tabs.getByRole('button', { name: '分供方', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await expect(page).toHaveURL('/base/supplier')
  await expect(tabs.locator('[data-shell-tab]')).toHaveCount(3)
  await tabs.getByRole('button', { name: '关闭 项目列表', exact: true }).click()
  await page.reload()
  await expect(tabs.locator('[data-shell-tab]')).toHaveCount(2)
  expect(errors).toEqual([])
})

test('十五个只读页签下刷新写态页面，完整恢复集合并回到只读项', async ({ page }) => {
  await page.goto('/finance/invoice')
  await expect(page.locator('[data-shell-tabbar]')).toBeVisible()
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key, value: snapshot(paths, '/project') })
  await page.reload()
  await expect(page).toHaveURL('/project')
  await expect(page.locator('[data-shell-tab]')).toHaveCount(16)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).tabs.length, key)).toBe(15)
})

test('合法编码身份恢复成唯一目标，不留下重复页签', async ({ page }) => {
  const raw = '/project/%70roj_demo_001?origin=demo'
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify(value))
  }, { key, value: snapshot([...paths.slice(0, 14), raw], '/project/%70roj_demo_001') })
  await page.goto('/')
  await expect(page).toHaveURL('/project/proj_demo_001?origin=demo')
  await expect(page.locator('[data-shell-tab]')).toHaveCount(16)
  await expect(page.locator('[data-tab-key="/project/%70roj_demo_001"]')).toHaveCount(0)
  await expect(page.locator('[data-tab-key="/project/proj_demo_001"]')).toHaveCount(1)
})

test('十五页签五档视口可翻动与键盘操作，软刷新保留集合', async ({ page }, testInfo) => {
  const factor = '/finance/invoice/factor'
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key,
    value: snapshot([...paths.slice(0, 14), factor], factor),
  })
  await page.goto('/')
  await expect(page.locator('[data-shell-tabbar]')).toBeVisible({ timeout: 30000 })
  await expect(page).toHaveURL(factor)
  const tabs = page.getByRole('navigation', { name: '已打开页面' })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(tabs.locator('[data-shell-tab]')).toHaveCount(16)
    expect(await tabs.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    const active = tabs.locator(`[data-tab-key="${factor}"] [data-tab-trigger]`)
    await active.focus()
    await expect.poll(() => active.evaluate((element) => {
      const tab = element.getBoundingClientRect()
      const bar = element.closest('nav')!.getBoundingClientRect()
      return tab.left >= bar.left - 1 && tab.right <= bar.right + 1
    })).toBe(true)
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(active).toBeFocused()
    await expectNoPageOverflow(page, `${width}px 恢复页签`)
    await page.screenshot({ path: testInfo.outputPath(`tabs-restored-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '刷新当前页', exact: true }).click()
  await expect(page).toHaveURL(factor)
  await expect(tabs.locator('[data-shell-tab]')).toHaveCount(16)
})

test('后台恢复详情首次激活才读取，撤权回退后可重试或关闭', async ({ page }, testInfo) => {
  const target = '/project/proj_demo_001?origin=demo'
  const factor = '/finance/invoice/factor'
  let detailReads = 0
  page.on('request', request => detailReads += Number(request.url().includes('/api/read/projects/proj_demo_001?')))
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
    localStorage.setItem(key, JSON.stringify(value))
  }, { key, value: snapshot([target, factor], factor) })
  await page.route('**/api/read/projects/proj_demo_001?*', route => route.fulfill({
    status: 403,
    json: { data: { code: 'forbidden', message: '当前没有查看权限', retryable: false, fieldErrors: {}, traceId: null } },
  }))
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/')
  await expect(page.locator('[data-shell-tabbar]')).toBeVisible({ timeout: 30000 })
  expect(detailReads).toBe(0)
  await page.locator('[data-tab-key="/project/proj_demo_001"] [data-tab-trigger]').click()
  await expect(page.getByRole('alert')).toContainText('当前没有查看权限')
  await expect(page).toHaveURL(factor)
  expect(detailReads).toBe(1)
  await expectNoPageOverflow(page, '恢复权限问题态')
  await page.screenshot({ path: testInfo.outputPath('tabs-forbidden-390.png'), fullPage: true })
  await page.unroute('**/api/read/projects/proj_demo_001?*')
  await page.getByRole('button', { name: '重试恢复', exact: true }).click()
  await expect(page).toHaveURL(target)
  await expect(page.locator('[data-tab-restore-status] [role="alert"]')).toHaveCount(0)
  await page.locator('[data-tab-key="/project/proj_demo_001"] button[title="关闭页签"]').click()
  await expect(page.locator('[data-tab-key="/project/proj_demo_001"]')).toHaveCount(0)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).tabs.some((tab: { key: string }) => tab.key === '/project/proj_demo_001'), key)).toBe(false)
})

test('恢复读取迟到时新导航优先，不抢回页面', async ({ page }) => {
  const target = '/project/proj_demo_001?origin=demo'
  const factor = '/finance/invoice/factor'
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
    localStorage.setItem(key, JSON.stringify(value))
  }, { key, value: snapshot([target, '/base/supplier', factor], factor) })
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  await page.route('**/api/read/projects/proj_demo_001?*', async (route) => {
    await pending
    await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('[data-shell-tabbar]')).toBeVisible({ timeout: 30000 })
  const request = page.waitForRequest(request => request.url().includes('/api/read/projects/proj_demo_001?'))
  await page.locator('[data-tab-key="/project/proj_demo_001"] [data-tab-trigger]').click()
  await request
  await page.locator('[data-tab-key="/base/supplier"] [data-tab-trigger]').click()
  await expect(page).toHaveURL('/base/supplier')
  const response = page.waitForResponse(response => response.url().includes('/api/read/projects/proj_demo_001?'))
  finish()
  await response
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page).toHaveURL('/base/supplier')
  await expect(page.locator('[data-tab-restore-status] [role="alert"]')).toHaveCount(0)
})

test('软刷新保留其他表单输入，浏览器刷新排除写态与草稿数据', async ({ page }) => {
  await page.goto('/project/form')
  const field = page.getByLabel('项目名称 *')
  await expect(field).toBeVisible({ timeout: 30000 })
  await field.fill('页签中尚未保存的项目')
  await page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: '项目列表', exact: true }).click()
  await expect(page).toHaveURL('/project')
  await page.getByRole('button', { name: '刷新当前页', exact: true }).click()
  await page.locator('[data-tab-key="/project/form"] [data-tab-trigger]').click()
  await expect(field).toHaveValue('页签中尚未保存的项目')
  const raw = await page.evaluate(key => localStorage.getItem(key), key)
  expect(raw).not.toContain('尚未保存')
  expect(raw).not.toContain('/project/form')
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await expect(page.locator('[data-shell-tabbar]')).toBeVisible({ timeout: 30000 })
  await expect(page).toHaveURL('/project')
  await expect(page.locator('[data-tab-key="/project/form"]')).toHaveCount(0)
})
