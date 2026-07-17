import { expect, test } from '@playwright/test'

const SUPPLIER_NAME = '穗建五金机电经营部'
const CREDENTIAL_FILE = 'E2E开户许可证.pdf'

test('分供方详情：6 Tab 实时汇总、证照软删除撤回与列表双页联动', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/base/supplier')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('搜索公司名、税号、简称…').fill(SUPPLIER_NAME)
  await page.getByRole('link', { name: SUPPLIER_NAME, exact: true }).click()
  await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004$/)

  const supplierHeader = page.locator('header.panel')
  const detailTabs = page.getByRole('navigation', { name: '分供方详情分类' })
  await expect(detailTabs.getByRole('tab')).toHaveCount(6)
  await expect(detailTabs.getByRole('tab', { name: '详细资料', exact: true })).toHaveAttribute('aria-selected', 'true')

  const summary = page.getByTestId('supplier-summary')
  await expect(summary).toContainText('合作项目1 个')
  await expect(summary).toContainText('合同总额¥261,250.00')
  await expect(summary).toContainText('累计请款¥121,139.00')
  await expect(summary).toContainText('累计收票¥12,380.00')
  await expect(summary).toContainText('累计已付¥101,138.00')
  await expect(summary).toContainText('应付余额¥160,112.00')

  await detailTabs.getByRole('tab', { name: '合作项目 (1)', exact: true }).click()
  await expect(page.getByRole('link', { name: '锦绣华庭', exact: true }))
    .toHaveAttribute('href', '/project/proj_demo_002/supplier/sup_demo_004')
  await expect(page.getByRole('cell', { name: '¥230,000.00', exact: true })).toBeVisible()
  await expect(page.getByText('按 ProjectSupplier 关系聚合 1 个合作项目；合同额来自合同台账，实际付款来自付款申请。', { exact: true })).toBeVisible()

  await detailTabs.getByRole('tab', { name: '合同汇总 (3)', exact: true }).click()
  await expect(page.getByRole('link', { name: '五金机电采购合同', exact: true })).toBeVisible()
  await expect(page.getByLabel('筛选合同类型')).toBeVisible()

  await detailTabs.getByRole('tab', { name: '请款/付款汇总 (2)', exact: true }).click()
  await expect(page.getByRole('cell', { name: '五金机电采购首期请款', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '实际付款', exact: true })).toBeVisible()
  await expect(page.getByText('来源：付款申请表实时汇总；付款申请详情页尚未建设，当前只读。', { exact: true })).toBeVisible()

  await detailTabs.getByRole('tab', { name: '收票汇总 (1)', exact: true }).click()
  await expect(page.getByRole('link', { name: '09442026000058702', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '¥12,380.00', exact: true })).toBeVisible()

  await detailTabs.getByRole('tab', { name: '证照附件 (2)', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('缺失必需证照：银行开户许可证')
  await page.getByRole('button', { name: '添加证照', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '添加证照' })
  await dialog.getByRole('combobox').selectOption('银行开户许可证')
  await dialog.getByPlaceholder('如：营业执照-大板东.pdf').fill(CREDENTIAL_FILE)
  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  await expect(supplierHeader.getByText('合格', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `预览证照 ${CREDENTIAL_FILE}`, exact: true })).toBeVisible()
  await expect(detailTabs.getByRole('tab', { name: '证照附件 (3)', exact: true })).toBeVisible()

  await page.getByRole('button', { name: `删除证照 ${CREDENTIAL_FILE}`, exact: true }).click()
  dialog = page.getByRole('dialog', { name: '删除证照' })
  await expect(dialog).toContainText(`确认删除「${CREDENTIAL_FILE}」`)
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(supplierHeader.getByText('资料缺失', { exact: true })).toBeVisible()
  await expect(detailTabs.getByRole('tab', { name: '证照附件 (2)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '撤回', exact: true }).click()
  await expect(supplierHeader.getByText('合格', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `预览证照 ${CREDENTIAL_FILE}`, exact: true })).toBeVisible()

  await supplierHeader.getByRole('button', { name: '编辑', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '编辑分供方' })
  await dialog.getByLabel('主要联系人', { exact: true }).fill('E2E周经理')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(supplierHeader).toContainText('联系人 E2E周经理')

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  await tabBar.getByRole('button', { name: '分供方', exact: true }).click()
  await page.getByRole('button', { name: '编辑分供方', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '编辑分供方' })
  await expect(dialog.getByLabel('主要联系人', { exact: true })).toHaveValue('E2E周经理')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()

  expect(pageErrors, '分供方详情旅程不应产生客户端运行错误').toEqual([])
})
