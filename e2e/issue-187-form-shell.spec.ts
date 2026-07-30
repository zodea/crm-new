import { expect, test } from '@playwright/test'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

test.describe('Issue #187：统一整页表单壳', () => {
  test('新建自动聚焦，提交失败走字段与 toast 双通道，编辑页正确回显', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await page.goto('/base/supplier/form')

    const companyName = page.getByLabel('公司全称 *')
    const saveSubmit = page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存并提交' })
    await expect(page.getByRole('heading', { name: '新建 · 分供方' })).toBeVisible({ timeout: 15_000 })
    await expect(companyName).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.getByText('公司全称为必填项', { exact: true })).toBeVisible()
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)

    await saveSubmit.click()
    await expect(page.getByText('公司全称为必填项', { exact: true })).toBeVisible()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '公司全称为必填项' }))
      .toBeVisible()
    await expect(companyName).toBeFocused()

    await companyName.fill('待校验焦点分供方')
    await page.getByLabel('分供方类别 *').selectOption({ index: 1 })
    const contact = page.getByLabel('主要联系人 *')
    await expect(contact).not.toBeInViewport()
    await saveSubmit.click()
    await expect(page.getByText('主要联系人为必填项', { exact: true })).toBeVisible()
    await expect(contact).toBeFocused()
    await expect(contact).toBeInViewport()

    await page.goto('/base/supplier/form/sup_demo_004')
    await expect(page.getByRole('heading', { name: '编辑 · 分供方' })).toBeVisible()
    await expect(page.getByLabel('公司全称 *')).toHaveValue('穗建五金机电经营部')
    await expect(page.getByLabel('公司全称 *')).toBeFocused()
  })

  test('必填 LookupSelect 参与失焦校验与首错定位', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 })

    await page.goto('/project/target-cost/form')
    await page.getByLabel('版本名 *').fill('待校验目标成本')
    const targetProject = page.getByRole('combobox', { name: '检索项目' })
    await targetProject.focus()
    await page.keyboard.press('Tab')
    await expect(page.getByText('项目为必填项', { exact: true })).toBeVisible()
    await expect(targetProject).toHaveAttribute('aria-invalid', 'true')
    await expect(targetProject).toHaveAttribute('aria-describedby', 'target-cost-project-error')
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存并提交' })
      .click()
    await expect(targetProject).toBeFocused()
    await expect(targetProject).toBeInViewport()

    await page.goto('/project/form')
    await page.getByLabel('项目名称 *').fill('待校验项目')
    const customer = page.getByRole('combobox', { name: '检索客户' })
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存并提交' })
      .click()
    await expect(page.getByText('客户为必填项', { exact: true })).toBeVisible()
    await expect(customer).toHaveAttribute('aria-invalid', 'true')
    await expect(customer).toHaveAttribute('aria-describedby', 'project-customer-error')
    await expect(customer).toBeFocused()
    await expect(customer).toBeInViewport()
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`分区、字段与吸底动作在 ${width}px 保持可达`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : 900,
      })
      await page.goto('/base/supplier/form')

      const shell = page.locator('[data-ui="entity-form-shell"]')
      await expect(shell).toBeVisible()
      const footer = shell.getByRole('group', { name: '表单操作' })
      await expect(footer).toHaveCSS('position', 'sticky')
      await expect(footer).toBeInViewport()
      const sections = shell.getByRole('navigation', { name: '表单分区' })
      await expect(sections).toBeHidden()
      await expectNoPageOverflow(page, `统一表单壳 @ ${width}px`)
    })
  }

  test('200% 等效宽度与页签切换保值，放弃确认关闭后归还焦点', async ({ page }) => {
    await page.setViewportSize(EQUIVALENT_200_PERCENT_VIEWPORT)
    await page.goto('/base/supplier/form')
    await expectNoPageOverflow(page, '统一表单壳 @ 200% 等效宽度')

    const companyName = page.getByLabel('公司全称 *')
    await companyName.fill('未保存的分供方页签草稿')
    await page.getByRole('button', { name: '切换侧边栏' }).click()
    await page.getByRole('dialog', { name: '导航菜单' })
      .getByRole('link', { name: /班组管理/ })
      .click()
    await expect(page).toHaveURL('/base/crew')
    await expect(page.getByRole('dialog', { name: '放弃修改' })).toHaveCount(0)

    await page.getByRole('navigation', { name: '已打开页面' })
      .getByRole('button', { name: '新建 · 分供方', exact: true })
      .click()
    await expect(companyName).toHaveValue('未保存的分供方页签草稿')

    const cancel = page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '取消', exact: true })
    await cancel.click()
    const dialog = page.getByRole('dialog', { name: '放弃修改' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(cancel).toBeFocused()

    await cancel.click()
    await dialog.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(page).toHaveURL('/base/supplier')
  })
})
