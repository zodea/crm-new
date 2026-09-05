import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test('取消关闭和刷新保留草稿，后台页签也先确认再卸载', async ({ page }, testInfo) => {
  const id = `audit-tabs-${testInfo.workerIndex}`
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
  await page.goto('/project/form')
  const name = page.getByLabel('项目名称', { exact: false }).first()
  await expect(name).toBeVisible({ timeout: 30_000 })
  await name.fill('取消后应保留的项目草稿')
  const tab = page.locator('[data-shell-tab][data-tab-key="/project/form"]')
  await tab.getByTitle('关闭页签').click()
  await expect(page.getByRole('dialog')).toContainText('未保存')
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(name).toHaveValue('取消后应保留的项目草稿')
  await page.getByRole('button', { name: '刷新当前页', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(name).toHaveValue('取消后应保留的项目草稿')

  await page.locator('[data-tab-key="home"] [data-tab-trigger]').click()
  await tab.getByTitle('关闭页签').click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await tab.locator('[data-tab-trigger]').click()
  await expect(name).toHaveValue('取消后应保留的项目草稿')
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `草稿关闭保护 @ ${width}px`)
  }
  await tab.getByTitle('关闭页签').click()
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(tab).toHaveCount(0)
})

for (const kind of ['construction', 'material'] as const) {
  test(`${kind} 保存并新建连续两次创建独立合同并清空表单`, async ({ page }, testInfo) => {
    const id = `audit-new-${kind}-${testInfo.workerIndex}`
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    const reset = await page.request.post(`/api/testing/${kind}-contracts/reset`, {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
      data: { scenario: 'ready' },
    })
    expect(reset.ok()).toBe(true)
    await page.goto(`/contract/${kind}/form`)
    const savedIds: string[] = []
    for (let index = 0; index < 2; index++) {
      const name = page.getByLabel('合同名称 *')
      await expect(name).toHaveValue('', { timeout: 20_000 })
      await name.fill(`连续新增合同 ${index + 1}`)
      await page.getByRole('combobox', { name: '检索项目' }).click()
      await page.getByText(kind === 'construction' ? '中央正式施工项目' : '中央正式材料项目', { exact: true }).click()
      await page.getByRole('combobox', { name: kind === 'construction' ? '检索客户' : '检索分供方' }).click()
      await page.getByText(kind === 'construction' ? '中央正式甲方客户' : '中央正式材料供应商', { exact: true }).click()
      await page.getByLabel('合同内容简述 *').fill('保存并新建回归')
      await page.getByLabel('签约日期 *').fill('2026-09-05')
      const response = page.waitForResponse(response => response.url().endsWith(`/api/commands/${kind}-contracts`) && response.request().method() === 'POST')
      await page.getByRole('button', { name: '保存并新建', exact: true }).click()
      const saved = await response
      expect(saved.ok()).toBe(true)
      savedIds.push((await saved.json()).id)
      await expect(name).toHaveValue('')
      await expect(page).toHaveURL(new RegExp(`/contract/${kind}/form$`))
    }
    expect(new Set(savedIds).size).toBe(2)
  })
}
