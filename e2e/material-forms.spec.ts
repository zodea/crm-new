import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import {
  installMaterialProductionFixture,
} from './helpers/material-production-fixture'
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

const fixtures = new WeakMap<Page, Awaited<ReturnType<typeof installMaterialProductionFixture>>>()

function responsiveRoutes(fixture: Awaited<ReturnType<typeof installMaterialProductionFixture>>) {
  return [
    ...MATERIAL_FORM_ROUTES.map(route => ({
      path: route.path,
      title: route.title,
    })),
    {
      path: '/material/settlement/form',
      title: '新建 · 材料采购结算',
    },
    {
      path: `/material/delivery/archive/form/${fixture.deliveryId}?origin=real`,
      title: /编辑 · 送货单归档/,
    },
    {
      path: '/material/delivery/archive/form',
      title: '新建 · 送货单归档',
    },
  ] as const
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

test.describe('F4 物资领域整页表单', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000)
    fixtures.set(page, await installMaterialProductionFixture(page, { legacyMaterial: true }))
    await page.clock.install({ time: new Date('2026-08-06T04:00:00.000Z') })
  })

  test('九条物资表单与材料结算均可保存不完整草稿并进入真实编辑路由', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [index, form] of MATERIAL_FORM_ROUTES.entries()) {
      const no = `E2E-F4-DRAFT-${index}`
      await page.goto(form.path)
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
        timeout: 20_000,
      })
      await page.getByTestId('material-no').fill(no)
      await page.getByRole('button', { name: '保存草稿' }).click()
      await expect(page).toHaveURL(url => form.editUrl.test(url.pathname) && url.pathname !== form.path)
      await expect(page.getByRole('heading', { name: form.title.replace('新建', '编辑'), exact: true })).toBeVisible()
      await expect(page.getByTestId('material-no')).toHaveValue(no)
      await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
      await page.reload()
      await expect(page.getByRole('heading', { name: form.title.replace('新建', '编辑'), exact: true })).toBeVisible()
      await expect(page.getByTestId('material-no')).toHaveValue(no)
      await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
      await expectNoPageOverflow(page, form.path)
    }

    const settlementName = 'E2E-F4-材料结算草稿'
    await page.goto('/material/settlement/form')
    await expect(page.getByRole('heading', { name: '新建 · 材料采购结算' })).toBeVisible()
    await page.getByTestId('settlement-name').fill(settlementName)
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/material\/settlement\/form\/[^/?]+$/)
    await expect(page.getByTestId('settlement-name')).toHaveValue(settlementName)
    await expectNoPageOverflow(page, '/material/settlement/form')
  })

  for (const quantity of [
    { name: '整数数量', planned: '10', arrived: '5', price: '10', arrivalSummary: '数量 5.000 · 含税金额 ¥50.00', arrivalStock: '5.000', used: '2', remaining: '3.000', actual: '4', variance: '1.000', amount: '10' },
    { name: '小数数量', planned: '0.75', arrived: '0.5', price: '12.5', arrivalSummary: '数量 0.500 · 含税金额 ¥6.25', arrivalStock: '0.500', used: '0.25', remaining: '0.250', actual: '0.3', variance: '0.050', amount: '0.63' },
  ]) {
    test(`下料、到货、领用与盘点贯通真实库存，终态附件可删除恢复：${quantity.name}`, async ({ page }) => {
      test.setTimeout(180_000)
      const fixture = fixtures.get(page)!
      const suffix = quantity.name

      await page.goto('/material/requisition/new')
      await chooseLookup(
        page,
        '检索项目',
        fixture.projectName,
        fixture.projectName,
      )
      await page.getByTestId('material-applicant').fill('E2E 计划员')
      await page.getByTestId('material-materialName').fill(`E2E瓷砖-${suffix}`)
      await page.getByTestId('material-spec').fill('600×600')
      await page.getByTestId('material-unit').fill('㎡')
      await page.getByTestId('material-plannedQty').fill(quantity.planned)
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
      await chooseLookup(
        page,
        '检索项目',
        fixture.projectName,
        fixture.projectName,
      )
      await chooseLookup(
        page,
        '检索分供方',
        fixture.supplierName,
        fixture.supplierName,
      )
      await page.getByLabel('材料名称').fill(`E2E瓷砖-${suffix}`)
      await page.getByLabel('规格型号').fill('600×600')
      await page.getByLabel('单位').fill('㎡')
      await page.getByLabel('到货数量').fill(quantity.arrived)
      await page.getByLabel('含税单价').fill(quantity.price)
      await expect(page.getByText(quantity.arrivalSummary, { exact: true }))
        .toBeVisible()
      await confirmBusinessAction(page, '入库')
      await expect(page).not.toHaveURL('/material/arrival/new')
      await expect(page.getByRole('heading', { name: '编辑 · 材料到货' })).toBeVisible()
      await expect(page.getByLabel('材料名称')).toHaveValue(`E2E瓷砖-${suffix}`)
      await expect(page.getByLabel('规格型号')).toHaveValue('600×600')
      await expect(page.getByLabel('单位')).toHaveValue('㎡')
      await expect(page.getByLabel('到货数量')).toHaveValue(quantity.arrived)

      await openMaterialCreate(page, '/material/stock-check')
      await page.getByLabel('材料名称').fill(`E2E瓷砖-${suffix}`)
      await page.getByLabel('规格型号').fill('600×600')
      await page.getByLabel('单位').fill('㎡')
      await page.getByTestId('refresh-book-qty').click()
      await expect(page.getByText(quantity.arrivalStock, { exact: true }).first()).toBeVisible()

      await openMaterialCreate(page, '/material/use')
      await chooseLookup(
        page,
        '检索项目',
        fixture.projectName,
        fixture.projectName,
      )
      await page.getByTestId('material-materialName').fill(`E2E瓷砖-${suffix}`)
      await page.getByTestId('material-spec').fill('600×600')
      await page.getByTestId('material-unit').fill('㎡')
      await page.getByTestId('material-qty').fill(quantity.used)
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
      await expect(page.getByText(quantity.remaining, { exact: true }).first()).toBeVisible()
      await page.getByLabel('实盘量').fill(quantity.actual)
      await page.getByLabel('盈亏金额').fill(quantity.amount)
      await expect(page.getByText(quantity.variance, { exact: true }).first()).toBeVisible()
      await confirmBusinessAction(page, '生效')
      await expect(page).not.toHaveURL('/material/stock-check/new')
      await expect(page.getByRole('heading', { name: '编辑 · 库存盘点' })).toBeVisible()
    })
  }

  test('材料结算复用真实材采关系，送货单归档在整页表单中保留 OCR 留痕', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = fixtures.get(page)!
    const suffix = '原件留痕'

    await page.goto('/material/settlement/form')
    await page.getByTestId('settlement-name').fill(`E2E材料结算-${suffix}`)
    await chooseLookup(
      page,
      '检索项目',
      fixture.projectName,
      fixture.projectName,
    )
    await chooseLookup(
      page,
      '检索材料采购合同',
      fixture.contractName,
      fixture.contractName,
    )
    await page.getByTestId('settlement-amount').fill('100')
    await page.getByLabel('结算日期 *').fill('2026-08-06')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/material\/settlement\/form\/[^/?]+$/)
    await expect(page.getByText('待确认', { exact: true }).first()).toBeVisible()

    await page.goto(`/material/delivery/archive/${fixture.deliveryId}?origin=real`)
    await page.getByRole('link', { name: '编辑' }).click()
    await expect(page).toHaveURL(
      `/material/delivery/archive/form/${fixture.deliveryId}?origin=real`,
    )
    await expect(page.getByRole('heading', { name: /编辑 · 送货单归档/ })).toBeVisible()
    const sourcePanel = page.getByTestId('delivery-source-panel')
    await expect(sourcePanel.getByText(fixture.deliverySourceName, { exact: true }))
      .toBeVisible()
    await expect(page.getByLabel('检索项目'))
      .toHaveValue(fixture.projectName)
    await page.getByLabel('送货单号').fill(`E2E-SH-${suffix}`)
    await page.getByLabel('数量').first().fill('3')
    await page.getByLabel('修订原因 *', { exact: true }).fill('复核原件后调整送货单号')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存归档修改' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认修改' }).click()
    await expect(page.getByLabel('送货单号')).toHaveValue(`E2E-SH-${suffix}`)
    await expect(sourcePanel.getByText(fixture.deliverySourceName, { exact: true }))
      .toBeVisible()
  })

  for (const group of [0, 1, 2, 3]) {
    test(`整页表单在各宽度无页面级横向溢出：第 ${group + 1} 组`, async ({ page }) => {
      test.setTimeout(90_000)
      const fixture = fixtures.get(page)!
      for (const route of responsiveRoutes(fixture).slice(group * 3, group * 3 + 3)) {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { name: route.title })).toBeVisible({
          timeout: 20_000,
        })
        await expect(page.getByRole('group', { name: '表单操作', exact: true })).toBeVisible()
        for (const width of RESPONSIVE_WIDTHS) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await expectNoPageOverflow(page, `${route.path} @ ${width}px`)
        }
      }
      await page.goto('/material/arrival/new')
      await expect(page.getByRole('heading', { name: '新建 · 材料到货' })).toBeVisible()
    })
  }
})
