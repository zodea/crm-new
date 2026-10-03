import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const FORM_ROUTES = [
  {
    path: '/finance/receipt/new',
    title: '新建 · 收款登记',
    field: 'receipt-no',
    value: 'SK-F3-DRAFT',
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
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `f3-${randomUUID()}` })
    await page.clock.setFixedTime(new Date('2026-09-11T04:00:00.000Z'))
    const reset = await page.request.post('/api/testing/receipts/reset', {
      headers: { 'x-ruihang-test-reset': '1' },
      data: { scenario: 'ready', seed: true },
    })
    expect(reset.ok(), await reset.text()).toBe(true)
  })
  for (const form of FORM_ROUTES) {
    test(`${form.title}：独立保存不完整草稿并回显`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const value = `F3-草稿-${form.path.split('/')[2]}`
      await page.goto(form.path)
      if (form.path === '/finance/payment/new')
        await enterPaymentApplicationForm(page)
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible()
      const actions = page.getByRole('group', { name: '表单操作' })
      for (const name of ['取消', '保存草稿', '保存并新建', '保存并提交', '保存'])
        await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
      const field = form.field === 'receipt-no'
        ? page.getByRole('textbox', { name: '收款单号', exact: true })
        : page.locator(form.field)
      await field.fill(value)
      await actions.getByRole('button', { name: '保存草稿', exact: true }).click()
      await expect(page).not.toHaveURL(new RegExp(`${form.path}$`))
      await expect(field).toHaveValue(value)
      await expect(actions.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
      await expectNoPageOverflow(page, form.path)
    })
  }

  for (const input of [
    { applicant: 'F3报销甲', item: '办公耗材', amount: '35.5', total: '35.50', fileName: 'reimbursement-a.pdf' },
    { applicant: 'F3报销乙', item: '项目资料印刷', amount: '113.25', total: '113.25', fileName: 'reimbursement-b.pdf' },
  ]) {
    test(`公司报销空项目提交、金额及附件删除恢复：${input.applicant}`, async ({ page }) => {
      await page.goto('/finance/reimbursement/new')
      await page.getByTestId('finance-name').fill(input.applicant)
      await page.getByTestId('reimbursement-item-0').fill(input.item)
      await page.getByTestId('reimbursement-amount-0').fill(input.amount)
      await expect(page.getByText(`合计 ¥ ${input.total}`, { exact: true })).toBeVisible()
      await page.locator('input[type="file"]').setInputFiles({ name: input.fileName, mimeType: 'application/pdf', buffer: Buffer.from('reimbursement-e2e') })
      await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect(page).toHaveURL(/\/finance\/reimbursement\/[^/?]+$/)
      await expect(page.getByTestId('finance-name')).toHaveValue(input.applicant)
      await expect(page.getByText(input.fileName, { exact: true })).toBeVisible()
      await expect(page.getByText(`合计 ¥ ${input.total}`, { exact: true })).toBeVisible()
      const attachments = page.locator('#section-attachments')
      await attachments.getByRole('button', { name: '删除', exact: true }).click()
      await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect(attachments.getByText('已删除', { exact: true })).toBeVisible()
      await attachments.getByRole('button', { name: '恢复', exact: true }).click()
      await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect(attachments.getByText('已删除', { exact: true })).toHaveCount(0)
      await expect(attachments.getByText(input.fileName, { exact: true })).toBeVisible()
    })
  }

  for (const field of [
    { label: '收款日期', role: 'textbox', error: '请填写收款日期' },
    { label: '选择项目', role: 'combobox', error: '请选择项目' },
    { label: '选择项目主客户', role: 'combobox', error: '请选择付款方客户' },
    { label: '收款金额', role: 'textbox', error: '收款金额必须大于 0' },
  ] as const) {
    test(`收款提交按当前中央规则呈现必填错误：${field.label}`, async ({ page }) => {
      await page.goto('/finance/receipt/new')
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect(page.getByRole('alert', { name: '收款尚未保存' })).toBeVisible()
      await expect(page.getByRole(field.role, { name: field.label, exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText(field.error, { exact: true })).toBeVisible()
      await expect(page.getByRole('textbox', { name: '收款日期', exact: true })).toBeFocused()
    })
  }

  for (const input of [
    { label: '整数支付', amount: '88', date: '2026-07-25' },
    { label: '含分支付', amount: '113.25', date: '2024-02-29' },
  ]) {
    test(`${input.label} 公司付款无虚拟项目、分摊确认和撤回`, async ({ page }) => {
      test.setTimeout(120_000)
      const suffix = `F3-payment-${input.label}`
      const applicationName = `E2E公司付款-${suffix}`
      await page.goto('/finance/payment/new')
      await enterPaymentApplicationForm(page, '公司付款')
      await page.getByTestId('finance-name').fill(applicationName)
      await page.getByTestId('finance-amount').fill(input.amount)
      await page.getByTestId('finance-date').fill(input.date)
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
      await page.getByTestId('finance-date').fill(input.date)
      await page.getByTestId('finance-amount').fill(input.amount)
      await page.getByLabel('付款凭证号 *').fill(`V-E2E-${suffix}`)
      await page.getByTestId('payment-bank-serial').fill(`BANK-E2E-${suffix}`)
      await page.getByTestId('add-grid-line').click()
      await chooseLookup(page, '选择付款申请', applicationName, applicationName)
      await page.getByLabel('本次支付分摊金额').fill(input.amount)
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
  }

  for (const width of RESPONSIVE_WIDTHS) {
    for (const form of FORM_ROUTES) {
      test(`${form.title} @ ${width}px：无页面级横向溢出`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await page.goto(form.path)
        if (form.path === '/finance/payment/new')
          await enterPaymentApplicationForm(page)
        await expect(page.getByRole('heading', { name: form.title })).toBeVisible()
        await expectNoPageOverflow(page, `${form.path} @ ${width}px`)
      })
    }
  }
})
