import { expect, test } from '@playwright/test'

const TEMP_NAME = 'E2E临时分供方'
const EDITED_NAME = 'E2E临时分供方·改'
const CASCADE_NAME = '广州市大板东建材有限公司'

async function searchSupplier(page: import('@playwright/test').Page, name: string) {
  await page.getByPlaceholder('搜索公司名、税号、简称…').fill(name)
  await expect(page.locator('section').filter({
    has: page.getByRole('heading', { name: '分供方资料库', exact: true }),
  })).toContainText('当前 1 家')
}

test('分供方 CRUD：新增编辑、详情双页联动、页签复用与 simple 删除撤回', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/base/supplier')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: '新增分供方', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '新增分供方' })
  await dialog.getByLabel('公司全称', { exact: true }).fill(TEMP_NAME)
  await dialog.getByLabel('分供方类别', { exact: true }).selectOption('专业分包商')
  await dialog.getByLabel('简称/别名', { exact: true }).fill('临时；E2E供方')
  await dialog.getByLabel('主要联系人', { exact: true }).fill('张经理')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()

  await searchSupplier(page, TEMP_NAME)
  await expect(page.getByRole('link', { name: TEMP_NAME, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '专业分包商', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '编辑分供方', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '编辑分供方' })
  await expect(dialog.getByLabel('简称/别名', { exact: true })).toHaveValue('临时, E2E供方')
  await dialog.getByLabel('公司全称', { exact: true }).fill(EDITED_NAME)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('link', { name: EDITED_NAME, exact: true })).toBeVisible()

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  await page.getByRole('link', { name: EDITED_NAME, exact: true }).click()
  await expect(page).toHaveURL(/\/base\/supplier\/sup_/)
  await expect(page.getByRole('heading', { name: EDITED_NAME, exact: true })).toBeVisible()
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')

  await page.getByRole('button', { name: '编辑', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '编辑分供方' })
  await dialog.getByLabel('主要联系人', { exact: true }).fill('李经理')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('李经理', { exact: true }).first()).toBeVisible()

  await tabBar.getByRole('button', { name: '分供方', exact: true }).click()
  await expect(page.getByRole('link', { name: EDITED_NAME, exact: true })).toBeVisible()
  await page.getByRole('link', { name: EDITED_NAME, exact: true }).click()
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')

  await tabBar.getByRole('button', { name: '分供方', exact: true }).click()
  await page.getByRole('button', { name: '删除分供方', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '删除分供方' })
  await expect(dialog).toContainText(`确认删除分供方「${EDITED_NAME}」`)
  await expect(dialog.getByPlaceholder(EDITED_NAME)).toHaveCount(0)
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('link', { name: EDITED_NAME, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '撤回', exact: true }).click()
  await expect(page.getByRole('link', { name: EDITED_NAME, exact: true })).toBeVisible()

  expect(pageErrors, '分供方 CRUD 旅程不应产生客户端运行错误').toEqual([])
})

test('分供方 cascade 删除：打名门控、预提交撤销、最终删除且无事后撤回', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/base/supplier')
  await page.waitForLoadState('networkidle')
  await searchSupplier(page, CASCADE_NAME)

  const openCascade = async () => {
    await page.getByRole('button', { name: '删除分供方', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '删除分供方' })
    await expect(dialog).toContainText('此操作将影响以下关联数据')
    await expect(dialog).toContainText(/发票\s*×\d+/)
    await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeDisabled()
    await dialog.getByPlaceholder(CASCADE_NAME).fill(CASCADE_NAME)
    await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeEnabled()
    return dialog
  }

  let dialog = await openCascade()
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /撤销（\d+s 内可停）/ })).toBeVisible()
  await expect(page.getByRole('link', { name: CASCADE_NAME, exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: /撤销/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('link', { name: CASCADE_NAME, exact: true })).toBeVisible()

  dialog = await openCascade()
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 6_000 })
  await expect(page.getByRole('link', { name: CASCADE_NAME, exact: true })).toHaveCount(0)
  await expect(page.getByText(`已删除「${CASCADE_NAME}」及其下游数据`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '撤回', exact: true })).toHaveCount(0)

  expect(pageErrors, '分供方 cascade 删除不应产生客户端运行错误').toEqual([])
})
