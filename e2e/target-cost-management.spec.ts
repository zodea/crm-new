import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

const viewports = [390, 768, 1024, 1280, 1440]
const cases = [
  { label: '材料长度', project: PROJECT_INPUTS[0], versionName: 'E2E材料预算', category: '材料', item: 'E2E电线', unit: 'm', quantity: '100', price: '2.5', amount: '250' },
  { label: '工资面积', project: PROJECT_INPUTS[1], versionName: 'E2E工资预算', category: '工人工资', item: 'E2E墙砖工资', unit: '㎡', quantity: '20', price: '15', amount: '300' },
]

test.describe('Issue #191：目标成本列表与科目维护', () => {
  test('专用列表筛选在各宽度可达且无页面级横向溢出', async ({ page }) => {
    await installProjectCentralFixture(page)
    await page.goto('/project/target-cost?origin=real')

    await expect(page.getByRole('heading', { name: '目标成本列表', exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('status', { name: '目标成本列表汇总' })).toBeVisible()
    const filters = page.getByRole('search', { name: '目标成本筛选' })
    for (const width of viewports) {
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : width === 768 ? 900 : 1000,
      })
      await expect(filters.getByPlaceholder('搜索版本名或项目')).toBeVisible()
      await expect(filters.getByLabel('项目', { exact: true })).toBeVisible()
      await expect(filters.getByRole('button', { name: /^基线范围，已选/ })).toBeVisible()
      await expect(filters.getByRole('button', { name: /^状态，已选/ })).toBeVisible()
      await expectNoPageOverflow(page, `目标成本专用列表 @ ${width}px`)
    }
  })

  for (const input of cases) {
    test(`新建版本后可新增、编辑并刷新回显科目明细：${input.label}`, async ({ page }) => {
      const f = await installProjectCentralFixture(page, input.project)
      const versionName = input.versionName

      await page.goto('/project/target-cost/form?origin=real')
      await page.locator('input[data-field="name"]').fill(versionName)
      await page.getByRole('combobox', { name: '检索项目', exact: true }).fill(f.input.name)
      await page.getByRole('option', { name: new RegExp(f.input.name) }).click()
      await page.locator('input[data-field="taxInclusiveTotal"]').fill(input.amount)
      await page.getByRole('group', { name: '表单操作' })
        .getByRole('button', { name: '保存', exact: true })
        .click()

      await expect(page).toHaveURL(/\/project\/target-cost\?origin=real/)
      await page.getByPlaceholder('搜索版本名或项目').fill(versionName)
      await page.getByRole('link', { name: versionName }).click()
      await expect(page.getByRole('heading', { name: versionName })).toBeVisible()

      await page.getByRole('button', { name: '编辑科目明细' }).click()
      await page.getByRole('button', { name: '添加行' }).click()
      await page.getByRole('combobox', { name: '成本科目，第 1 行' }).selectOption(input.category)
      await page.getByRole('textbox', { name: '分项名称，第 1 行' }).fill(input.item)
      await page.getByRole('textbox', { name: '单位，第 1 行' }).fill(input.unit)
      await page.getByRole('spinbutton', { name: '数量，第 1 行' }).fill(input.quantity)
      await page.getByRole('spinbutton', { name: '单价，第 1 行' }).fill(input.price)
      await page.getByRole('spinbutton', { name: '目标金额，第 1 行' }).fill(input.amount)
      await page.getByRole('button', { name: '保存科目明细' }).click()

      await expect(page.getByText('科目明细已保存，版本头状态保持不变', { exact: true })).toBeVisible()
      await expect(page.getByRole('row').filter({ hasText: input.item })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('row').filter({ hasText: input.item }))
        .toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, '目标成本科目详情刷新回显')
    })
  }
})
