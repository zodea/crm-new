import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { updateProductionSnapshot } from './helpers/browser-production-snapshot'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const OWNER_INPUTS = [
  { label: '整数樘', project: '受控甲供工程甲', owner: '受控甲方甲', unrelated: '无关甲方甲', material: '受控甲供门甲', spec: '1000×2100', unit: '樘', control: '10', planned: '8', arrival: '6', use: '2', direct: '1', arrived: '7', used: '3', remaining: '7', stock: '4', boundary: '2', over: '3', applicant: '计划员甲', receiver: '领料员甲', location: '二层', clock: '2026-08-10T04:00:00Z' },
  { label: '小数米', project: '受控甲供工程乙', owner: '受控甲方乙', unrelated: '无关甲方乙', material: '受控甲供管乙', spec: 'DN50', unit: '米', control: '5.5', planned: '4.5', arrival: '3.5', use: '1.25', direct: '0.75', arrived: '4.25', used: '2', remaining: '3.5', stock: '2.25', boundary: '2.5', over: '3.5', applicant: '计划员乙', receiver: '领料员乙', location: '首层', clock: '2024-02-29T04:00:00Z' },
] as const

type OwnerInput = typeof OWNER_INPUTS[number]

async function installOwnerFixture(page: Page, input: OwnerInput) {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `owner-material-${randomUUID()}` })
  await page.clock.install({ time: new Date(input.clock) })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const create = async (domain: string, draft: Record<string, unknown>) => {
    const response = await page.request.post(`/api/commands/${domain}`, { data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: domain === 'customers' ? 'customer:write' : 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const owner = await create('customers', { name: input.owner, contact: input.applicant })
  const unrelated = await create('customers', { name: input.unrelated, contact: input.receiver })
  const project = await create('projects', { name: input.project, manager: input.applicant, customerId: owner.id, status: '筹备中' })
  await page.goto('/owner-material/control')
  await expect(page.getByLabel('单据列表工具栏')).toBeVisible()
  // 甲供材尚未迁入；其既有本地校验读取中央命令生成的正式身份镜像。
  await updateProductionSnapshot(page, (database) => {
    for (const customer of [{ id: owner.id, name: input.owner }, { id: unrelated.id, name: input.unrelated }])
      database.run('INSERT INTO customers (id, name, status) VALUES (?, ?, ?)', [customer.id, customer.name, 'draft'])
    database.run('INSERT INTO projects (id, name, customer_id, status, source) VALUES (?, ?, ?, ?, ?)', [project.id, input.project, owner.id, '筹备中', 'e2e-production-fixture'])
  })
  await page.reload()
}

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

async function chooseProject(page: Page, input: OwnerInput) {
  await chooseLookup(page, '检索项目', input.project, input.project)
}

async function chooseOwnerCustomer(page: Page, name: string) {
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
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
  })
  for (const route of OWNER_MATERIAL_ROUTES) {
    test(`${route.title} 可运行并保持甲供边界，各宽度无页面溢出`, async ({ page }) => {
      await page.goto(route.path)
      await expect(page.getByRole('heading', { name: route.title })).toBeVisible({ timeout: 20_000 })
      await expectOwnerPageContract(page, route.kind)
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `${route.path} @ ${width}px`)
      }
    })
  }

  for (const input of OWNER_INPUTS) {
    test(`${input.label} 甲供材五页贯通，删除并撤回直入直出后重算派生量`, async ({ page }) => {
      test.setTimeout(180_000)
      await installOwnerFixture(page, input)
      const material = input.material

      await page.goto('/owner-material/control/new')
      await chooseProject(page, input)
      await chooseOwnerCustomer(page, input.owner)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-spec').fill(input.spec)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-controlQty').fill(input.control)
      await expect(page.getByTestId('material-arrivedQty')).toHaveText('0')
      await expect(page.getByTestId('material-usedQty')).toHaveText('0')
      await expect(page.getByTestId('material-remainingQty')).toHaveText('0')
      await confirmBusinessAction(page, '生效')
      await expect(page).not.toHaveURL(/\/owner-material\/control\/new$/)
      await expect(page).toHaveURL(/\/owner-material\/control\/[^/?]+$/)
      const controlId = page.url().split('/').pop()
      await expect(page.getByText('已生效', { exact: true })).toBeVisible()
      await expect(page.getByTestId('material-remainingQty')).toHaveText(input.control)

      await page.goto('/owner-material/requisition/new')
      await chooseProject(page, input)
      await page.getByTestId('material-applicant').fill(input.applicant)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-spec').fill(input.spec)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-plannedQty').fill(input.planned)
      await confirmBusinessAction(page, '提交')
      await expect(page).not.toHaveURL(/\/owner-material\/requisition\/new$/)
      await expect(page).toHaveURL(/\/owner-material\/requisition\/[^/?]+$/)
      await expect(page.getByText('已生效', { exact: true })).toBeVisible()

      await page.goto('/owner-material/arrival/new')
      await chooseProject(page, input)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-spec').fill(input.spec)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-qty').fill(input.arrival)
      await expect(page.getByTestId('material-stockStatus')).toHaveText('待入库')
      await confirmBusinessAction(page, '入库')
      await expect(page).not.toHaveURL(/\/owner-material\/arrival\/new$/)
      await expect(page).toHaveURL(/\/owner-material\/arrival\/[^/?]+$/)
      await expect(page.getByTestId('material-stockStatus')).toHaveText('已入库')

      await page.goto('/owner-material/use/new')
      await chooseProject(page, input)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-qty').fill(input.use)
      await page.getByTestId('material-receiver').fill(input.receiver)
      await confirmBusinessAction(page, '出库')
      await expect(page).not.toHaveURL(/\/owner-material\/use\/new$/)
      await expect(page).toHaveURL(/\/owner-material\/use\/[^/?]+$/)
      await expect(page.getByText('已生效', { exact: true })).toBeVisible()

      await page.goto('/owner-material/direct/new')
      await chooseProject(page, input)
      await chooseOwnerCustomer(page, input.owner)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-qty').fill(input.direct)
      await page.getByTestId('material-useLocation').fill(input.location)
      await confirmBusinessAction(page, '确认')
      await expect(page).not.toHaveURL(/\/owner-material\/direct\/new$/)
      await expect(page).toHaveURL(/\/owner-material\/direct\/[^/?]+$/)
      await expect(page.getByText('已生效', { exact: true })).toBeVisible()
      const directPath = new URL(page.url()).pathname

      const readTotals = async (target: Page, arrived: string, used: string, remaining: string) => {
        await expect(target.getByTestId('material-controlQty')).toHaveValue(input.control)
        await expect(target.getByTestId('material-arrivedQty')).toHaveText(arrived)
        await expect(target.getByTestId('material-usedQty')).toHaveText(used)
        await expect(target.getByTestId('material-remainingQty')).toHaveText(remaining)
        await expect(target.getByTestId('material-stockQty')).toHaveText(input.stock)
      }

      const controlPage = await page.context().newPage()
      await controlPage.goto(`/owner-material/control/${controlId}`)
      await readTotals(controlPage, input.arrived, input.used, input.remaining)
      await page.goto('/owner-material/direct')
      const directRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: input.project, exact: true }) })
      await expect(directRow).toHaveCount(1)
      await page.getByRole('button', { name: '删除', exact: true }).click({ timeout: 15_000 })
      await page.getByRole('dialog', { name: '删除甲供材直入直出' }).getByRole('button', { name: '删除', exact: true }).click()
      await expect(directRow).toHaveCount(0)
      await controlPage.reload()
      await readTotals(controlPage, input.arrival, input.use, String(Number(input.control) - Number(input.use)))
      await page.getByRole('button', { name: '撤回', exact: true }).click()
      await expect(directRow).toBeVisible()
      await page.reload()
      await page.getByRole('button', { name: material, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${directPath}$`))
      await expect(page.getByTestId('material-qty')).toHaveValue(input.direct)
      await controlPage.reload()
      await readTotals(controlPage, input.arrived, input.used, input.remaining)
      await controlPage.close()
    })

    test(`${input.label} 阻断非项目甲方、超总控到货和超总控余量的业务动作`, async ({ page }) => {
      test.setTimeout(180_000)
      await installOwnerFixture(page, input)
      const material = `${input.material}边界`

      await page.goto('/owner-material/control/new')
      await chooseProject(page, input)
      await chooseOwnerCustomer(page, input.unrelated)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-controlQty').fill(input.boundary)
      await confirmBusinessAction(page, '生效')
      await expect(page.getByText('甲供单位不属于所选项目')).toBeVisible()
      await expect(page).toHaveURL('/owner-material/control/new')

      await page.goto('/owner-material/control/new')
      await chooseProject(page, input)
      await chooseOwnerCustomer(page, input.owner)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-controlQty').fill(input.boundary)
      await confirmBusinessAction(page, '生效')
      await expect(page).not.toHaveURL(/\/owner-material\/control\/new$/)
      const controlId = page.url().split('/').pop()

      await page.goto('/owner-material/arrival/new')
      await chooseProject(page, input)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-qty').fill(input.over)
      await confirmBusinessAction(page, '入库')
      await expect(page.getByText('到货数量超过总控量')).toBeVisible()
      await expect(page).toHaveURL('/owner-material/arrival/new')

      await page.goto('/owner-material/direct/new')
      await chooseProject(page, input)
      await chooseOwnerCustomer(page, input.owner)
      await page.getByTestId('material-materialName').fill(material)
      await page.getByTestId('material-unit').fill(input.unit)
      await page.getByTestId('material-qty').fill(input.over)
      await page.getByTestId('material-useLocation').fill(input.location)
      await confirmBusinessAction(page, '确认')
      await expect(page.getByText('总控余量不足')).toBeVisible()
      await expect(page).toHaveURL('/owner-material/direct/new')

      await expect(controlId).toBeTruthy()
    })
  }
})
