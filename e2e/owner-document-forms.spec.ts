import type { Locator, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import {
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
  tabUntilFocused,
} from './helpers/responsive'

const DOCUMENTS = [
  { listPath: '/owner/change', newPath: '/owner/change/new', title: '甲方变洽签', typeLabel: '类型' },
  { listPath: '/owner/report', newPath: '/owner/report/new', title: '甲方报量', typeLabel: null },
  { listPath: '/owner/acceptance', newPath: '/owner/acceptance/new', title: '竣工验收·保修', typeLabel: '类型' },
  { listPath: '/owner/final-settlement', newPath: '/owner/final-settlement/new', title: '最终结算', typeLabel: null },
  { listPath: '/owner/penalty', newPath: '/owner/penalty/new', title: '甲方罚扣单', typeLabel: null },
  { listPath: '/subcontract/change', newPath: '/subcontract/change/new', title: '分包变洽签', typeLabel: '类型' },
  { listPath: '/subcontract/settlement', newPath: '/subcontract/settlement/new', title: '分包结算', typeLabel: '结算类型' },
  { listPath: '/project/penalty', newPath: '/project/penalty/new', title: '项目罚扣', typeLabel: null },
] as const

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

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

async function chooseFilter(page: Page, trigger: Locator, option: string) {
  await trigger.click()
  await page.getByRole('option', { name: new RegExp(option) }).click()
}

test.describe('Issue #197：甲方、分包单据与项目罚扣', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`八类列表和表单在 ${width}px 使用真实标题且无页面级横向溢出`, async ({ page }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })

      for (const document of DOCUMENTS) {
        await page.goto(document.listPath)
        const toolbar = page.locator('[data-ui="owner-document-list-toolbar"]')
        await expect(toolbar.getByRole('heading', { name: document.title, exact: true }))
          .toBeVisible({ timeout: 60_000 })
        await expect(toolbar.getByRole('searchbox')).toBeVisible()
        await expect(toolbar.getByRole('combobox', { name: '项目' })).toBeVisible()
        await expect(toolbar.getByRole('combobox', { name: '状态' })).toBeVisible()
        if (document.typeLabel)
          await expect(toolbar.getByRole('combobox', { name: document.typeLabel })).toBeVisible()
        else
          await expect(toolbar.getByRole('combobox', { name: '类型' })).toHaveCount(0)
        await expect(toolbar.getByRole('button', { name: `新建${document.title}` })).toBeVisible()
        await expectNoPageOverflow(page, `${document.listPath} @ ${width}px`)

        await page.goto(document.newPath)
        await expect(page.getByRole('heading', { name: `新建 · ${document.title}`, exact: true })).toBeVisible({
          timeout: 60_000,
        })
        await expectNoPageOverflow(page, `${document.newPath} @ ${width}px`)
      }
    })
  }

  test('来源 query 可见且可单独清除，状态筛选和无结果空态可恢复', async ({ page }) => {
    await page.goto('/owner/change?project=proj_demo_001&contract=con_demo_sg01')

    const context = page.locator('[data-ui="owner-document-route-context"]')
    await expect(context).toBeVisible({ timeout: 30_000 })
    await expect(context).toContainText('项目：合和新城')
    await expect(context).toContainText('合同：合和新城施工总承包合同')
    await expect(context.getByRole('button')).toHaveCount(2)

    await context.getByRole('button', { name: /清除项目：合和新城筛选/ }).click()
    await expect(page).not.toHaveURL(/project=/)
    await expect(page).toHaveURL(/contract=con_demo_sg01/)

    const toolbar = page.locator('[data-ui="owner-document-list-toolbar"]')
    const status = toolbar.getByRole('combobox', { name: '状态' })
    await chooseFilter(page, status, '草稿')
    await expect(page.getByRole('status', { name: '没有符合条件的甲方变洽签' }))
      .toBeVisible()
    await chooseFilter(page, status, '已签证')
    await expect(page.getByText('厨房墙砖工程量调整', { exact: true })).toBeVisible()

    const search = toolbar.getByRole('searchbox')
    await search.fill(`不存在的甲方变更-${Date.now()}`)
    const filteredEmpty = page.getByRole('status', { name: '没有符合条件的甲方变洽签' })
    await expect(filteredEmpty).toBeVisible()
    await filteredEmpty.getByRole('button', { name: '清除筛选' }).click()
    await expect(search).toHaveValue('')
    await expect(status).toContainText('已签证')
  })

  test('键盘可进入新建页，提交错误聚焦首个无效字段', async ({ page }) => {
    await page.goto('/owner/change')
    const toolbar = page.locator('[data-ui="owner-document-list-toolbar"]')
    const search = toolbar.getByRole('searchbox')
    const create = toolbar.getByRole('button', { name: '新建甲方变洽签' })
    await search.focus()
    await tabUntilFocused(page, create)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/owner\/change\/new$/)

    const submit = page.getByRole('button', { name: '保存并上报' })
    await submit.focus()
    await page.keyboard.press('Enter')

    const firstInvalid = page.locator('form [aria-invalid="true"]').first()
    await expect(firstInvalid).toBeVisible()
    await expect(firstInvalid).toBeFocused()
    await expect(page.getByText('变更名称为必填项', { exact: true })).toBeVisible()
  })

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
    await expect(page.getByText('已上报', { exact: true })).toBeVisible()
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
