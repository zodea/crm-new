import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { financeReadonlySourceBytes, installFinanceReadonlySource, readFinanceReadonlySource } from './helpers/finance-readonly-source'
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
    field: '[data-testid="finance-no"]',
  },
  {
    path: '/finance/records/new',
    title: '新建 · 支付记录',
    field: '[data-testid="finance-name"]',
  },
  {
    path: '/finance/reimbursement/new',
    title: '新建 · 费用报销',
    field: '[data-testid="finance-no"]',
  },
  {
    path: '/finance/payment/new',
    title: '新建 · 付款申请',
    field: '[data-testid="finance-name"]',
  },
] as const

async function prepareReadOnlyWorkspace(page: Page, workspace: 'production' | 'demo') {
  const bytes = await financeReadonlySourceBytes()
  await page.addInitScript(includeDemo => localStorage.setItem('ruihang:workspace-default:include-demo', String(includeDemo)), workspace === 'demo')
  // Establish this isolated origin before loading any application code; do not ask the app to initialize a Native source.
  await page.goto('/api/auth/status')
  await installFinanceReadonlySource(page, workspace, bytes)
  await page.goto('/finance/current')
  // 首次开发服务冷启动先等实际工作面水合；业务保存与错误断言仍用默认等待。
  await expect(page.getByLabel('单据列表工具栏')).toBeVisible({ timeout: 30_000 })
  if (workspace === 'demo') {
    await expect(page.getByRole('button', { name: '关闭测试数据', exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  const evidence = await readFinanceReadonlySource(page, workspace)
  expect(evidence.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  return evidence
}

const SOURCE_REASONS = {
  production: '财务正式持久来源尚未配置，不能借用浏览器旧库或开发实例保存。',
  demo: '当前为测试数据来源，不能使用正式财务记录或原提交；请恢复原来源后核对。',
} as const

async function expectFinanceSourceGate(page: Page, reason: string) {
  await expect(page.getByRole('region', { name: '财务来源待核实', exact: true })).toContainText(reason)
  await expect(page.getByRole('heading', { name: '选择付款业务类型' })).toHaveCount(0)
  const actions = page.getByRole('group', { name: '表单操作' })
  for (const name of ['保存草稿', '保存并新建', '保存并提交', '保存'])
    await expect(actions.getByRole('button', { name, exact: true })).toBeDisabled()
  await expect(actions.getByRole('button', { name: '取消', exact: true })).toBeEnabled()
  const confirmPayment = page.getByTestId('confirm-payment')
  if (await confirmPayment.count())
    await expect(confirmPayment).toBeDisabled()
}

// 本机写入的 5 项草稿、2 项报销原件与 2 项分摊/确认/撤回保护，
// 由 FinanceNativeFlows.test.ts 的真实 SFC + SQLite 五档浏览器用例承接。
// 本文件验中央收款、显式合成 Native 旧来源/演示来源的禁止借写门禁和实际路由布局。
test.describe('F3 中央收款、来源写入门禁与资金表单布局', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `f3-${randomUUID()}` })
    await page.clock.setFixedTime(new Date('2026-09-11T04:00:00.000Z'))
    const reset = await page.request.post('/api/testing/receipts/reset', {
      headers: { 'x-ruihang-test-reset': '1' },
      data: { scenario: 'ready', seed: true },
    })
    expect(reset.ok(), await reset.text()).toBe(true)
  })
  for (const form of FORM_ROUTES.filter(form => form.path === '/finance/receipt/new')) {
    test(`${form.title}：独立保存不完整草稿并回显`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const value = `F3-草稿-${form.path.split('/')[2]}`
      await page.goto(form.path)
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible({ timeout: 30_000 })
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

  for (const field of [
    { label: '收款日期', role: 'textbox', error: '请填写收款日期' },
    { label: '选择项目', role: 'combobox', error: '请选择项目' },
    { label: '选择项目主客户', role: 'combobox', error: '请选择付款方客户' },
    { label: '收款金额', role: 'textbox', error: '收款金额必须大于 0' },
  ] as const) {
    test(`收款提交按当前中央规则呈现必填错误：${field.label}`, async ({ page }) => {
      await page.goto('/finance/receipt/new')
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect(page.getByRole('alert', { name: '收款尚未确认保存' })).toBeVisible()
      await expect(page.getByRole(field.role, { name: field.label, exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText(field.error, { exact: true })).toBeVisible()
      await expect(page.getByRole('textbox', { name: '收款日期', exact: true })).toBeFocused()
    })
  }

  for (const workspace of ['production', 'demo'] as const) {
    for (const form of FORM_ROUTES.filter(form => form.path !== '/finance/receipt/new')) {
      test(`${form.title}：${workspace === 'demo' ? '演示来源' : '中央未配置且保留旧 production 来源'}阻止写入并保留输入与原始数据`, async ({ page }) => {
        test.setTimeout(90_000)
        const financePosts: string[] = []
        page.on('request', (request) => {
          if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/commands/finance'))
            financePosts.push(request.url())
        })
        const before = await prepareReadOnlyWorkspace(page, workspace)
        expect(before.schemaVersion).toBe(60)
        expect(before.records.current_transactions).toEqual([expect.objectContaining({
          id: 'legacy-finance-readonly',
          counterparty: '历史姓名原文',
          amount: 0,
          supplier_id: null,
          counterparty_name_snapshot: null,
        })])
        expect(before.records.file_refs).toEqual([expect.objectContaining({ id: 'legacy-finance-original', owner_type: 'current_transaction', owner_id: 'legacy-finance-readonly', file_size: 4 })])
        expect(before.records.file_payloads).toEqual([{ file_ref_id: 'legacy-finance-original', encoding: 'base64', content: Buffer.from([0, 10, 128, 255]).toString('base64') }])
        expect(before.records.operation_logs).toEqual([expect.objectContaining({ id: 'legacy-finance-audit', table_name: 'current_transactions', record_id: 'legacy-finance-readonly', operator: '历史经办人', after_data: '{"counterparty":"历史姓名原文","amount":0,"source":"Native旧来源，尚未迁入中央"}' })])
        await page.goto(form.path)
        await expectFinanceSourceGate(page, SOURCE_REASONS[workspace])
        await expect(page.getByRole('heading', { name: form.title })).toBeVisible()
        const value = `保留输入-${workspace}-${form.path.split('/')[2]}`
        const field = page.locator(form.field)
        await field.fill(value)
        await field.press('Enter')
        await expectFinanceSourceGate(page, SOURCE_REASONS[workspace])
        await expect(page).toHaveURL(form.path)
        await expect(field).toHaveValue(value)
        expect(financePosts).toEqual([])
        expect(await readFinanceReadonlySource(page, workspace)).toEqual(before)
      })
    }
  }

  for (const width of [...RESPONSIVE_WIDTHS, 1280].sort((a, b) => a - b)) {
    for (const form of FORM_ROUTES) {
      test(`${form.title} @ ${width}px：无页面级横向溢出`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await page.goto(form.path)
        if (form.path === '/finance/payment/new')
          await expectFinanceSourceGate(page, SOURCE_REASONS.production)
        await expect(page.getByRole('heading', { name: form.title })).toBeVisible()
        await expectNoPageOverflow(page, `${form.path} @ ${width}px`)
      })
    }
  }
})
