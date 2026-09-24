import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

const OWNER_MATERIAL_ROUTES = [
  {
    kind: 'control',
    path: '/owner-material/control/new',
    title: '新建 · 甲供材总控量',
  },
  {
    kind: 'requisition',
    path: '/owner-material/requisition/new',
    title: '新建 · 甲供材下料单',
  },
  {
    kind: 'arrival',
    path: '/owner-material/arrival/new',
    title: '新建 · 甲供材到货',
  },
  {
    kind: 'use',
    path: '/owner-material/use/new',
    title: '新建 · 甲供材领用',
  },
  {
    kind: 'direct',
    path: '/owner-material/direct/new',
    title: '新建 · 甲供材直入直出',
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
  await expect(page.getByRole('dialog')).toBeHidden()
}

async function chooseProject(page: Page) {
  await chooseLookup(page, '检索项目', '合和新城', '合和新城')
}

async function chooseOwnerCustomer(page: Page, name = '合和地产集团') {
  await chooseLookup(page, '检索甲供单位', name, name)
}

async function expectOwnerPageContract(page: Page, kind: string) {
  await expect(page.locator(`[data-owner-material-kind="${kind}"]`)).toHaveCount(1)
  await expect(page.getByLabel('检索分供方')).toHaveCount(0)
  await expect(page.getByLabel('检索采购合同')).toHaveCount(0)
  await expect(page.getByText('含税单价', { exact: true })).toHaveCount(0)
  await expect(page.getByText('付款对象', { exact: true })).toHaveCount(0)
}

test.describe('Issue #200 甲供材页面', () => {
  for (const width of [390, 768, 1024, 1440]) {
    for (const route of OWNER_MATERIAL_ROUTES) {
      test(`${route.title} @ ${width}px 可运行并保持甲供边界`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await page.goto(route.path)
        await expect(page.getByRole('heading', { name: route.title })).toBeVisible({ timeout: 20_000 })
        await expectOwnerPageContract(page, route.kind)
        await expectNoPageOverflow(page, `${route.path} @ ${width}px`)
      })
    }
  }

  test('总控、下料、到货、领用与直入直出按真实甲方关系贯通派生量', async ({ page }) => {
    test.setTimeout(180_000)
    const suffix = Date.now()
    const material = `E2E甲供材-${suffix}`

    await page.goto('/owner-material/control/new')
    await chooseProject(page)
    await chooseOwnerCustomer(page)
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-spec').fill('1000×2100')
    await page.getByTestId('material-unit').fill('樘')
    await page.getByTestId('material-controlQty').fill('10')
    await expect(page.getByTestId('material-arrivedQty')).toHaveText('0')
    await expect(page.getByTestId('material-usedQty')).toHaveText('0')
    await expect(page.getByTestId('material-remainingQty')).toHaveText('0')
    await confirmBusinessAction(page, '生效')
    await expect(page).not.toHaveURL(/\/owner-material\/control\/new$/)
    await expect(page).toHaveURL(/\/owner-material\/control\/[^/?]+$/)
    const controlId = page.url().split('/').pop()
    await expect(page.getByText('已生效', { exact: true })).toBeVisible()
    await expect(page.getByTestId('material-remainingQty')).toHaveText('10')

    await page.goto('/owner-material/requisition/new')
    await chooseProject(page)
    await page.getByTestId('material-applicant').fill('E2E 甲供计划员')
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-spec').fill('1000×2100')
    await page.getByTestId('material-unit').fill('樘')
    await page.getByTestId('material-plannedQty').fill('8')
    await confirmBusinessAction(page, '提交')
    await expect(page).not.toHaveURL(/\/owner-material\/requisition\/new$/)
    await expect(page).toHaveURL(/\/owner-material\/requisition\/[^/?]+$/)
    await expect(page.getByText('已生效', { exact: true })).toBeVisible()

    await page.goto('/owner-material/arrival/new')
    await chooseProject(page)
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-spec').fill('1000×2100')
    await page.getByTestId('material-unit').fill('樘')
    await page.getByTestId('material-qty').fill('6')
    await expect(page.getByTestId('material-stockStatus')).toHaveText('待入库')
    await confirmBusinessAction(page, '入库')
    await expect(page).not.toHaveURL(/\/owner-material\/arrival\/new$/)
    await expect(page).toHaveURL(/\/owner-material\/arrival\/[^/?]+$/)
    await expect(page.getByTestId('material-stockStatus')).toHaveText('已入库')

    await page.goto('/owner-material/use/new')
    await chooseProject(page)
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-unit').fill('樘')
    await page.getByTestId('material-qty').fill('2')
    await page.getByTestId('material-receiver').fill('E2E 甲供领料员')
    await confirmBusinessAction(page, '出库')
    await expect(page).not.toHaveURL(/\/owner-material\/use\/new$/)
    await expect(page).toHaveURL(/\/owner-material\/use\/[^/?]+$/)
    await expect(page.getByText('已生效', { exact: true })).toBeVisible()

    await page.goto('/owner-material/direct/new')
    await chooseProject(page)
    await chooseOwnerCustomer(page)
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-unit').fill('樘')
    await page.getByTestId('material-qty').fill('1')
    await page.getByTestId('material-useLocation').fill('二层')
    await confirmBusinessAction(page, '确认')
    await expect(page).not.toHaveURL(/\/owner-material\/direct\/new$/)
    await expect(page).toHaveURL(/\/owner-material\/direct\/[^/?]+$/)
    await expect(page.getByText('已生效', { exact: true })).toBeVisible()

    await page.goto(`/owner-material/control/${controlId}`)
    await expect(page.getByTestId('material-controlQty')).toHaveValue('10')
    await expect(page.getByTestId('material-arrivedQty')).toHaveText('7')
    await expect(page.getByTestId('material-usedQty')).toHaveText('3')
    await expect(page.getByTestId('material-remainingQty')).toHaveText('7')
    await expect(page.getByTestId('material-stockQty')).toHaveText('4')
  })

  test('阻断非项目甲方、超总控到货和超总控余量的业务动作', async ({ page }) => {
    test.setTimeout(180_000)
    const suffix = Date.now()
    const material = `E2E甲供边界-${suffix}`

    await page.goto('/owner-material/control/new')
    await chooseProject(page)
    await chooseOwnerCustomer(page, '锦绣置业有限公司')
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-unit').fill('套')
    await page.getByTestId('material-controlQty').fill('2')
    await confirmBusinessAction(page, '生效')
    await expect(page.getByText('甲供单位不属于所选项目')).toBeVisible()
    await expect(page).toHaveURL('/owner-material/control/new')

    await page.goto('/owner-material/control/new')
    await chooseProject(page)
    await chooseOwnerCustomer(page)
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-unit').fill('套')
    await page.getByTestId('material-controlQty').fill('2')
    await confirmBusinessAction(page, '生效')
    await expect(page).not.toHaveURL(/\/owner-material\/control\/new$/)
    const controlId = page.url().split('/').pop()

    await page.goto('/owner-material/arrival/new')
    await chooseProject(page)
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-unit').fill('套')
    await page.getByTestId('material-qty').fill('3')
    await confirmBusinessAction(page, '入库')
    await expect(page.getByText('到货数量超过总控量')).toBeVisible()
    await expect(page).toHaveURL('/owner-material/arrival/new')

    await page.goto('/owner-material/direct/new')
    await chooseProject(page)
    await chooseOwnerCustomer(page)
    await page.getByTestId('material-materialName').fill(material)
    await page.getByTestId('material-unit').fill('套')
    await page.getByTestId('material-qty').fill('3')
    await page.getByTestId('material-useLocation').fill('首层')
    await confirmBusinessAction(page, '确认')
    await expect(page.getByText('总控余量不足')).toBeVisible()
    await expect(page).toHaveURL('/owner-material/direct/new')

    await expect(controlId).toBeTruthy()
  })
})
