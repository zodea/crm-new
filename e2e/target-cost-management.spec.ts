import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

async function selectProject(page: Page, name: string) {
  const lookup = page.getByRole('combobox', { name: '检索项目' })
  await lookup.fill(name)
  await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible()
  await page.getByRole('option', { name: new RegExp(name) }).click()
}

test.describe('Issue #191：目标成本列表与科目维护', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 专用列表筛选可达且无页面级横向溢出`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : width === 768 ? 900 : 1000,
      })
      await page.goto('/project/target-cost')

      await expect(page.getByRole('heading', { name: '目标成本列表', exact: true }))
        .toBeVisible({ timeout: 20_000 })
      const filters = page.getByRole('search', { name: '目标成本筛选' })
      await expect(filters.getByPlaceholder('搜索版本名或项目')).toBeVisible()
      await expect(filters.getByLabel('项目', { exact: true })).toBeVisible()
      await expect(filters.getByRole('button', { name: /^基线范围，已选/ })).toBeVisible()
      await expect(filters.getByRole('button', { name: /^状态，已选/ })).toBeVisible()
      await expect(page.getByRole('status', { name: '目标成本列表汇总' })).toBeVisible()
      await expectNoPageOverflow(page, `目标成本专用列表 @ ${width}px`)
    })
  }

  test('新建版本后可新增、编辑并刷新回显科目明细', async ({ page }) => {
    const versionName = `E2E目标成本-${Date.now()}`

    await page.goto('/project/target-cost/form')
    await page.getByLabel('版本名 *').fill(versionName)
    await selectProject(page, '合和新城')
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存', exact: true })
      .click()

    await expect(page).toHaveURL('/project/target-cost')
    await page.getByPlaceholder('搜索版本名或项目').fill(versionName)
    await page.getByRole('link', { name: versionName }).click()
    await expect(page.getByRole('heading', { name: versionName })).toBeVisible()

    await page.getByRole('button', { name: '编辑科目明细' }).click()
    await page.getByRole('button', { name: '添加行' }).click()
    await page.getByRole('combobox', { name: '成本科目，第 1 行' }).selectOption('材料')
    await page.getByRole('textbox', { name: '分项名称，第 1 行' }).fill('E2E电线')
    await page.getByRole('textbox', { name: '单位，第 1 行' }).fill('m')
    await page.getByRole('spinbutton', { name: '数量，第 1 行' }).fill('100')
    await page.getByRole('spinbutton', { name: '单价，第 1 行' }).fill('2.5')
    await page.getByRole('spinbutton', { name: '目标金额，第 1 行' }).fill('250')
    await page.getByRole('button', { name: '保存科目明细' }).click()

    await expect(page.getByText('科目明细已保存', { exact: true })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'E2E电线' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('row').filter({ hasText: 'E2E电线' }))
      .toBeVisible({ timeout: 20_000 })
    await expectNoPageOverflow(page, '目标成本科目详情刷新回显')
  })
})
