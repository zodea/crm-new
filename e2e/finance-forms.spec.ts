import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const FORM_ROUTES = [
  {
    path: '/finance/receipt/new',
    title: '新建 · 收款登记',
    field: '[data-testid="finance-no"]',
  },
  {
    path: '/finance/billing/new',
    title: '新建 · 开票申请',
    field: '[data-testid="finance-name"]',
  },
  {
    path: '/finance/current/new',
    title: '新建 · 往来收付',
    field: '[data-testid="finance-name"]',
  },
  {
    path: '/finance/records/new',
    title: '新建 · 支付记录',
    field: '[data-testid="finance-name"]',
  },
  {
    path: '/finance/reimbursement/new',
    title: '新建 · 费用报销',
    field: '[data-testid="finance-name"]',
  },
  {
    path: '/finance/payment/new',
    title: '新建 · 付款申请',
    field: '[data-testid="finance-name"]',
  },
] as const

async function chooseLookup(
  page: Page,
  label: string,
  keyword: string,
  optionText: string,
) {
  const input = page.getByLabel(label)
  await input.fill(keyword)
  await page.getByRole('option').filter({ hasText: optionText }).first().click()
}

async function chooseSelect(page: Page, label: string, optionText: string) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: optionText, exact: true }).click()
}

async function enterPaymentApplicationForm(page: Page, bizType = '有合同-材料') {
  await expect(page.getByRole('heading', { name: '选择付款业务类型' })).toBeVisible()
  await page.getByRole('button', { name: bizType, exact: true }).click()
}

test.describe('F3 资金表单、真实分摊与人工支付确认', () => {
  test('六条命名路由均可保存不完整草稿并在小屏回显', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [index, form] of FORM_ROUTES.entries()) {
      const value = `E2E-F3-草稿-${index}-${Date.now()}`
      await page.goto(form.path)
      if (form.path === '/finance/payment/new')
        await enterPaymentApplicationForm(page)
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button'))
        .toHaveCount(5)

      await page.locator(form.field).fill(value)
      await page.getByRole('button', { name: '保存草稿' }).click()
      await expect(page).not.toHaveURL(form.path)
      await expect(page.locator(form.field)).toHaveValue(value)
      await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()

      const widths = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      expect(widths.scroll, `${form.path} 不应产生页面级横向溢出`)
        .toBeLessThanOrEqual(widths.client)
    }
  })

  test('公司报销可空项目提交，明细合计和附件删除恢复均可回显', async ({ page }) => {
    const applicant = `E2E报销人-${Date.now()}`
    await page.goto('/finance/reimbursement/new')
    await page.getByTestId('finance-name').fill(applicant)
    await page.getByTestId('reimbursement-item-0').fill('办公耗材')
    await page.getByTestId('reimbursement-amount-0').fill('35.5')
    await expect(page.getByText('合计 ¥ 35.50', { exact: true })).toBeVisible()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-reimbursement.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('reimbursement-e2e'),
    })
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()

    await expect(page).toHaveURL(/\/finance\/reimbursement\/[^/?]+$/)
    await expect(page.getByTestId('finance-name')).toHaveValue(applicant)
    await expect(page.getByText('e2e-reimbursement.pdf', { exact: true })).toBeVisible()
    await expect(page.getByText('合计 ¥ 35.50', { exact: true })).toBeVisible()

    const attachments = page.locator('#section-attachments')
    await attachments.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toBeVisible()
    await attachments.getByRole('button', { name: '恢复' }).click()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toHaveCount(0)
  })

  test('必填校验同时标红字段并给出 system warning', async ({ page }) => {
    await page.goto('/finance/receipt/new')
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page.getByText(/为必填项（共 \d+ 处）/)).toBeVisible()
    await expect(page.locator('.field-error').first()).toBeVisible()
    await expect(page.locator('.border-danger\\!').first()).toBeVisible()
  })

  test('公司付款申请不造虚拟项目，支付记录可分摊、确认和撤回', async ({ page }) => {
    test.setTimeout(120_000)
    const suffix = Date.now()
    const applicationName = `E2E公司付款-${suffix}`
    await page.goto('/finance/payment/new')
    await enterPaymentApplicationForm(page, '公司付款')
    await page.getByTestId('finance-name').fill(applicationName)
    await page.getByTestId('finance-amount').fill('88')
    await page.getByTestId('finance-date').fill('2026-07-25')
    await page.getByLabel('申请人 *').fill('财务')
    await chooseSelect(page, '回票类型', '无需发票')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/finance\/payment\/[^/?]+$/)
    await expect(page.getByText('公司付款', { exact: true }).first()).toBeVisible()

    await page.locator('a[href="/finance/records"]').first().click()
    await page.getByTestId('create-finance-form').click()
    await expect(page).toHaveURL('/finance/records/new')
    await page.getByTestId('finance-name').fill(`E2E收款方-${suffix}`)
    await page.getByTestId('finance-date').fill('2026-07-25')
    await page.getByTestId('finance-amount').fill('88')
    await page.getByLabel('付款凭证号 *').fill(`V-E2E-${suffix}`)
    await page.getByTestId('payment-bank-serial').fill(`BANK-E2E-${suffix}`)
    await page.getByTestId('add-grid-line').click()
    await chooseLookup(page, '选择付款申请', applicationName, applicationName)
    await page.getByLabel('本次支付分摊金额').fill('88')
    await page.getByTestId('payment-confirmed-by').fill('E2E 财务')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByTestId('confirm-payment').click()
    await page.getByRole('dialog').getByRole('button', { name: '确认支付' }).click()

    await expect(page).toHaveURL(/\/finance\/records\/[^/?]+$/)
    await expect(page.getByText('已人工确认', { exact: true })).toBeVisible()
    await page.getByTestId('unconfirm-payment').click()
    await page.getByRole('dialog').getByRole('button', { name: '撤回确认' }).click()
    await expect(page.getByText('待核对', { exact: true }).first()).toBeVisible()
  })

  test('六条表单在桌面响应式矩阵均无页面级横向溢出', async ({ page }) => {
    test.setTimeout(120_000)
    for (const width of [768, 1024, 1366]) {
      await page.setViewportSize({ width, height: 900 })
      for (const form of FORM_ROUTES) {
        await page.goto(form.path)
        if (form.path === '/finance/payment/new')
          await enterPaymentApplicationForm(page)
        await expect(page.getByRole('heading', { name: form.title })).toBeVisible()
        const widths = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }))
        expect(widths.scroll, `${form.path} @ ${width}px 不应产生页面级横向溢出`)
          .toBeLessThanOrEqual(widths.client)
      }
    }
  })
})
