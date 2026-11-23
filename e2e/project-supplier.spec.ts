import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { EQUIVALENT_200_PERCENT_VIEWPORT, expectInViewport, expectLocalHorizontalScroll, expectNoPageOverflow, expectTabSequence, RESPONSIVE_WIDTHS, tabUntilFocused } from './helpers/responsive'

const READ_INPUTS = [
  { projectId: 'proj_demo_001', project: '合和新城', supplierId: 'sup_demo_001', supplier: '广州市大板东建材有限公司', contractId: 'con_demo_cg02', contract: '钢筋采购合同', contractNo: 'RJ-HHXC-CG-2025002', total: '¥1,525,000.00' },
  { projectId: 'proj_demo_002', project: '锦绣华庭', supplierId: 'sup_demo_004', supplier: '穗建五金机电经营部', contractId: 'con_demo_cg07', contract: '五金机电采购合同', contractNo: 'RJ-JXHT-CG-2026007', total: '¥230,000.00' },
] as const
const IMPORT_INPUTS = [
  { project: PROJECT_INPUTS[0], supplier: '合成材料供方甲', candidate: '合成新候选供方甲', category: '付款' },
  { project: PROJECT_INPUTS[1], supplier: '合成材料供方乙', candidate: '合成新候选供方乙', category: '合同' },
] as const

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

const RESPONSIVE_CASES = [
  ...RESPONSIVE_WIDTHS.map(width => ({
    label: `${width}px`,
    width,
    height: VIEWPORT_HEIGHTS[width],
  })),
  {
    label: '720px 等效 200%',
    ...EQUIVALENT_200_PERCENT_VIEWPORT,
  },
] as const

function contractTableScroller(page: Page): Locator {
  return page.getByLabel('业务记录表格，可横向滚动')
}

async function waitForWorkbench(page: Page, input: (typeof READ_INPUTS)[number]) {
  await expect(page.getByText('项目 × 分供方事实工作台', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${input.project} × ${input.supplier}`, exact: true })).toBeVisible()
  await expect(page.getByText('正在读取权威业务表', { exact: true })).toHaveCount(0)
}

async function prepareImport(page: Page, input: (typeof IMPORT_INPUTS)[number]) {
  const project = await installProjectCentralFixture(page, input.project)
  const response = await page.request.get('/api/read/business-session')
  expect(response.ok()).toBe(true)
  const session = await response.json()
  const created = await page.request.post('/api/commands/suppliers', { data: {
    ...session,
    requiredCapability: 'supplier:write',
    commandId: randomUUID(),
    baseVersion: null,
    action: 'draft',
    draft: { name: input.supplier, supplierCategory: '材料供应商', contact: '合成联系人' },
    attachments: {},
  } })
  expect(created.ok(), await created.text()).toBe(true)
  const supplierId = (await created.json()).id as string
  const contextResponse = await page.request.get(`/api/read/project-suppliers/${project.id}/import-context`)
  expect(contextResponse.ok(), await contextResponse.text()).toBe(true)
  const context = await contextResponse.json()
  const bytes = cooperationPdfFixture('Existing relationship')
  const relation = await page.request.post('/api/commands/project-suppliers/import', { data: {
    projectId: project.id,
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    requiredCapability: 'project-supplier:write',
    commandId: randomUUID(),
    baseVersion: context.sourceVersion,
    groups: [{ supplierId, supplierName: input.supplier, files: [{ fileName: `${input.supplier}-原合作合同.pdf`, fileSize: bytes.byteLength, mimeType: 'application/pdf', category: '合同', payloadBase64: Buffer.from(bytes).toString('base64') }] }],
  } })
  expect(relation.ok(), await relation.text()).toBe(true)
  return { ...project, supplierId, workbench: `/project/${project.id}/supplier/${supplierId}?origin=real&tab=contract` }
}

async function expectHorizontalScrollOwner(locator: Locator, context: string) {
  const overflowX = await locator.evaluate(element => getComputedStyle(element).overflowX)
  expect(overflowX, `${context} 应由业务表格自身承载横向滚动`).toMatch(/auto|scroll/)
}

test.describe('Issue #192：项目×分供方工作台与文件导入', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `project-supplier-192-${randomUUID()}` })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    await page.clock.setFixedTime(new Date('2026-10-03T04:00:00.000Z'))
    const reset = await page.request.post('/api/testing/project-suppliers/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
    expect(reset.ok()).toBe(true)
  })

  for (const input of READ_INPUTS) {
    test(`只读项目进入真实合同来源，返回保持合同页签：${input.project}`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(`/project/${input.projectId}?origin=demo`)
      await expect(page.getByRole('heading', { name: input.project, exact: true })).toBeVisible({ timeout: 30_000 })
      await page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: input.supplier, exact: true }).click()
      await waitForWorkbench(page, input)
      await page.getByRole('tab', { name: /^合同/ }).click()
      await expect(page).toHaveURL(new RegExp(`/project/${input.projectId}/supplier/${input.supplierId}\\?origin=demo&tab=contract$`))
      await expect(page.getByText('变更后合同额', { exact: true }).locator('..').filter({ hasText: input.total })).toHaveCount(1)
      const contractRow = page.getByRole('row', { name: new RegExp(input.contract) })
      await expect(contractRow).toContainText(input.contractNo)
      await contractRow.getByRole('link', { name: '查看源单', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/contract/${input.contractId}\\?`))
      await expect(page.getByRole('heading', { name: new RegExp(input.contract) })).toBeVisible()
      await page.getByRole('link', { name: '返回项目分供方工作台', exact: true }).click()
      await waitForWorkbench(page, input)
      await expect(page.getByRole('tab', { name: /^合同/ })).toHaveAttribute('aria-selected', 'true')
      await page.reload()
      await expect(page.getByRole('row', { name: new RegExp(input.contract) })).toBeVisible()
    })
  }

  for (const input of IMPORT_INPUTS) {
    test(`正式项目三步导入复用关系、创建新候选并冷读取原件：${input.supplier}`, async ({ page }) => {
      const project = await prepareImport(page, input)
      const existingFileName = `${input.supplier}-${input.category}回单.pdf`
      const candidateFileName = `${input.candidate}-资质.pdf`
      await page.setViewportSize({ width: 1024, height: 900 })
      await project.open()
      await page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: '从文件导入分供方', exact: true }).click()
      await expect(page).toHaveURL(`/project/${project.id}/supplier/import?origin=real`)
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '选择文件', exact: true }).click()
      await (await chooser).setFiles([
        { name: existingFileName, mimeType: 'application/pdf', buffer: Buffer.from(cooperationPdfFixture('Existing original')) },
        { name: candidateFileName, mimeType: 'application/pdf', buffer: Buffer.from(cooperationPdfFixture('Candidate original')) },
      ])
      await expect(page.getByRole('cell', { name: existingFileName, exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: candidateFileName, exact: true })).toBeVisible()
      await page.getByRole('button', { name: '下一步：自动分类', exact: true }).click()
      const existing = page.locator('article').filter({ hasText: existingFileName })
      await expect(existing.getByRole('combobox', { name: /分供方/ })).toHaveValue(project.supplierId)
      await expect(existing).toContainText('已有项目关系，只追加文件')
      await existing.getByRole('combobox', { name: /文件类别/ }).selectOption(input.category)
      const candidate = page.locator('article').filter({ hasText: candidateFileName })
      await candidate.getByRole('textbox', { name: /新分供方名称/ }).fill(input.candidate)
      await candidate.getByRole('checkbox').focus()
      await page.keyboard.press('Space')
      await expect(candidate.getByRole('checkbox')).toBeChecked()
      await tabUntilFocused(page, page.getByRole('button', { name: '下一步：确认生成', exact: true }))
      await page.keyboard.press('Enter')
      await expect(page.getByText('复用已有关系', { exact: true })).toBeVisible()
      await expect(page.getByText('新建主数据', { exact: true })).toBeVisible()
      await tabUntilFocused(page, page.getByRole('button', { name: '确认生成并返回项目', exact: true }))
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(project.url)
      await page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: input.candidate, exact: true }).click()
      await expect(page.getByRole('heading', { name: `${input.project.name} × ${input.candidate}`, exact: true })).toBeVisible()
      await expect(page.getByText(candidateFileName, { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText(candidateFileName, { exact: true })).toBeVisible()
      await page.goto(project.workbench)
      const file = page.getByText(existingFileName, { exact: true })
      await expect(file).toBeVisible()
      await expect(file.locator('xpath=ancestor::div[contains(@class,"supplier-file-row")][1]')).toContainText(input.category)
      expect(project.errors).toEqual([])
    })
  }

  test('只读工作台及正式导入向导在各宽度局部滚动、键盘可达', async ({ page }) => {
    const input = READ_INPUTS[0]
    const workbench = `/project/${input.projectId}/supplier/${input.supplierId}?origin=demo&tab=contract`
    const desktop = { width: 1440, height: VIEWPORT_HEIGHTS[1440] }
    await page.setViewportSize(desktop)
    await page.goto(workbench)
    await waitForWorkbench(page, input)
    const table = contractTableScroller(page)
    await expect(table).toBeVisible()
    const refresh = page.getByRole('button', { name: '刷新', exact: true })
    for (const viewport of RESPONSIVE_CASES) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await expectNoPageOverflow(page, `${viewport.label} 工作台`)
      await expect(table).toBeVisible()
      await expectHorizontalScrollOwner(table, viewport.label)
      if (viewport.width <= 768)
        await expectLocalHorizontalScroll(table, viewport.label)
      await refresh.scrollIntoViewIfNeeded()
      await expectInViewport(refresh, viewport.label)
    }

    await page.setViewportSize(desktop)
    await tabUntilFocused(page, refresh)
    await tabUntilFocused(page, page.getByRole('tab', { name: /^合同/ }))
    const claimTab = page.getByRole('tab', { name: /^请款/ })
    await tabUntilFocused(page, claimTab)
    await claimTab.press('Enter')
    await expect(claimTab).toHaveAttribute('aria-selected', 'true')
    for (const viewport of RESPONSIVE_CASES) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await expectNoPageOverflow(page, `${viewport.label} 键盘页签`)
    }

    const project = await prepareImport(page, IMPORT_INPUTS[0])
    await page.setViewportSize(desktop)
    await page.goto(`/project/${project.id}/supplier/import?origin=real`)
    await expect(page.getByRole('heading', { name: '项目分供方文件导入', exact: true })).toBeVisible()
    const chooseFiles = page.getByRole('button', { name: '选择文件', exact: true })
    const chooseFolder = page.getByRole('button', { name: '选择文件夹', exact: true })
    await expectTabSequence(page, chooseFiles, [chooseFolder], '导入向导选择入口')
    for (const viewport of RESPONSIVE_CASES) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await expectNoPageOverflow(page, `${viewport.label} 导入向导`)
      await expectInViewport(chooseFolder, viewport.label)
    }
  })
})

const STORAGE_KEY = 'ruihang:workspace-default:include-demo'
const WORKBENCH = '/project/proj_demo_002/supplier/sup_demo_004?origin=demo&tab=overview'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, scenario: 'ready' | 'formal-ready' | 'zero' | 'forbidden' | 'unavailable' = 'ready') {
  const response = await request.post('/api/testing/project-suppliers/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok()).toBe(true)
}

test.describe('Issue #317：项目分供方六类事实工作台', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), STORAGE_KEY)
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
  })

  test('六类事实与汇总可见，项目来源刷新后返回工作台', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('¥230,000.00', { exact: true }).first()).toBeVisible()
    for (const tab of ['合作概览', '合同', '请款', '收票', '付款', '结算'])
      await expect(page.getByRole('tab', { name: new RegExp(tab) })).toBeVisible()

    const projectIdentity = page.getByRole('link', { name: '锦绣华庭', exact: true })
    await expect(projectIdentity).toHaveAttribute('href', /\/project\/proj_demo_002\?origin=demo&returnTo=/)
    await projectIdentity.click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\?origin=demo&returnTo=/)
    await expect(page.getByRole('heading', { name: '锦绣华庭' })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\?origin=demo&returnTo=/)
    await page.getByRole('link', { name: '返回项目分供方工作台' }).click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\/supplier\/sup_demo_004\?origin=demo&tab=overview$/)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible()
  })

  test('分供方来源刷新后返回工作台', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    const supplierIdentity = page.getByRole('link', { name: '穗建五金机电经营部', exact: true })
    await expect(supplierIdentity).toHaveAttribute('href', /\/base\/supplier\/sup_demo_004\?origin=demo&returnTo=/)
    await supplierIdentity.click()
    await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004\?origin=demo&returnTo=/)
    await expect(page.getByRole('heading', { name: '穗建五金机电经营部' })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004\?origin=demo&returnTo=/)
    await page.getByRole('link', { name: '返回项目分供方工作台' }).click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\/supplier\/sup_demo_004\?origin=demo&tab=overview$/)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible()
  })

  test('合同源单返回后刷新保留标签', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: /^合同/ }).click()
    await expect(page).toHaveURL(/tab=contract/)
    const contractSource = page.getByRole('link', { name: '查看源单' }).first()
    await expect(contractSource).toHaveAttribute('href', /\/contract\/con_demo_cg07\?.*projectId=proj_demo_002.*supplierId=sup_demo_004.*returnTo=/)
    await contractSource.click()
    await expect(page.getByRole('heading', { name: /五金机电/ })).toBeVisible()
    await page.getByRole('link', { name: '返回项目分供方工作台' }).click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\/supplier\/sup_demo_004\?origin=demo&tab=contract$/)
    await expect(page.getByRole('tab', { name: /^合同/ })).toHaveAttribute('aria-selected', 'true')
    await page.reload()
    await expect(page.getByRole('tab', { name: /^合同/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('请款刷新恢复及收票、付款、结算显示待核验状态', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: /^请款/ }).click()
    await expect(page.getByText('来源待核验').first()).toBeVisible()
    await expect(page.getByRole('link', { name: '查看源单' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /^请款/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=claim/)
    await page.reload()
    await expect(page.getByRole('tab', { name: /^请款/ })).toHaveAttribute('aria-selected', 'true')
    for (const tab of ['收票', '付款', '结算']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
      await expect(page.getByText('目标待核验').first()).toBeVisible()
      await expect(page.getByRole('link', { name: '查看源单' })).toHaveCount(0)
    }
    await expect(page.getByText('2 份', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '查看来源' }).first()).toHaveAttribute('href', /returnTo=/)
  })

  test('显式正式中央实例提供六类非零事实且不回退本地来源', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await reset(page.context().request, session(testInfo), 'formal-ready')
    await page.goto('/project/project-real-317/supplier/supplier-real-317?tab=overview')
    await expect(page.getByRole('heading', { name: '中央正式项目 × 中央正式分供方' })).toBeVisible({ timeout: 20_000 })
    for (const tab of ['合同1', '请款1', '收票1', '付款1', '结算1'])
      await expect(page.getByRole('tab', { name: tab })).toBeVisible()

    const summary = page.getByTestId('project-supplier-header')
    for (const [label, amount] of [
      ['变更后合同额', '¥120,000.00'],
      ['已审批请款', '¥50,000.00'],
      ['已归档收票', '¥31,800.00'],
      ['收票税额', '¥1,800.00'],
      ['已确认支付', '¥30,000.00'],
      ['已确认结算', '¥45,000.00'],
      ['应付余额', '¥90,000.00'],
    ] as const) {
      const metric = summary.locator('div').filter({ has: page.getByText(label, { exact: true }) }).filter({ has: page.getByText(amount, { exact: true }) })
      await expect(metric.last()).toBeVisible()
    }

    await page.getByRole('tab', { name: '合同1' }).click()
    await expect(page.getByLabel('合同事实').getByText('目标待核验')).toBeVisible()
    await expect(page.getByRole('link', { name: '查看源单' })).toHaveCount(0)

    for (const item of [
      { tab: '合同1', region: '合同事实', query: 'contract', number: 'HT-REAL-317', amounts: ['¥100,000.00', '¥120,000.00'] },
      { tab: '请款1', region: '请款事实', query: 'claim', number: 'QK-REAL-317', amounts: ['¥60,000.00', '¥50,000.00'] },
      { tab: '收票1', region: '收票事实', query: 'ticket', number: 'INV-REAL-317', amounts: ['¥31,800.00', '¥1,800.00'] },
      { tab: '付款1', region: '付款事实', query: 'payment', number: 'ZF-REAL-317', amounts: ['¥30,000.00'] },
      { tab: '结算1', region: '结算事实', query: 'settlement', number: 'JS-REAL-317', amounts: ['¥45,000.00'] },
    ]) {
      await page.getByRole('tab', { name: item.tab }).click()
      const row = page.getByLabel(item.region).getByRole('row').filter({ has: page.getByRole('cell', { name: item.number, exact: true }) })
      await expect(row).toBeVisible()
      for (const amount of item.amounts)
        await expect(row.getByRole('cell', { name: amount, exact: true })).toBeVisible()
      await expect(row.getByText('目标待核验')).toBeVisible()
      await expect(row.getByRole('link', { name: '查看源单' })).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`tab=${item.query}$`))
      await page.reload()
      await expect(page.getByRole('tab', { name: item.tab })).toHaveAttribute('aria-selected', 'true')
      await expect(row).toBeVisible()
    }

    await page.setViewportSize({ width: 390, height: 900 })
    const table = page.getByLabel('业务记录表格，可横向滚动')
    await expectLocalHorizontalScroll(table, '#317 正式结算事实表')
    await table.focus()
    await expect(table).toBeFocused()
    await table.evaluate((element) => {
      element.scrollLeft = 0
    })
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await expectNoPageOverflow(page, '#317 正式结算事实表 @ 390px')
  })

  for (const input of [
    { label: '材料供应候选', supplierName: '中央合成材料供应候选', fileName: '中央合成材料供应候选-合同.pdf' },
    { label: '工程服务候选', supplierName: '中央合成工程服务候选', fileName: '中央合成工程服务候选-合同.pdf' },
  ]) {
    test(`正式项目导入只在确认时原子提交中央身份、关系与文件元数据，刷新仍可读取：${input.label}`, async ({ page }, testInfo) => {
      test.setTimeout(60_000)
      const prepared = await page.request.post('/api/testing/construction-contracts/reset', {
        headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session(testInfo) },
        data: { scenario: 'ready' },
      })
      expect(prepared.ok()).toBe(true)
      const projectPath = '/project/project-real-320?origin=real'
      const { fileName, supplierName } = input

      await page.goto(projectPath)
      await expect(page.getByRole('heading', { name: '中央正式施工项目' })).toBeVisible({ timeout: 20_000 })
      const projectSuppliers = page.getByRole('region', { name: '项目分供方' })
      await projectSuppliers.getByRole('link', { name: '从文件导入分供方' }).click()
      await expect(page).toHaveURL('/project/project-real-320/supplier/import?origin=real')

      const chooserPromise = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '选择文件', exact: true }).click()
      const chooser = await chooserPromise
      await chooser.setFiles({
        name: fileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 central project supplier import'),
      })
      await page.getByRole('button', { name: '下一步：自动分类' }).click()
      const candidate = page.locator('article').filter({ hasText: fileName })
      await candidate.getByRole('textbox', { name: /新分供方名称/ }).fill(supplierName)
      await candidate.getByRole('checkbox').check()
      await page.getByRole('button', { name: '下一步：确认生成' }).click()
      await page.getByRole('button', { name: '确认生成并返回项目' }).click()

      await expect(page).toHaveURL(projectPath)
      const imported = page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: supplierName })
      await expect(imported).toBeVisible({ timeout: 20_000 })
      await imported.click()
      await expect(page.getByRole('heading', { name: `中央正式施工项目 × ${supplierName}` })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(fileName, { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText(fileName, { exact: true })).toBeVisible({ timeout: 20_000 })

      await page.getByRole('link', { name: supplierName, exact: true }).click()
      await expect(page.getByRole('heading', { name: supplierName })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('link', { name: '中央正式施工项目' })).toBeVisible()
      await page.getByRole('link', { name: '编辑分供方' }).click()
      await expect(page.getByRole('heading', { name: '编辑 · 分供方' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByLabel('公司全称')).toHaveValue(supplierName)
      const renamedSupplierName = `${supplierName}（已补档）`
      await page.getByLabel('公司全称').fill(renamedSupplierName)
      await page.getByLabel('主要联系人').fill('陈经理')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByRole('heading', { name: renamedSupplierName })).toBeVisible({ timeout: 20_000 })

      await page.goto(projectPath)
      const renamed = page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: renamedSupplierName })
      await expect(renamed).toBeVisible({ timeout: 20_000 })
      await renamed.click()
      await expect(page.getByRole('heading', { name: `中央正式施工项目 × ${renamedSupplierName}` })).toBeVisible({ timeout: 20_000 })
    })
  }

  test('真实零关系保留六类表头和空态，不把零记录误报为不存在', async ({ page }, testInfo) => {
    await reset(page.context().request, session(testInfo), 'zero')
    await page.goto('/project/project-real-317/supplier/supplier-real-317?tab=overview')
    await expect(page.getByRole('heading', { name: '中央正式项目 × 中央正式分供方' })).toBeVisible({ timeout: 20_000 })
    for (const [tab, empty, header] of [
      ['合同0', '暂无合同事实', '合同编号'],
      ['请款0', '暂无请款事实', '请款编号'],
      ['收票0', '暂无收票事实', '发票号码'],
      ['付款0', '暂无付款事实', '支付编号'],
      ['结算0', '暂无结算事实', '结算编号'],
    ] as const) {
      await page.getByRole('tab', { name: tab }).click()
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible()
      await expect(page.getByText(empty)).toBeVisible()
    }
    await expect(page.getByText('暂无来自合同、付款申请、支付或结算的附件')).toBeVisible()
  })

  test('不存在的父实体明确显示 not-found', async ({ page }) => {
    await page.goto('/project/proj_demo_002/supplier/supplier-missing?origin=demo&tab=overview')
    await expect(page.getByRole('status', { name: '未找到项目或分供方' })).toContainText('不存在或已删除')
  })

  test('关系错配、禁止与暂不可用明确分态', async ({ page }, testInfo) => {
    await page.goto('/project/proj_demo_001/supplier/sup_demo_004?origin=demo&tab=overview')
    await expect(page.getByRole('alert', { name: '项目与分供方关系不匹配' })).toBeVisible({ timeout: 20_000 })
    await reset(page.context().request, session(testInfo), 'forbidden')
    await page.goto(WORKBENCH)
    await expect(page.getByRole('status', { name: '无权查看项目分供方事实' })).toBeVisible()
    await reset(page.context().request, session(testInfo), 'unavailable')
    await page.goto(WORKBENCH)
    await expect(page.getByRole('alert', { name: '工作台加载失败' })).toContainText('暂时不可用')
  })

  test('工作台各宽度无页面级横滚，事实表仅自身横滚', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByTestId('project-supplier-header')).toBeVisible({ timeout: 20_000 })
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await expectNoPageOverflow(page, `#317 工作台 @ ${width}px`)
    }
    await page.getByRole('tab', { name: /^合同/ }).click()
    const table = page.getByLabel('业务记录表格，可横向滚动')
    await expect(table).toBeVisible()
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await expect(table).toBeVisible()
      await expectNoPageOverflow(page, `#317 合同事实 @ ${width}px`)
    }
  })
})
