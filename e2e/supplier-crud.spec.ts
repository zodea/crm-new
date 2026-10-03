import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const SUPPLIER_INPUTS = [
  { name: '中央维护供方甲', category: '专业分包商', contact: '张经理', editedContact: '李经理', aliases: '临时；甲供方', expectedAliases: '临时、甲供方' },
  { name: '中央维护供方乙', category: '材料供应商', contact: '王经理', editedContact: '陈经理', aliases: '临时；乙供方', expectedAliases: '临时、乙供方' },
] as const

test.beforeEach(async ({ page }, info) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `supplier-crud-${Buffer.from(info.testId).toString('base64url')}` })
  const reset = await page.request.post('/api/testing/suppliers/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
})

for (const input of SUPPLIER_INPUTS) {
  test(`中央分供方 ${input.category} 新建、显式编辑、详情回读和页签复用`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/base/supplier')
    await page.getByRole('button', { name: '新增分供方', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '选择分供方类别' })
    await dialog.getByRole('radio', { name: input.category, exact: true }).check()
    await dialog.getByRole('button', { name: '进入新建表单', exact: true }).click()
    await expect(page.getByRole('heading', { name: '新建 · 分供方', exact: true })).toBeVisible()
    await page.getByLabel('公司全称 *', { exact: true }).fill(input.name)
    await page.getByLabel('简称/别名', { exact: true }).fill(input.aliases)
    await page.getByLabel('主要联系人 *', { exact: true }).fill(input.contact)
    const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/suppliers') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    const response = await saved
    expect(response.ok(), await response.text()).toBe(true)
    const { id } = await response.json()
    await expect(page).toHaveURL(new RegExp(`/base/supplier/${id}\\?origin=real`))
    await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: '已打开页面' })
    const detailTab = tabs.getByRole('button', { name: input.name, exact: true })
    const tabCount = await tabs.locator('[data-tab-trigger]').count()
    await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
    await expect(page.getByLabel('简称/别名', { exact: true })).toHaveValue(input.expectedAliases)
    await expect(page.getByLabel('分供方类别 *')).toHaveValue(input.category)
    await page.getByLabel('主要联系人 *', { exact: true }).fill(input.editedContact)
    const edited = page.waitForResponse(response => response.url().endsWith(`/api/commands/suppliers/${id}`) && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await edited).ok()).toBe(true)
    await expect(page.getByText(input.editedContact, { exact: true }).first()).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
    await expect(page.getByText(input.editedContact, { exact: true }).first()).toBeVisible()
    await page.getByRole('link', { name: '返回分供方列表', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索关键词…', exact: true }).fill(input.name)
    const link = page.getByRole('link', { name: input.name, exact: true })
    await expect(link).toBeVisible()
    await link.click()
    await expect(detailTab).toHaveCount(1)
    await expect(tabs.locator('[data-tab-trigger]')).toHaveCount(tabCount)
    expect(errors).toEqual([])
  })
}

// 旧本地删除/级联算法继续由 tests/db/soft-delete.test.ts 和通用主数据组件测试覆盖。
for (const input of SUPPLIER_INPUTS) {
  test(`中央列表 ${input.category} 行菜单保持只读入口，不暴露旧本地删除`, async ({ page }) => {
    await page.goto(`/base/supplier/form?category=${encodeURIComponent(input.category)}`)
    await page.getByLabel('公司全称 *', { exact: true }).fill(input.name)
    await page.getByLabel('主要联系人 *', { exact: true }).fill(input.contact)
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回分供方列表', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索关键词…', exact: true }).fill(input.name)
    await page.getByRole('button', { name: `${input.name}操作`, exact: true }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText(['查看详情'])
    await expect(menu.getByRole('menuitem', { name: /删除|编辑/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: `${input.name}操作`, exact: true })).toBeFocused()
  })
}
