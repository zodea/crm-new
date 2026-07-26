import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const FORM_ROUTES = [
  {
    path: '/contract/construction/form',
    title: '新建 · 施工合同',
    field: '[data-testid="contract-name"]',
    editUrl: /\/contract\/construction\/form\/[^/?]+$/,
  },
  {
    path: '/contract/subcontract/form',
    title: '新建 · 分包合同',
    field: '[data-testid="contract-name"]',
    editUrl: /\/contract\/subcontract\/form\/[^/?]+$/,
  },
  {
    path: '/contract/material/form',
    title: '新建 · 材料采购合同',
    field: '[data-testid="contract-name"]',
    editUrl: /\/contract\/material\/form\/[^/?]+$/,
  },
  {
    path: '/contract/other-expense/form',
    title: '新建 · 其他支出合同',
    field: '[data-testid="contract-name"]',
    editUrl: /\/contract\/other-expense\/form\/[^/?]+$/,
  },
  {
    path: '/contract/company-expense/form',
    title: '新建 · 公司支出合同',
    field: '[data-testid="company-contract-name"]',
    editUrl: /\/contract\/company-expense\/form\/[^/?]+$/,
  },
  {
    path: '/contract/other-settlement/form',
    title: '新建 · 其他支出结算',
    field: '[data-testid="settlement-name"]',
    editUrl: /\/contract\/other-settlement\/form\/[^/?]+$/,
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

test.describe('F2 canonical 合同与支出结算整页表单', () => {
  test('六条命名路由均可保存不完整草稿并进入真实编辑路由', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [index, form] of FORM_ROUTES.entries()) {
      const name = `E2E-F2-${index}-${Date.now()}`
      await page.goto(form.path)
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button')).toHaveCount(5)

      await page.locator(form.field).fill(name)
      await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
      await page.getByRole('group', { name: '表单操作' })
        .getByRole('button', { name: '保存草稿' })
        .click()

      await expect(page).toHaveURL(form.editUrl)
      await expect(page.locator(form.field)).toHaveValue(name, { timeout: 20_000 })
      await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
      await expectNoPageOverflow(page, form.path)
    }
  })

  test('材采明细新增、复制、删除与派生合计在真实页面成立', async ({ page }) => {
    await page.goto('/contract/material/form')
    await page.getByTestId('add-contract-line').click()
    await page.getByTestId('contract-line-name-0').fill('E2E瓷砖')
    await page.getByTestId('contract-line-qty-0').fill('3')
    await page.getByTestId('contract-line-price-0').fill('12.5')
    await expect(page.getByText('37.50', { exact: true })).toHaveCount(3)

    await page.getByRole('button', { name: '复制明细' }).click()
    await expect(page.getByTestId('contract-line-name-1')).toHaveValue('E2E瓷砖')
    await page.getByRole('button', { name: '删除明细' }).first().click()
    await expect(page.getByTestId('contract-line-name-0')).toHaveValue('E2E瓷砖')
    await expect(page.getByTestId('contract-line-name-1')).toHaveCount(0)

    await page.getByTestId('import-contract-lines').click()
    await page.getByTestId('contract-lines-tsv').fill(
      '砂浆\tM10\t品牌A\t包\t2\t15\t2026-08-01\tTSV导入',
    )
    await page.getByTestId('confirm-contract-lines-import').click()
    await expect(page.getByTestId('contract-line-name-1')).toHaveValue('砂浆')
    await expect(page.getByText('67.50', { exact: true })).toHaveCount(2)
  })

  test('保存并新建会在同一页可靠重置为空表单', async ({ page }) => {
    await page.goto('/contract/company-expense/form')
    await page.getByTestId('company-contract-name').fill(`E2E保存并新建-${Date.now()}`)
    await page.getByLabel('对方单位 *').fill('E2E服务商')
    await page.getByLabel('签订日期 *').fill('2026-07-25')
    await page.getByRole('button', { name: '保存并新建' }).click()
    await expect(page).toHaveURL('/contract/company-expense/form')
    await expect(page.getByTestId('company-contract-name')).toHaveValue('')
    await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
  })

  test('真实 lookup、提交、附件删除恢复与其他支出结算链路成立', async ({ page }) => {
    test.setTimeout(120_000)
    const suffix = Date.now()
    const constructionName = `E2E施工提交-${suffix}`
    await page.goto('/contract/construction/form')
    await page.getByTestId('contract-name').fill(constructionName)
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await chooseLookup(page, '检索客户', '合和地产集团', '合和地产集团')
    await page.getByTestId('contract-content').fill('E2E 施工内容')
    await page.getByTestId('contract-sign-date').fill('2026-07-25')
    await page.getByTestId('contract-amount').fill('100')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-contract.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('contract-e2e'),
    })
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/contract\/construction\/form\/[^/?]+$/)
    await expect(page.getByText('审批中', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('e2e-contract.pdf', { exact: true })).toBeVisible()

    const attachments = page.locator('#section-attachments')
    await attachments.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toBeVisible()
    await attachments.getByRole('button', { name: '恢复' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toHaveCount(0)

    const expenseName = `E2E其他支出-${suffix}`
    await page.goto('/contract/other-expense/form')
    await page.getByTestId('contract-name').fill(expenseName)
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await chooseLookup(page, '检索分供方', '广州市大板东', '广州市大板东建材有限公司')
    await page.getByTestId('contract-content').fill('E2E 租赁服务')
    await page.getByTestId('contract-sign-date').fill('2026-07-25')
    await page.getByTestId('contract-amount').fill('80')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/contract\/other-expense\/form\/[^/?]+$/)

    await page.locator('a[href="/contract/other-settlement"]').click()
    await page.getByTestId('create-aux-contract').click()
    await page.getByTestId('settlement-name').fill(`E2E结算-${suffix}`)
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await chooseLookup(page, '检索其他支出合同', expenseName, expenseName)
    await page.getByTestId('settlement-amount').fill('60')
    await page.getByLabel('结算日期 *').fill('2026-07-25')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/contract\/other-settlement\/form\/[^/?]+$/)
    await expect(page.getByText('审批中', { exact: true }).first()).toBeVisible()
  })

  test('六条表单在响应式参考矩阵均无页面级横向溢出', async ({ page }) => {
    test.setTimeout(120_000)
    for (const width of RESPONSIVE_WIDTHS.slice(1)) {
      await page.setViewportSize({ width, height: 900 })
      for (const form of FORM_ROUTES) {
        await page.goto(form.path)
        await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
          timeout: 20_000,
        })
        await expectNoPageOverflow(page, `${form.path} @ ${width}px`)
      }
    }
  })
})
