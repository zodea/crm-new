import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import {
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
  tabUntilFocused,
} from './helpers/responsive'

const DOCUMENTS = [
  { listPath: '/owner/change', newPath: '/owner/change/new', title: '甲方变洽签', typeLabel: '类型' },
  { listPath: '/owner/report', newPath: '/owner/report/new', title: '甲方报量', typeLabel: null },
  { listPath: '/owner/acceptance', newPath: '/owner/acceptance/new', title: '竣工验收·保修', typeLabel: null },
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

const CHANGE_CASES = [
  { name: '整数工程量', date: '2026-09-11', qty: '2', unitPrice: 260, amount: '520.00' },
  { name: '小数工程量与闰日', date: '2028-02-29', qty: '0.5', unitPrice: 52, amount: '26.00' },
] as const

async function installOwnerBoqFixture(page: Page, input: (typeof CHANGE_CASES)[number] = CHANGE_CASES[0]) {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `owner-form-${randomUUID()}` })
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const create = async (domain: string, requiredCapability: string, draft: Record<string, unknown>) => {
    const response = await page.request.post(`/api/commands/${domain}`, { data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability, commandId: randomUUID(), baseVersion: null, action: 'draft', draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const projectName = `甲方单据正式项目-${input.name}`
  const contractName = `甲方单据正式施工合同-${input.name}`
  const project = await create('projects', 'project:write', { name: projectName, manager: '合成经办人', status: '筹备中' })
  const contract = await create('construction-contracts', 'construction-contract:write', { name: contractName, projectId: project.id, content: '正式工程量签证验收', signDate: input.date, amount: 52000 })
  const envelope = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'owner-document:write', kind: 'owner_change', attachments: { add: [], removeIds: [], restoreIds: [] } }
  const sourceName = `正式已签证清单-${input.name}`
  const submitted = await page.request.post('/api/commands/owner-documents', { data: { ...envelope, commandId: randomUUID(), action: 'submit', id: null, baseVersion: null, draft: { name: sourceName, reason: '正式受控 BOQ 来源', projectId: project.id, contractId: contract.id, applicationDate: input.date, lines: [{ operation: 'add', itemName: '合成厨房墙砖', unit: '㎡', deltaQty: 100, newUnitPrice: input.unitPrice }] } } })
  expect(submitted.ok(), await submitted.text()).toBe(true)
  const change = await submitted.json()
  const approved = await page.request.post('/api/commands/owner-documents', { data: { ...envelope, commandId: randomUUID(), action: 'approve', id: change.id, baseVersion: change.version, approvedAt: input.date } })
  expect(approved.ok(), await approved.text()).toBe(true)
  const linesResponse = await page.request.get('/api/commands/owner-documents/boq-lines', { params: { projectId: project.id, contractId: contract.id } })
  expect(linesResponse.ok(), await linesResponse.text()).toBe(true)
  const lines = await linesResponse.json()
  expect(lines).toEqual([expect.objectContaining({ itemName: '合成厨房墙砖', unit: '㎡', qty: 100, unitPrice: input.unitPrice })])
  return { projectId: project.id, contractId: contract.id, projectName, contractName, sourceName, boqLineId: lines[0].id }
}

async function chooseStatus(page: Page, option: string) {
  await page.getByRole('button', { name: /^状态，已选/ }).click()
  const dialog = page.getByRole('dialog', { name: /^状态，已选/ })
  await expect(dialog).toBeVisible()
  for (const checkbox of await dialog.getByRole('checkbox').all())
    await checkbox.uncheck()
  await dialog.getByRole('checkbox', { name: new RegExp(`^${option}`) }).check()
  await dialog.getByRole('button', { name: '应用' }).click()
}

test.describe('Issue #197：甲方、分包单据与项目罚扣', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `owner-form-${randomUUID()}` })
    await page.clock.install({ time: new Date('2026-09-12T04:00:00.000Z') })
  })
  test('八类列表和表单使用真实标题，各宽度无页面级横向溢出', async ({ page }) => {
    test.setTimeout(300_000)

    for (const document of DOCUMENTS) {
      await page.goto(document.listPath)
      const toolbar = page.locator('[data-ui="owner-document-list-toolbar"]')
      await expect(toolbar.getByRole('heading', { name: document.title, exact: true }))
        .toBeVisible({ timeout: 60_000 })
      await expect(toolbar.getByRole('searchbox')).toBeVisible()
      await expect(toolbar.getByRole('combobox', { name: '项目' })).toBeVisible()
      await expect(toolbar.getByRole('button', { name: /^状态，已选/ })).toBeVisible()
      if (document.typeLabel)
        await expect(toolbar.getByRole('button', { name: new RegExp(`^${document.typeLabel}，已选`) })).toBeVisible()
      else
        await expect(toolbar.getByRole('button', { name: /^类型，已选/ })).toHaveCount(0)
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
        await expect(toolbar.getByRole('button', { name: `新建${document.title}` })).toBeVisible()
        await expectNoPageOverflow(page, `${document.listPath} @ ${width}px`)
      }

      await page.goto(document.newPath)
      await expect(page.getByRole('heading', { name: `新建 · ${document.title}`, exact: true })).toBeVisible({
        timeout: 60_000,
      })
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
        await expectNoPageOverflow(page, `${document.newPath} @ ${width}px`)
      }
    }
  })

  test('来源 query 可见且可单独清除，状态筛选和无结果空态可恢复', async ({ page }) => {
    const fixture = await installOwnerBoqFixture(page)
    await page.goto(`/owner/change?projectId=${fixture.projectId}&contractId=${fixture.contractId}`)

    const context = page.locator('[data-ui="owner-document-route-context"]')
    await expect(context).toBeVisible({ timeout: 30_000 })
    await expect(context).toContainText(`项目：${fixture.projectName}`)
    await expect(context).toContainText(`合同：${fixture.contractName}`)
    await expect(context.getByRole('button')).toHaveCount(2)

    await context.getByRole('button', { name: new RegExp(`清除项目：${fixture.projectName}`) }).click()
    await expect(page).toHaveURL(url => !url.searchParams.has('projectId') && url.searchParams.get('contractId') === fixture.contractId)

    const toolbar = page.locator('[data-ui="owner-document-list-toolbar"]')
    const status = toolbar.getByRole('button', { name: /^状态，已选/ })
    await chooseStatus(page, '草稿')
    await expect(page.getByRole('status', { name: '没有符合条件的甲方变洽签' }))
      .toBeVisible()
    await chooseStatus(page, '已签证')
    await expect(page.getByText(fixture.sourceName, { exact: true })).toBeVisible()

    const search = toolbar.getByRole('searchbox')
    await search.fill('不存在的甲方变更-受控空态')
    const filteredEmpty = page.getByRole('status', { name: '没有符合条件的甲方变洽签' })
    await expect(filteredEmpty).toBeVisible()
    await filteredEmpty.getByRole('button', { name: '清除筛选' }).click()
    await expect(search).toHaveValue('')
    await expect(status).toHaveAccessibleName('状态，已选 0 项')
    await expect(page).toHaveURL(url => url.searchParams.get('status') === 'all' && !url.searchParams.has('contractId'))
    await expect(context).toHaveCount(0)
    await expect(page.getByText(fixture.sourceName, { exact: true })).toBeVisible()
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

  for (const input of CHANGE_CASES) {
    test(`甲方量价变更复用真实 BOQ，附件随单提交并完成签证锁定：${input.name}`, async ({ page }) => {
      test.setTimeout(120_000)
      const fixture = await installOwnerBoqFixture(page, input)
      await page.clock.setSystemTime(new Date(`${input.date}T04:00:00.000Z`))
      const name = `E2E现场签证-${input.name}`

      await page.goto('/owner/change/new')
      await expect(page.getByRole('heading', { name: '新建 · 甲方变洽签' })).toBeVisible({
        timeout: 20_000,
      })
      await page.getByTestId('owner-document-name').fill(name)
      await chooseLookup(page, '检索项目', fixture.projectName, fixture.projectName)
      await chooseLookup(page, '检索施工合同', fixture.contractName, fixture.contractName)
      await page.getByTestId('owner-document-applicationDate').fill(input.date)
      await page.getByTestId('owner-document-reason').fill('E2E 现场范围增加')
      await page.getByTestId('owner-document-add-line').click()

      const boqSelect = page.getByLabel('合同清单项').first()
      await expect(boqSelect.locator('option')).toHaveCount(2)
      await expect(boqSelect.locator(`option[value="${fixture.boqLineId}"]`)).toContainText('合成厨房墙砖')
      await boqSelect.selectOption(fixture.boqLineId)
      await page.getByLabel('变更量').fill(input.qty)
      await expect(page.getByText(`合计 ¥${input.amount}`, { exact: false })).toBeVisible()

      await page.locator('#section-attachments input[type="file"]').setInputFiles({
        name: 'e2e-owner-visa.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(cooperationPdfFixture('Synthetic owner visa')),
      })
      const closeAfterSave = page.getByRole('checkbox', { name: '【保存】后关闭' })
      if (await closeAfterSave.isChecked())
        await closeAfterSave.uncheck()
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并上报' }).click()
      const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
      await page.getByRole('dialog').getByRole('button', { name: '上报', exact: true }).click()
      const receipt = await saved
      expect(receipt.ok(), await receipt.text()).toBe(true)
      const id = (await receipt.json()).id
      await expect(page).toHaveURL(url => url.pathname === `/owner/change/form/${id}`)
      await expect(page.getByText('已上报', { exact: true })).toBeVisible()
      await expect(page.getByText('e2e-owner-visa.pdf', { exact: true }))
        .toBeVisible()
      await page.getByRole('button', { name: '确认签证' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByPlaceholder(name).fill(name)
      const approved = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST' && response.request().postDataJSON().action === 'approve')
      await dialog.getByRole('button', { name: '确认签证', exact: true }).click()
      const approvalReceipt = await approved
      expect(approvalReceipt.ok(), await approvalReceipt.text()).toBe(true)
      expect(await approvalReceipt.json()).toMatchObject({ id })
      await expect(page.getByText('甲方签证已生效，收入变更台账已锁定', { exact: true })).toBeVisible()
      await expect(page).toHaveURL(url => url.pathname === '/owner/change')
      await page.goto(`/owner/change/${id}?origin=real`)
      await page.reload()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(page.getByRole('group', { name: '审批状态', exact: true })).toContainText('已签证')
      await expect(page.getByTestId('owner-document-edit')).toHaveCount(0)
      await expect(page.getByText('e2e-owner-visa.pdf', { exact: true })).toBeVisible()
      const detailResponse = await page.request.get(`/api/read/owner-documents/owner_change/${id}`, { params: { origin: 'real', includeDemo: false } })
      expect(detailResponse.ok(), await detailResponse.text()).toBe(true)
      expect((await detailResponse.json()).document).toMatchObject({
        id,
        applicationDate: input.date,
        approvalDate: input.date,
        source: { id, type: 'boq_change_order', locked: true },
      })
    })
  }
})
