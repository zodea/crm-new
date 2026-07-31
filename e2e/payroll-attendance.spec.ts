import { expect, test } from '@playwright/test'

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #198：工资与考勤生产工作台', () => {
  test('工资页明确三态和取数边界，建单不提供合同量', async ({ page }) => {
    await page.goto('/subcontract/payroll')
    await expect(page.getByRole('heading', { name: '工资核算' }).last()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/合同量仅用于收入、量差和毛利对照/)).toBeVisible()
    // 台账筛选是异步载入的，链接带上 query 才说明筛选已就绪。
    // 不等这一步就点，等于在载入中途导航，用例会偶发失败在 URL 上。
    const newDraft = page.getByRole('link', { name: '新建工资草稿' })
    await expect(newDraft).toHaveAttribute('href', /\/subcontract\/payroll\/new\?/)
    await newDraft.click()
    await expect(page).toHaveURL(/\/subcontract\/payroll\/new\?/)
    await expect(page.getByRole('heading', { name: '新建工资草稿' })).toBeVisible()
    const source = page.getByRole('combobox', { name: '工资取数口径' })
    await expect(source).toBeVisible()
    await expect(source.locator('option')).toHaveText(['暂估量', '现场复核量'])
    const format = page.getByRole('combobox', { name: '工资格式族' })
    await expect(format.locator('option[value="B"]')).toHaveAttribute('disabled', '')
    await expect(format.locator('option[value="C2"]')).not.toHaveAttribute('disabled', '')
    await format.selectOption('C2')
    await expect(page.getByLabel('C2 大工单价')).toBeVisible()
    await expect(source).toHaveValue('field')
    await expect(source).toBeDisabled()
    await expectDocumentDoesNotOverflow(page)
  })

  test('C2 使用独立逐日签工页，不复用考勤矩阵', async ({ page }) => {
    await page.goto('/subcontract/daywork')
    await expect(page.getByRole('heading', { name: '零星签工' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('form', { name: '新增签工记录' })).toBeVisible()
    await expect(page.getByLabel('用工数').locator('option')).toHaveText([
      '整工 · 1',
      '半工 · 0.5',
    ])
    await expect(page.getByText(/只有已确认记录会进入 C2 工资/)).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
  })

  test('真实完成草稿、核对、发放并持久化，重复期间受阻且次月不重复全量', async ({ page }) => {
    await page.goto('/subcontract/payroll')
    await expect(page.getByRole('heading', { name: '工资核算' }).last()).toBeVisible({ timeout: 20_000 })

    async function openDraft(month: string) {
      await page.goto('/subcontract/payroll')
      await expect(page.getByRole('heading', { name: '工资核算' }).last()).toBeVisible({ timeout: 20_000 })
      const toolbar = page.getByLabel('工资筛选与入口').locator(':scope > div').first()
      await toolbar.locator('select').first().selectOption('proj_demo_001')
      await toolbar.locator('input[type="month"]').fill(month)
      await page.getByRole('link', { name: '新建工资草稿' }).click()
      await expect(page.getByRole('heading', { name: '新建工资草稿' })).toBeVisible()
      await expect(page.getByRole('combobox', { name: '项目', exact: true })).toHaveValue('proj_demo_001')
      await page.getByRole('combobox', { name: '责任班组' }).selectOption('crew_demo_006')
      await expect(page.getByRole('combobox', { name: '请款负责人' }).locator('option[value="wkr_demo_007"]')).toHaveCount(1)
      await page.getByRole('combobox', { name: '请款负责人' }).selectOption('wkr_demo_007')
      await page.getByRole('combobox', { name: '工资取数口径' }).selectOption('field')
    }

    async function priceFirstLine(unitPrice: string) {
      const input = page.locator('input[aria-label$="工资单价"]').first()
      await expect(input).toBeVisible()
      await input.fill(unitPrice)
      await input.press('Tab')
      await expect(
        page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: '工资单价已更新' }),
      ).toBeVisible()
    }

    await openDraft('2026-07')
    await page.getByRole('button', { name: '生成工资草稿' }).click()
    const createOutcome = page
      .getByRole('heading', { name: '周伟峰请款簿' })
      .or(page.locator('[data-sonner-toast]'))
      .first()
    await expect(createOutcome).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '周伟峰请款簿' }),
      `工资草稿建单结果：${await createOutcome.textContent()}`,
    ).toBeVisible()
    await priceFirstLine('10')

    await page.getByRole('button', { name: '核对并锁定现场量' }).click()
    await expect(page.locator('.status-chip').filter({ hasText: '已核对' })).toHaveCount(1)
    await page.getByRole('button', { name: '填写发放分配' }).click()
    await expect(page.getByLabel('实际发放总额')).toBeVisible()
    const firstRelease = Number(await page.getByLabel('实际发放总额').inputValue())
    expect(firstRelease).toBeGreaterThan(0)
    await page.getByRole('button', { name: '确认已发放' }).click()
    await expect(page.getByText(/已按现场复核量快照发放/)).toBeVisible()
    await expect(page.getByRole('region', { name: '组内实际发放分配' })).toBeVisible()
    await expect(page.locator('.status-chip').filter({ hasText: '已发放' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '导出 Excel' })).toBeEnabled()
    await expect(page.locator('[data-payroll-print-page]')).toHaveCount(1)
    await page.evaluate(() => {
      Object.assign(window, { __payrollPrintCalls: 0 })
      window.print = () => {
        const state = window as Window & { __payrollPrintCalls: number }
        state.__payrollPrintCalls += 1
      }
    })
    await page.getByRole('button', { name: '打印 A4' }).click()
    expect(await page.evaluate(() => (
      window as Window & { __payrollPrintCalls: number }
    ).__payrollPrintCalls)).toBe(1)

    await page.reload()
    await page.getByLabel('工资筛选与入口').locator(':scope > div').first().locator('select').first().selectOption('proj_demo_001')
    await expect(page.getByText(/已按现场复核量快照发放/)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.status-chip').filter({ hasText: '已发放' })).toHaveCount(1)

    await openDraft('2026-07')
    await page.getByRole('button', { name: '生成工资草稿' }).click()
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText(
      /UNIQUE constraint failed|已存在/,
    )

    await openDraft('2026-08')
    await page.getByRole('button', { name: '生成工资草稿' }).click()
    await expect(page.getByText('2026-08 · 水电班')).toBeVisible()
    await priceFirstLine('10')
    await page.getByRole('button', { name: '核对并锁定现场量' }).click()
    await expect(page.locator('.status-chip').filter({ hasText: '已核对' })).toHaveCount(1)
    const releasedText = `¥${firstRelease.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
    await expect(page.getByText(`累计口径 ${releasedText} − 已发 ${releasedText}`)).toBeVisible()
    await expect(page.getByRole('button', { name: '填写发放分配' })).toBeDisabled()
  })

  test('真实保存一格考勤并在重新载入后回显', async ({ page }) => {
    await page.goto('/subcontract/attendance?project=proj_demo_001&month=2026-07')
    await expect(page.getByRole('heading', { name: '考勤管理' })).toBeVisible({ timeout: 20_000 })
    const grid = page.locator('[data-ui="attendance-grid-scroll"]')
    await expect(grid).toBeVisible()
    const cell = grid.locator('button:not([disabled])').first()
    const cellName = await cell.getAttribute('aria-label')
    expect(cellName).toBeTruthy()

    await cell.click()
    await page.getByRole('spinbutton', { name: '正常工时' }).fill('6.5')
    await page.getByRole('spinbutton', { name: '加班工时' }).fill('1')
    await page.getByRole('textbox', { name: '施工内容' }).fill('E2E 考勤持久化')
    await page.getByRole('button', { name: '保存考勤' }).click()
    await expect(page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: '考勤已保存' })).toBeVisible()
    await expect(page.getByRole('button', { name: cellName! })).toContainText('6.5')

    await page.reload()
    await expect(page.getByRole('heading', { name: '考勤管理' })).toBeVisible({ timeout: 20_000 })
    const persisted = page.getByRole('button', { name: cellName! })
    await expect(persisted).toContainText('6.5')
    await expect(persisted).toContainText('+1')
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    test(`${viewport.width}px 页面根节点不横滚，考勤矩阵在自身区域横滚`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/subcontract/attendance?project=proj_demo_001&month=2026-07')
      await expect(page.getByRole('heading', { name: '考勤管理' })).toBeVisible({ timeout: 20_000 })
      const grid = page.locator('[data-ui="attendance-grid-scroll"]')
      await expect(grid).toBeVisible()
      await expectDocumentDoesNotOverflow(page)
      const widths = await grid.evaluate(element => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }))
      expect(widths.scroll).toBeGreaterThan(widths.client)

      await page.goto('/subcontract/daywork')
      await expect(page.getByRole('heading', { name: '零星签工' })).toBeVisible({ timeout: 20_000 })
      await expectDocumentDoesNotOverflow(page)
    })
  }
})
