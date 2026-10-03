import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installScheduleProductionFixture } from './helpers/quantity-production-fixture'
import { expectLocalHorizontalScroll, expectNoPageOverflow } from './helpers/responsive'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-06T04:00:00.000Z'))
})

async function openWizardProcesses(page: Page, startDate: string) {
  const fixture = await installScheduleProductionFixture(page)
  await page.goto(fixture.wizardUrl)
  await expect(page.getByRole('heading', { name: '楼栋分组与标准工序', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: /内部暂估/ }).check()
  await expect(page.locator('[data-schedule-wizard-step="1"] input[type="checkbox"]:checked')).toHaveCount(1)
  await page.getByRole('button', { name: '下一步：选择工序', exact: true }).click()
  await page.getByRole('combobox', { name: '标准工序库', exact: true }).click()
  await page.getByRole('option', { name: 'E2E四工序库 · v1 · 4 道', exact: true }).click()
  await page.getByLabel('计划开始', { exact: true }).fill(startDate)
  await page.getByRole('radio', { name: '完全顺排', exact: true }).check()
  await expect(page.getByLabel('放线及新建墙体默认工期', { exact: true })).toHaveValue('2')
  return fixture
}

test('复用表单页签时按正式来源版本重新初始化，并可切回空白草稿', async ({ page }) => {
  const fixture = await installScheduleProductionFixture(page)
  await page.goto('/schedule/process-library?origin=real')
  await page.getByRole('link', { name: '新建空白工序库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新建标准工序库', exact: true })).toBeVisible()
  await expect(page.getByLabel('工序库编码 *', { exact: true })).toHaveValue('')
  const openedTabs = page.getByRole('navigation', { name: '已打开页面', exact: true })
  await openedTabs.getByRole('button', { name: '标准工序库', exact: true }).click()
  const group = page.locator('section').filter({ has: page.getByRole('heading', { name: 'E2E四工序库', exact: true }) })
  await group.getByRole('link', { name: '基于此版本新建', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/schedule/process-library/form' && url.searchParams.get('source') === fixture.library.id && url.searchParams.get('origin') === 'real')
  await expect(page.getByRole('heading', { name: '基于旧版新建版本', exact: true })).toBeVisible()
  await expect(page.getByLabel('工序库编码 *', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('工序库编码 *', { exact: true })).toHaveValue('E2E-SCHEDULE')
  await expect(page.getByLabel('放线及新建墙体默认工期', { exact: true })).toHaveValue('2')
  await openedTabs.getByRole('button', { name: '标准工序库', exact: true }).click()
  await page.getByRole('link', { name: '新建空白工序库', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/schedule/process-library/form' && !url.searchParams.has('source') && url.searchParams.get('origin') === 'real')
  await expect(page.getByRole('heading', { name: '新建标准工序库', exact: true })).toBeVisible()
  await expect(page.getByLabel('工序库编码 *', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('工序库编码 *', { exact: true })).toHaveValue('')
})

for (const duration of ['1', '31']) {
  test(`正式来源版本保持不可变，新版保存独立工期 ${duration} 天及冲突处理`, async ({ page }) => {
    const fixture = await installScheduleProductionFixture(page)
    const original = await (await page.request.get(`/api/read/process-libraries/${fixture.library.id}?origin=real`)).json()
    await page.goto(`/schedule/process-library/form?source=${encodeURIComponent(fixture.library.id)}&origin=real`)
    await expect(page.getByText('来源 E2E四工序库 · v1 保持只读，本次保存会产生新版本。', { exact: true })).toBeVisible()
    await expect(page.getByRole('grid', { name: '标准工序模板甘特', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '上移给排水安装', exact: true }).click()
    const reorder = page.getByRole('dialog', { name: /本次调整会冲突/ })
    await reorder.getByRole('button', { name: '取消调整', exact: true }).click()
    await expect(page.getByRole('button', { name: '设置给排水安装前置工序', exact: true })).not.toContainText('已置灰')
    await page.getByRole('button', { name: '上移给排水安装', exact: true }).click()
    await reorder.getByRole('button', { name: '调整并置灰冲突', exact: true }).click()
    await expect(page.getByRole('button', { name: '设置给排水安装前置工序', exact: true })).toContainText('已置灰')
    await page.getByLabel('放线及新建墙体默认工期', { exact: true }).fill(duration)
    const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/process-libraries') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
    const response = await saved
    expect(response.ok(), await response.text()).toBe(true)
    const receipt = await response.json()
    await expect(page).toHaveURL(url => url.pathname === `/schedule/process-library/${receipt.id}` && url.searchParams.get('origin') === 'real')
    await expect(page.getByRole('heading', { name: 'E2E四工序库 · v2', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E四工序库 · v2', exact: true })).toBeVisible()
    const current = await (await page.request.get(`/api/read/process-libraries/${receipt.id}?origin=real`)).json()
    expect(current.tasks.find((task: { key: string }) => task.key === 'layout').durationDays).toBe(Number(duration))
    expect(current.tasks.find((task: { key: string }) => task.key === 'plumbing')).toMatchObject({ predecessorKey: 'layout', predecessorDisabled: true })
    expect(await (await page.request.get(`/api/read/process-libraries/${fixture.library.id}?origin=real`)).json()).toEqual(original)
    const catalog = await (await page.request.get('/api/read/process-libraries?origin=real')).json()
    expect(catalog.libraries.filter((row: { code: string }) => row.code === 'E2E-SCHEDULE').map((row: { version: number }) => row.version).sort()).toEqual([1, 2])
  })
}

for (const duration of [
  { input: '2', resized: '3', earlierStarts: ['08-03', '08-02', '08-01'] },
  { input: '4', resized: '5', earlierStarts: ['08-05', '08-04', '08-03', '08-02', '08-01'] },
]) {
  test(`390px 建组模板甘特和精确工期 ${duration.input}→${duration.resized} 共用状态，冲突取消不生效`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWizardProcesses(page, '2026-08-01')
    const input = page.getByLabel('放线及新建墙体默认工期', { exact: true })
    await input.fill(duration.input)
    await input.blur()
    await expectLocalHorizontalScroll(page.getByTestId('template-gantt-scroll'), '建组模板甘特')
    await page.getByRole('button', { name: '调整模板工期：放线及新建墙体', exact: true }).press('ArrowRight')
    await expect(input).toHaveValue(duration.resized)
    const move = page.getByRole('button', { name: '移动模板工序：给排水安装', exact: true })
    for (const start of duration.earlierStarts) {
      await move.press('ArrowLeft')
      await expect(move).toContainText(start)
      await expect(page.getByRole('dialog', { name: /本次调期会冲突/ })).toHaveCount(0)
    }
    await move.press('ArrowLeft')
    const conflict = page.getByRole('dialog', { name: /本次调期会冲突/ })
    await conflict.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByText('放线及新建墙体 · 已置灰', { exact: true })).toHaveCount(0)
    await move.press('ArrowLeft')
    await conflict.getByRole('button', { name: '调期并置灰冲突', exact: true }).click()
    await expect(page.getByText('放线及新建墙体 · 已置灰', { exact: true })).toBeVisible()
    await expectNoPageOverflow(page, '390px 标准工序建组')
  })
}

for (const dates of [
  { start: '2026-08-01', moved: '2026-08-02', successor: '2026-08-04', conflict: '2026-08-01' },
  { start: '2028-02-29', moved: '2028-03-01', successor: '2028-03-03', conflict: '2028-02-29' },
]) {
  test(`顺排前序后移重算后续，${dates.start} 精确日期错序仍走冲突确认`, async ({ page }) => {
    await openWizardProcesses(page, dates.start)
    const plumbing = page.getByTestId('schedule-new-process-scroll').locator('.process-row').filter({ has: page.getByRole('checkbox', { name: '启用给排水安装', exact: true }) })
    await page.getByRole('button', { name: '移动模板工序：放线及新建墙体', exact: true }).press('ArrowRight')
    await expect(page.getByRole('dialog', { name: /本次调期会冲突/ })).toHaveCount(0)
    await expect(page.getByLabel('放线及新建墙体锚点开始', { exact: true })).toHaveValue(dates.moved)
    await expect(plumbing).toContainText(dates.successor)
    const successor = page.getByLabel('给排水安装锚点开始', { exact: true })
    await successor.fill(dates.conflict)
    await successor.blur()
    const conflict = page.getByRole('dialog', { name: /本次调期会冲突/ })
    await conflict.getByRole('button', { name: '取消', exact: true }).click()
    await expect(successor).not.toHaveValue(dates.conflict)
    await successor.fill(dates.conflict)
    await successor.blur()
    await conflict.getByRole('button', { name: '调期并置灰冲突', exact: true }).click()
    await expect(plumbing.getByText('放线及新建墙体 · 已置灰', { exact: true })).toBeVisible()
  })
}
