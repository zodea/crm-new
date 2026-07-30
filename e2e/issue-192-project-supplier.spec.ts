import type { Locator, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectInViewport,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  expectTabSequence,
  RESPONSIVE_WIDTHS,
  tabUntilFocused,
} from './helpers/responsive'

const PROJECT_ID = 'proj_demo_001'
const EXISTING_SUPPLIER_ID = 'sup_demo_001'
const PROJECT_PATH = `/project/${PROJECT_ID}`
const WORKBENCH_PATH = `${PROJECT_PATH}/supplier/${EXISTING_SUPPLIER_ID}`

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

async function waitForWorkbench(page: Page) {
  await expect(page.getByText('项目 × 分供方工作台', { exact: true }))
    .toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', {
    name: /合和新城.*广州市大板东建材有限公司/,
  })).toBeVisible()
  await expect(page.getByText('正在读取权威业务表', { exact: true }))
    .toHaveCount(0)
}

async function expectHorizontalScrollOwner(locator: Locator, context: string) {
  const overflowX = await locator.evaluate(element => getComputedStyle(element).overflowX)
  expect(overflowX, `${context} 应由业务表格自身承载横向滚动`).toMatch(/auto|scroll/)
}

test.describe('Issue #192：项目×分供方工作台与文件导入', () => {
  test('从项目详情进入工作台，真实合同源单穿透后返回保持合同页签', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(PROJECT_PATH)
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible({ timeout: 20_000 })

    const supplierPanel = page.getByRole('region', { name: '项目分供方' })
    await expect(supplierPanel).toBeVisible({ timeout: 20_000 })
    await supplierPanel.getByRole('link', {
      name: '广州市大板东建材有限公司',
      exact: true,
    }).click()

    await waitForWorkbench(page)
    await page.getByRole('tab', { name: /合同/ }).click()
    await expect(page).toHaveURL(`${WORKBENCH_PATH}?tab=contract`)

    const contractSummary = page.getByText('变更后合同额', { exact: true }).locator('..')
    await expect(contractSummary).toContainText('¥1,525,000.00')

    const contractRow = page.getByRole('row', { name: /钢筋采购合同/ })
    await expect(contractRow).toContainText('RJ-HHXC-CG-2025002')
    await contractRow.getByRole('link', { name: '查看源单', exact: true }).click()
    await expect(page).toHaveURL('/contract/con_demo_cg02')
    await expect(page.getByRole('heading', { name: /钢筋采购合同/ })).toBeVisible()

    await page.goBack()
    await waitForWorkbench(page)
    await expect(page).toHaveURL(`${WORKBENCH_PATH}?tab=contract`)
    await expect(page.getByRole('tab', { name: /合同/ }))
      .toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('row', { name: /钢筋采购合同/ })).toBeVisible()
  })

  test('三步文件导入可复用已有关系、确认新候选并在工作台读取持久化文件', async ({ page }) => {
    const uniqueSuffix = Date.now().toString(36)
    const existingFileName = `大板东-付款回单-${uniqueSuffix}.pdf`
    const candidateFileName = `E2E新候选供应商${uniqueSuffix}-资质.pdf`
    const candidateName = `E2E 新候选分供方 ${uniqueSuffix}`

    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(PROJECT_PATH)
    await page.getByRole('region', { name: '项目分供方' })
      .getByRole('link', { name: /从文件导入分供方/ })
      .click()
    await expect(page).toHaveURL(`${PROJECT_PATH}/supplier/import`)
    await expect(page.getByRole('heading', { name: '项目分供方文件导入' }))
      .toBeVisible()

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '选择文件', exact: true }).click()
    const chooser = await chooserPromise
    await chooser.setFiles([
      {
        name: existingFileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 existing relationship'),
      },
      {
        name: candidateFileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 new candidate'),
      },
    ])

    await expect(page.getByRole('cell', { name: existingFileName, exact: true }))
      .toBeVisible()
    await expect(page.getByRole('cell', { name: candidateFileName, exact: true }))
      .toBeVisible()
    await page.getByRole('button', { name: '下一步：自动分类' }).click()

    const existingArticle = page.locator('article').filter({ hasText: existingFileName })
    await expect(existingArticle.getByRole('combobox', { name: /分供方/ }))
      .toHaveValue(EXISTING_SUPPLIER_ID)
    await expect(existingArticle).toContainText('已有项目关系，只追加文件')
    await existingArticle.getByRole('combobox', { name: /文件类别/ })
      .selectOption('付款')

    const candidateArticle = page.locator('article').filter({ hasText: candidateFileName })
    const candidateInput = candidateArticle.getByRole('textbox', {
      name: /新分供方名称/,
    })
    await candidateInput.fill(candidateName)
    const candidateConfirmation = candidateArticle.getByRole('checkbox')
    await candidateConfirmation.focus()
    await page.keyboard.press('Space')
    await expect(candidateConfirmation).toBeChecked()

    const goToConfirmation = page.getByRole('button', {
      name: '下一步：确认生成',
    })
    await tabUntilFocused(page, goToConfirmation)
    await page.keyboard.press('Enter')

    await expect(page.getByText(candidateName, { exact: true })).toBeVisible()
    await expect(page.getByText('复用已有关系', { exact: true })).toBeVisible()
    await expect(page.getByText('新建主数据', { exact: true })).toBeVisible()
    await expect(page.getByText(existingFileName, { exact: true })).toBeVisible()
    await expect(page.getByText(candidateFileName, { exact: true })).toBeVisible()

    const confirmImport = page.getByRole('button', {
      name: '确认生成并返回项目',
    })
    await tabUntilFocused(page, confirmImport)
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(`${PROJECT_PATH}?tab=expenditure`)
    const supplierPanel = page.getByRole('region', { name: '项目分供方' })
    await expect(supplierPanel.getByRole('link', {
      name: candidateName,
      exact: true,
    })).toBeVisible()

    await supplierPanel.getByRole('link', {
      name: candidateName,
      exact: true,
    }).click()
    await expect(page.getByText('项目 × 分供方工作台', { exact: true }))
      .toBeVisible()
    await expect(page.getByText(candidateFileName, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(candidateFileName, { exact: true }))
      .toBeVisible({ timeout: 20_000 })

    await page.goto(`${WORKBENCH_PATH}?tab=contract`)
    await waitForWorkbench(page)
    const importedFile = page.getByText(existingFileName, { exact: true })
    await expect(importedFile).toBeVisible()
    await expect(importedFile.locator('xpath=ancestor::div[contains(@class,"grid")][1]'))
      .toContainText('付款')
  })

  for (const viewport of RESPONSIVE_CASES) {
    test(`${viewport.label} 工作台和导入向导无页面横滚，业务表格局部滚动且键盘可达`, async ({ page }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })

      await page.goto(`${WORKBENCH_PATH}?tab=contract`)
      await waitForWorkbench(page)
      await expectNoPageOverflow(page, `${viewport.label} 项目分供方工作台`)

      const tableScroller = contractTableScroller(page)
      await expect(tableScroller).toBeVisible()
      await expectHorizontalScrollOwner(
        tableScroller,
        `${viewport.label} 项目分供方合同表`,
      )
      if (viewport.width <= 768) {
        await expectLocalHorizontalScroll(
          tableScroller,
          `${viewport.label} 项目分供方合同表`,
        )
      }

      const refresh = page.getByRole('button', { name: '刷新', exact: true })
      await tabUntilFocused(page, refresh)
      await expectInViewport(refresh, `${viewport.label} 工作台刷新`)

      const contractTab = page.getByRole('tab', { name: /合同/ })
      await tabUntilFocused(page, contractTab)
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('tab', { name: /请款/ }))
        .toHaveAttribute('aria-selected', 'true')
      await expect(page).toHaveURL(`${WORKBENCH_PATH}?tab=claim`)
      await expectNoPageOverflow(page, `${viewport.label} 工作台键盘切换页签`)

      await page.goto(`${PROJECT_PATH}/supplier/import`)
      await expect(page.getByRole('heading', { name: '项目分供方文件导入' }))
        .toBeVisible()
      await expectNoPageOverflow(page, `${viewport.label} 项目分供方导入向导`)

      const chooseFiles = page.getByRole('button', {
        name: '选择文件',
        exact: true,
      })
      const chooseFolder = page.getByRole('button', {
        name: '选择文件夹',
        exact: true,
      })
      await expectTabSequence(
        page,
        chooseFiles,
        [chooseFolder],
        `${viewport.label} 导入向导文件操作`,
      )
      await expectInViewport(chooseFolder, `${viewport.label} 选择文件夹操作`)
    })
  }
})
