import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectNoPageOverflow,
} from './helpers/responsive'

const VIEWPORT_WIDTHS = [390, 768, 1024, 1280, 1440] as const

test.describe('Issue #187：统一整页表单壳', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `form-shell-${randomUUID()}` })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  })

  for (const input of [
    { name: '待校验焦点材料分供方', category: '材料供应商', contact: '合成联系人甲' },
    { name: '待校验焦点专业分供方', category: '专业分包商', contact: '合成联系人乙' },
  ]) {
    test(`新建自动聚焦、双通道校验与正式编辑回显：${input.category}`, async ({ page }) => {
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

      await companyName.fill(input.name)
      await page.getByLabel('分供方类别 *').selectOption(input.category)
      const contact = page.getByLabel('主要联系人 *')
      await expect(contact).not.toBeInViewport()
      await saveSubmit.click()
      await expect(page.getByText('主要联系人为必填项', { exact: true })).toBeVisible()
      await expect(contact).toBeFocused()
      await expect(contact).toBeInViewport()

      await contact.fill(input.contact)
      const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/suppliers') && response.request().method() === 'POST')
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      const response = await saved
      expect(response.ok(), await response.text()).toBe(true)
      const { id } = await response.json()
      await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
      await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/base/supplier/form/${id}`)
      await expect(page.getByRole('heading', { name: '编辑 · 分供方' })).toBeVisible()
      await expect(page.getByLabel('公司全称 *')).toHaveValue(input.name)
      await expect(page.getByLabel('主要联系人 *')).toHaveValue(input.contact)
      await expect(page.getByLabel('公司全称 *')).toBeFocused()
    })
  }

  for (const input of [
    { label: '目标成本中央提交', path: '/project/target-cost/form?origin=real', nameLabel: '版本名 *', name: '待校验目标成本', lookup: '检索项目', message: '请选择项目', errorId: 'target-cost-project-error', blur: false },
    { label: '项目失焦与提交', path: '/project/form', nameLabel: '项目名称 *', name: '待校验项目', lookup: '检索客户', message: '客户为必填项', errorId: 'project-customer-error', blur: true },
  ]) {
    test(`必填 LookupSelect 显示独立错误并定位首错：${input.label}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 520 })

      await page.goto(input.path)
      await page.waitForLoadState('networkidle')
      const name = page.getByLabel(input.nameLabel)
      if (input.blur)
        await expect(name).toBeFocused()
      await name.fill(input.name)
      const lookup = page.getByRole('combobox', { name: input.lookup })
      if (input.blur) {
        await lookup.focus()
        await page.keyboard.press('Tab')
        await expect(page.getByText(input.message, { exact: true })).toBeVisible()
      }
      await page.getByRole('group', { name: '表单操作' })
        .getByRole('button', { name: '保存并提交' })
        .click()
      await expect(page.getByText(input.message, { exact: true })).toBeVisible()
      await expect(lookup).toHaveAttribute('aria-invalid', 'true')
      await expect(lookup).toHaveAttribute('aria-describedby', input.errorId)
      await expect(lookup).toBeFocused()
      await expect(lookup).toBeInViewport()
    })
  }

  for (const width of VIEWPORT_WIDTHS) {
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
