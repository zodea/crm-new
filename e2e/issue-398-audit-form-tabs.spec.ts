import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installContractEngineeringFixture, selectContractEngineeringFixture } from './helpers/contract-engineering-fixture'
import { createVerifiedSignatory, selectVerifiedSignatory } from './helpers/contract-signatory'
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

test('从首页关闭后台表单的其他页签后激活该表单并保留输入', async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': `audit-close-other-${testInfo.workerIndex}` })
  await page.goto('/project/form')
  const name = page.getByLabel('项目名称', { exact: false }).first()
  await expect(name).toBeVisible({ timeout: 30_000 })
  await name.fill('关闭其他后保留的草稿')
  await page.getByRole('searchbox', { name: '搜索菜单' }).fill('分供方')
  await page.locator('[data-sidebar="sidebar"] a[href="/base/supplier"]').click()
  await expect(page).toHaveURL(/\/base\/supplier$/)
  await page.locator('[data-tab-key="home"] [data-tab-trigger]').click()
  await expect(page).toHaveURL(/\/$/)
  const retained = page.locator('[data-shell-tab][data-tab-key="/project/form"]')
  await retained.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '关闭其他', exact: true }).click()
  await expect(page).toHaveURL(/\/project\/form$/)
  await expect(retained.locator('[data-tab-trigger]')).toHaveAttribute('aria-current', 'page')
  await expect(name).toHaveValue('关闭其他后保留的草稿')
  await expect(page.locator('[data-shell-tab][data-tab-key="/base/supplier"]')).toHaveCount(0)
})

test('关闭左侧遇到未保存草稿时取消保留，确认后才关闭', async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': `audit-close-left-${testInfo.workerIndex}` })
  await page.goto('/project/form')
  const name = page.getByLabel('项目名称', { exact: false }).first()
  await expect(name).toBeVisible({ timeout: 30_000 })
  await name.fill('关闭左侧前保留的草稿')
  await page.getByRole('searchbox', { name: '搜索菜单' }).fill('分供方')
  await page.locator('[data-sidebar="sidebar"] a[href="/base/supplier"]').click()
  await expect(page).toHaveURL(/\/base\/supplier$/)
  const formTab = page.locator('[data-shell-tab][data-tab-key="/project/form"]')
  const supplierTab = page.locator('[data-shell-tab][data-tab-key="/base/supplier"]')
  await supplierTab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '关闭左侧', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('未保存')
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await formTab.locator('[data-tab-trigger]').click()
  await expect(name).toHaveValue('关闭左侧前保留的草稿')
  await supplierTab.locator('[data-tab-trigger]').click()
  await supplierTab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '关闭左侧', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(formTab).toHaveCount(0)
  await expect(supplierTab.locator('[data-tab-trigger]')).toHaveAttribute('aria-current', 'page')
})

for (const kind of ['construction', 'material', 'subcontract'] as const) {
  test(`${kind} 保存并新建连续两次创建独立合同并清空表单`, async ({ page }) => {
    const id = `audit-new-${kind}-${randomUUID()}`
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    const reset = await page.request.post(`/api/testing/${kind}-contracts/reset`, {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
      data: { scenario: 'ready' },
    })
    expect(reset.ok()).toBe(true)
    const ownName = '连续新建合成签约主体'
    const ownId = await createVerifiedSignatory(page, ownName, id)
    if (kind !== 'construction')
      await installContractEngineeringFixture(page, kind, kind === 'material' ? '中央正式材料项目' : '中央正式施工项目')
    await page.goto(`/contract/${kind}/form`)
    const savedIds: string[] = []
    for (let index = 0; index < 2; index++) {
      const name = page.getByLabel('合同名称 *')
      await expect(name).toHaveValue('', { timeout: 20_000 })
      await name.fill(`连续新增合同 ${index + 1}`)
      await selectVerifiedSignatory(page, ownId, ownName)
      if (kind === 'construction') {
        await page.getByRole('combobox', { name: '检索项目' }).click()
        await page.getByText('中央正式施工项目', { exact: true }).click()
      }
      else {
        await selectContractEngineeringFixture(page)
      }
      await page.getByRole('combobox', { name: kind === 'construction' ? '检索客户' : '检索分供方' }).click()
      await page.getByText(kind === 'construction' ? '中央正式甲方客户' : kind === 'material' ? '中央正式材料供应商' : '中央正式劳务分供方', { exact: true }).click()
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
