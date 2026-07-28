import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const ROUTES = [
  ['/owner/change/new', '新建 · 甲方变洽签'],
  ['/owner/report/new', '新建 · 甲方报量'],
  ['/owner/acceptance/new', '新建 · 竣工验收·保修'],
  ['/owner/final-settlement/new', '新建 · 最终结算'],
  ['/owner/penalty/new', '新建 · 甲方罚扣单'],
  ['/subcontract/change/new', '新建 · 分包变洽签'],
  ['/subcontract/settlement/new', '新建 · 分包结算'],
  ['/project/penalty/new', '新建 · 项目罚扣'],
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

test.describe('F5 甲方与分包整页表单', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`八类表单在 ${width}px 视口可达且无页面级横向溢出`, async ({ page }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      for (const [path, title] of ROUTES) {
        await page.goto(path)
        await expect(page.getByRole('heading', { name: title })).toBeVisible({
          timeout: 60_000,
        })
        await expectNoPageOverflow(page, `${path} @ ${width}px`)
      }
    })
  }

  test('甲方量价变更复用真实 BOQ，附件随单提交并完成签证锁定', async ({ page }) => {
    test.setTimeout(120_000)
    const suffix = Date.now()
    const name = `E2E现场签证-${suffix}`

    await page.goto('/owner/change/new')
    await expect(page.getByRole('heading', { name: '新建 · 甲方变洽签' })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByTestId('owner-document-name').fill(name)
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await chooseLookup(page, '检索施工合同', '合和新城施工', '合和新城施工总承包合同')
    await page.getByTestId('owner-document-reason').fill('E2E 现场范围增加')
    await page.getByTestId('owner-document-add-line').click()

    const boqSelect = page.getByLabel('合同清单项').first()
    await expect(boqSelect.locator('option')).toHaveCount(11)
    const boqLineId = await boqSelect.locator('option').nth(4).getAttribute('value')
    expect(boqLineId).toBeTruthy()
    await boqSelect.selectOption(boqLineId!)
    await page.getByLabel('变更量').fill('2')
    await expect(page.getByText('合计 ¥520.00', { exact: false })).toBeVisible()

    await page.locator('#section-attachments input[type="file"]').setInputFiles({
      name: 'e2e-owner-visa.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('owner-visa-e2e'),
    })
    const closeAfterSave = page.getByRole('checkbox', { name: '【保存】后关闭' })
    if (await closeAfterSave.isChecked())
      await closeAfterSave.uncheck()
    await page.getByRole('button', { name: '保存并上报' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '上报', exact: true }).click()

    await expect(page).toHaveURL(/\/owner\/change\/[^/?]+$/)
    await expect(page.getByText('已提交', { exact: true })).toBeVisible()
    await expect(page.locator('#section-attachments').getByText('e2e-owner-visa.pdf', { exact: true }))
      .toBeVisible()

    await page.getByRole('button', { name: '确认签证' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder(name).fill(name)
    await dialog.getByRole('button', { name: '确认签证', exact: true }).click()
    await expect(page.getByText('已签证', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('收入变更台账已锁定', { exact: false })).toBeVisible()
  })
})
