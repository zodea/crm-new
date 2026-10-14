import type { Locator, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectInViewport,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  expectTabSequence,
  RESPONSIVE_WIDTHS,
  tabUntilFocused,
} from './helpers/responsive'

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
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(`/project/${input.projectId}?origin=demo`)
      await expect(page.getByRole('heading', { name: input.project, exact: true })).toBeVisible()
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
