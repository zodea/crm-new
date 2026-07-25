import { expect, test } from '@playwright/test'

const FORM_ROUTES = [
  ['/base/supplier/form', '新建 · 分供方'],
  ['/base/customer/form', '新建 · 客户'],
  ['/base/crew/form', '新建 · 班组'],
  ['/base/worker/form', '新建 · 工人'],
  ['/project/form', '新建 · 项目'],
  ['/project/target-cost/form', '新建 · 目标成本'],
] as const

test.describe('F1 基础主数据整页表单', () => {
  test('六条命名表单路由共用完整五动作底栏且小屏无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [path, title] of FORM_ROUTES) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: title })).toBeVisible({
        timeout: 20_000,
      })

      const footer = page.getByRole('group', { name: '表单操作' })
      await expect(footer).toBeVisible()
      await expect(footer.getByRole('button')).toHaveCount(5)

      const widths = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      expect(widths.scroll, `${path} 不应横向溢出`).toBeLessThanOrEqual(widths.client)
    }
  })

  test('客户整页表单：提交校验 → 新增 → 刷新回显 → 软删除', async ({ page }) => {
    const name = `E2E客户-${Date.now()}`
    const taxNo = `E2E-TAX-${Date.now()}`

    await page.goto('/base/customer/form')
    const footer = page.getByRole('group', { name: '表单操作' })
    await footer.getByRole('button', { name: '保存并提交' }).click()
    await expect(page.getByText('客户名称为必填项', { exact: true })).toBeVisible()

    await page.getByLabel('客户名称 *').fill(name)
    await page.getByLabel('统一社会信用代码').fill(taxNo)
    await page.getByLabel('联系人 *').fill('E2E联系人')
    await page.getByLabel('联系电话').fill('13800138000')
    await footer.getByRole('button', { name: '保存并提交' }).click()

    await expect(page).toHaveURL('/base/customer')
    await page.getByPlaceholder('搜索客户').fill(name)
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row).toContainText(taxNo)

    await row.getByRole('button', { name: `编辑${name}` }).click()
    await expect(page.getByLabel('客户名称 *')).toHaveValue(name)
    await page.getByRole('link', { name: '返回客户列表' }).click()
    await page.getByPlaceholder('搜索客户').fill(name)
    const restoredRow = page.getByRole('row').filter({ hasText: name })
    await restoredRow.getByRole('button', { name: `编辑${name}` }).click()
    await expect(page.getByLabel('统一社会信用代码')).toHaveValue(taxNo)

    await page.getByRole('link', { name: '返回客户列表' }).click()
    await page.getByPlaceholder('搜索客户').fill(name)
    await restoredRow.getByRole('button', { name: `删除${name}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除' }).click()
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0)
  })
})
