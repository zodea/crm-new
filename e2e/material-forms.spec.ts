import type { Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const MATERIAL_FORM_ROUTES = [
  {
    path: '/material/requisition/new',
    title: '新建 · 下料单',
    editUrl: /\/material\/requisition\/[^/?]+$/,
  },
  {
    path: '/material/arrival/new',
    title: '新建 · 材料到货',
    editUrl: /\/material\/arrival\/[^/?]+$/,
  },
  {
    path: '/material/use/new',
    title: '新建 · 材料领用',
    editUrl: /\/material\/use\/[^/?]+$/,
  },
  {
    path: '/material/stock-check/new',
    title: '新建 · 库存盘点',
    editUrl: /\/material\/stock-check\/[^/?]+$/,
  },
  {
    path: '/owner-material/control/new',
    title: '新建 · 甲供材总控量',
    editUrl: /\/owner-material\/control\/[^/?]+$/,
  },
  {
    path: '/owner-material/requisition/new',
    title: '新建 · 甲供材下料单',
    editUrl: /\/owner-material\/requisition\/[^/?]+$/,
  },
  {
    path: '/owner-material/arrival/new',
    title: '新建 · 甲供材到货',
    editUrl: /\/owner-material\/arrival\/[^/?]+$/,
  },
  {
    path: '/owner-material/use/new',
    title: '新建 · 甲供材领用',
    editUrl: /\/owner-material\/use\/[^/?]+$/,
  },
  {
    path: '/owner-material/direct/new',
    title: '新建 · 甲供材直入直出',
    editUrl: /\/owner-material\/direct\/[^/?]+$/,
  },
] as const

const RESPONSIVE_ROUTES = [
  ...MATERIAL_FORM_ROUTES.map(route => ({
    path: route.path,
    title: route.title,
  })),
  {
    path: '/material/settlement/form',
    title: '新建 · 材料采购结算',
  },
  {
    path: '/material/delivery/archive/form/del_mdv001_0',
    title: /编辑 · 送货单归档/,
  },
  {
    path: '/material/delivery/archive/form',
    title: '新建 · 送货单归档',
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

async function confirmBusinessAction(page: Page, action: string) {
  const closeAfterSave = page.getByRole('checkbox', { name: '【保存】后关闭' })
  if (await closeAfterSave.isChecked())
    await closeAfterSave.uncheck()
  await page.getByRole('button', { name: `保存并${action}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: action, exact: true }).click()
}

async function openMaterialCreate(page: Page, listPath: string) {
  await page.locator(`a[href="${listPath}"]`).first().click()
  await expect(page).toHaveURL(listPath)
  await page.getByTestId('create-material-form').click()
  await expect(page).toHaveURL(`${listPath}/new`)
}

async function captureVisual(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_F4_VISUALS !== '1')
    return
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  })
}

test.describe('F4 物资领域整页表单', () => {
  test('九条物资表单与材料结算均可保存不完整草稿并进入真实编辑路由', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [index, form] of MATERIAL_FORM_ROUTES.entries()) {
      const no = `E2E-F4-DRAFT-${index}-${Date.now()}`
      await page.goto(form.path)
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
        timeout: 20_000,
      })
      await page.getByTestId('material-no').fill(no)
      await page.getByRole('button', { name: '保存草稿' }).click()
      await expect(page).toHaveURL(form.editUrl)
      await expect(page.getByTestId('material-no')).toHaveValue(no)
      await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
      await expectNoPageOverflow(page, form.path)
    }

    const settlementName = `E2E-F4-材料结算草稿-${Date.now()}`
    await page.goto('/material/settlement/form')
    await expect(page.getByRole('heading', { name: '新建 · 材料采购结算' })).toBeVisible()
    await page.getByTestId('settlement-name').fill(settlementName)
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/material\/settlement\/form\/[^/?]+$/)
    await expect(page.getByTestId('settlement-name')).toHaveValue(settlementName)
    await expectNoPageOverflow(page, '/material/settlement/form')
  })

  test('下料、到货、领用与盘点贯通真实库存，终态附件仍可删除恢复', async ({ page }) => {
    test.setTimeout(180_000)
    const suffix = Date.now()

    await page.goto('/material/requisition/new')
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await page.getByTestId('material-applicant').fill('E2E 计划员')
    await page.getByTestId('material-materialName').fill(`E2E瓷砖-${suffix}`)
    await page.getByTestId('material-spec').fill('600×600')
    await page.getByTestId('material-unit').fill('㎡')
    await page.getByTestId('material-plannedQty').fill('10')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-material-plan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('material-plan-e2e'),
    })
    await confirmBusinessAction(page, '提交')
    await expect(page).toHaveURL(/\/material\/requisition\/[^/?]+$/)
    await expect(page.getByText('已生效', { exact: true })).toBeVisible()
    const attachments = page.locator('#section-attachments')
    await expect(attachments.getByText('e2e-material-plan.pdf', { exact: true })).toBeVisible()
    await attachments.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '保存附件' }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toBeVisible()
    await attachments.getByRole('button', { name: '恢复' }).click()
    await page.getByRole('button', { name: '保存附件' }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toHaveCount(0)

    await openMaterialCreate(page, '/material/arrival')
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await chooseLookup(
      page,
      '检索分供方',
      '广州市大板东',
      '广州市大板东建材有限公司',
    )
    await page.getByLabel('材料名称').fill(`E2E瓷砖-${suffix}`)
    await page.getByLabel('规格型号').fill('600×600')
    await page.getByLabel('单位').fill('㎡')
    await page.getByLabel('到货数量').fill('5')
    await page.getByLabel('含税单价').fill('10')
    await expect(page.getByText('数量 5.000 · 含税金额 ¥50.00', { exact: true }))
      .toBeVisible()
    await confirmBusinessAction(page, '入库')
    await expect(page).not.toHaveURL('/material/arrival/new')
    await expect(page.getByRole('heading', { name: '编辑 · 材料到货' })).toBeVisible()
    await expect(page.getByLabel('材料名称')).toHaveValue(`E2E瓷砖-${suffix}`)
    await expect(page.getByLabel('规格型号')).toHaveValue('600×600')
    await expect(page.getByLabel('单位')).toHaveValue('㎡')
    await expect(page.getByLabel('到货数量')).toHaveValue('5')

    await openMaterialCreate(page, '/material/stock-check')
    await page.getByLabel('材料名称').fill(`E2E瓷砖-${suffix}`)
    await page.getByLabel('规格型号').fill('600×600')
    await page.getByLabel('单位').fill('㎡')
    await page.getByTestId('refresh-book-qty').click()
    await expect(page.getByText('5.000', { exact: true }).first()).toBeVisible()

    await openMaterialCreate(page, '/material/use')
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await page.getByTestId('material-materialName').fill(`E2E瓷砖-${suffix}`)
    await page.getByTestId('material-spec').fill('600×600')
    await page.getByTestId('material-unit').fill('㎡')
    await page.getByTestId('material-qty').fill('2')
    await page.getByTestId('material-receiver').fill('E2E 领料员')
    await confirmBusinessAction(page, '出库')
    await expect(page).not.toHaveURL('/material/use/new')
    await expect(page.getByRole('heading', { name: '编辑 · 材料领用' })).toBeVisible()

    await openMaterialCreate(page, '/material/stock-check')
    await page.getByTestId('material-checker').fill('E2E 盘点员')
    await page.getByLabel('材料名称').fill(`E2E瓷砖-${suffix}`)
    await page.getByLabel('规格型号').fill('600×600')
    await page.getByLabel('单位').fill('㎡')
    await page.getByTestId('refresh-book-qty').click()
    await expect(page.getByText('3.000', { exact: true }).first()).toBeVisible()
    await page.getByLabel('实盘量').fill('4')
    await page.getByLabel('盈亏金额').fill('10')
    await expect(page.getByText('1.000', { exact: true }).first()).toBeVisible()
    await confirmBusinessAction(page, '生效')
    await expect(page).not.toHaveURL('/material/stock-check/new')
    await expect(page.getByRole('heading', { name: '编辑 · 库存盘点' })).toBeVisible()
  })

  test('材料结算复用真实材采关系，送货单归档在整页表单中保留 OCR 留痕', async ({ page }) => {
    test.setTimeout(120_000)
    const suffix = Date.now()

    await page.goto('/material/settlement/form')
    await page.getByTestId('settlement-name').fill(`E2E材料结算-${suffix}`)
    await chooseLookup(page, '检索项目', '合和新城', '合和新城')
    await chooseLookup(page, '检索材料采购合同', '瓷砖采购合同', '瓷砖采购合同')
    await page.getByTestId('settlement-amount').fill('100')
    await page.getByLabel('结算日期 *').fill('2026-07-26')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/material\/settlement\/form\/[^/?]+$/)
    await expect(page.getByText('审批中', { exact: true }).first()).toBeVisible()

    await page.goto('/material/delivery/archive/del_mdv001_0')
    await page.getByRole('link', { name: '编辑' }).click()
    await expect(page).toHaveURL('/material/delivery/archive/form/del_mdv001_0')
    await expect(page.getByRole('heading', { name: /编辑 · 送货单归档/ })).toBeVisible()
    await expect(page.getByText('大板东建材-送货单-0712.pdf', { exact: true })).toBeVisible()
    await expect(page.getByText('合和新城', { exact: true }).last()).toBeVisible()
    await page.getByLabel('送货单号').fill(`E2E-SH-${suffix}`)
    await page.getByLabel('数量').first().fill('3')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存归档修改' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认修改' }).click()
    await expect(page.getByLabel('送货单号')).toHaveValue(`E2E-SH-${suffix}`)
    await expect(page.getByText('大板东建材-送货单-0712.pdf', { exact: true })).toBeVisible()
  })

  test('十二条整页表单在响应式验收矩阵中无页面级横向溢出', async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      for (const route of RESPONSIVE_ROUTES) {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { name: route.title })).toBeVisible({
          timeout: 20_000,
        })
        await expectNoPageOverflow(page, `${route.path} @ ${width}px`)
      }
      await page.goto('/material/arrival/new')
      await expect(page.getByRole('heading', { name: '新建 · 材料到货' })).toBeVisible()
      await captureVisual(page, testInfo, `material-arrival-${width}`)
    }
  })
})
