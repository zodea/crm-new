import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test.beforeEach(async ({ page }, testInfo) => {
  const sessionId = Buffer.from(testInfo.testId, 'utf8').toString('base64url')
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
  const reset = await page.request.post('/api/testing/projects/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario: 'ready' } })
  expect(reset.ok()).toBe(true)
})

test.afterEach(async ({ page }, testInfo) => {
  const sessionId = Buffer.from(testInfo.testId, 'utf8').toString('base64url')
  const reset = await page.request.post('/api/testing/projects/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario: 'ready' } })
  expect(reset.ok()).toBe(true)
})

for (const width of [390, 768, 1024, 1293, 1440]) {
  test(`${width}px 中央新项目进入首页，缺源只读查看并返回同一身份`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/project/form')
    const name = `首页中央项目 ${width}`
    await page.getByLabel('项目名称 *').fill(name)
    await page.getByLabel('项目经理 *').fill('项目经理')
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/project\/[A-Za-z0-9-]+\?origin=real$/)
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    await page.goto('/')
    const switcher = page.getByTestId('project-switcher-trigger')
    await expect(switcher).toContainText(name)
    await expect(page).toHaveURL(new RegExp(`project=${id}&origin=real`))
    await switcher.focus()
    await page.keyboard.press('ArrowDown')
    const search = page.getByRole('combobox', { name: '搜索项目' })
    await expect(search).toBeFocused()
    await search.fill(name)
    await expect(page.getByRole('option', { name: new RegExp(name) }).last()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(switcher).toBeFocused()
    const sourceLinkStyle = await page.getByRole('link', { name: '查看施工进度来源' }).evaluate(element => ({ borderStyle: getComputedStyle(element).borderTopStyle, decoration: getComputedStyle(element).textDecorationLine }))
    expect(sourceLinkStyle).toEqual({ borderStyle: 'solid', decoration: 'none' })
    const missing = page.getByRole('status', { name: `${name}的排程来源尚未接入` })
    await expect(missing).toContainText('计划与实际进度未知')
    await expect(page.getByTestId('home-schedule-scroll')).toHaveCount(0)
    await expectNoPageOverflow(page, `${width}px 首页`)
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true })
    await page.getByRole('link', { name: '查看施工进度来源' }).click()
    await expect(page).toHaveURL(new RegExp(`/schedule\\?project=${id}&origin=real&from=home`))
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: '排程来源尚未接入' })).toBeVisible()
    await expect(page.getByRole('link', { name: '新建楼栋分组' })).toHaveCount(0)
    await expectNoPageOverflow(page, `${width}px 来源查看`)
    await page.screenshot({ path: testInfo.outputPath(`source-${width}.png`), fullPage: true })
    await page.getByRole('link', { name: '返回首页项目' }).click()
    await expect(page).toHaveURL(new RegExp(`project=${id}&origin=real`))
    await expect(page.getByTestId('project-switcher-trigger')).toContainText(name)
    expect(errors).toEqual([])
  })
}

test('删除或来源不匹配的深链不借用首个本地项目', async ({ page }) => {
  await page.goto('/schedule?project=proj_demo_001&origin=real&from=home')
  await expect(page.getByRole('alert', { name: '项目施工进度读取失败' })).toBeVisible()
  await expect(page.getByTestId('home-schedule-scroll')).toHaveCount(0)
  await page.getByRole('link', { name: '返回首页项目' }).click()
  await expect(page.getByRole('alert', { name: '首页施工进度加载失败' })).toBeVisible()
  await expect(page).toHaveURL(/project=proj_demo_001&origin=real/)
})

test('离开缓存首页后，迟到的项目读取不污染项目列表地址', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
  await page.goto('/?project=proj_demo_001&origin=demo')
  await expect(page.getByTestId('project-switcher-trigger')).toContainText('合和新城')
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/read/projects/proj_demo_002?*', async (route) => {
    await pending
    await route.continue()
  })
  const requested = page.waitForRequest(request => request.url().includes('/api/read/projects/proj_demo_002?'))
  await page.getByTestId('project-switcher-trigger').click()
  await page.getByRole('combobox', { name: '搜索项目' }).fill('锦绣华庭')
  await page.keyboard.press('Enter')
  await requested
  await page.getByRole('link', { name: '全部项目', exact: true }).click()
  await expect(page).toHaveURL('/project')
  const response = page.waitForResponse(candidate => candidate.url().includes('/api/read/projects/proj_demo_002?'))
  release()
  expect((await response).ok()).toBe(true)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page).toHaveURL('/project')
})
