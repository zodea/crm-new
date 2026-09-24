import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'

test.describe('精确因子组合工作台', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/finance/invoice/factor', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('factor-workbench')).toBeVisible({ timeout: 45_000 })
  })

  test('精确求解、筛选和小数数量形成完整闭环', async ({ page }) => {
    const calculateButton = page.getByTestId('factor-calculate')
    const resultRows = page.locator('[data-testid="factor-workbench"] tbody tr')

    await expect(page.locator('#factor-target')).toHaveValue('128640')
    await expect(resultRows).toHaveCount(0)
    await calculateButton.click()
    await expect(resultRows).toHaveCount(68)
    await expect(page.getByText(/共 68 条解/)).toBeVisible()

    await page.locator('#factor-max-results').fill('1')
    await calculateButton.click()
    await expect(resultRows).toHaveCount(1)
    await expect(page.getByText('共 68 条解，已展示前 1 条', { exact: false })).toBeVisible()
    await page.locator('#factor-max-results').fill('100')

    await page.locator('#factor-include').fill('960')
    await expect(resultRows).toHaveCount(67)
    await expect(page.getByText(/共 67 条解/)).toBeVisible()

    await page.locator('#factor-include').fill('')
    await expect(resultRows).toHaveCount(68)

    await page.locator('#factor-target').fill('1.25')
    await expect(page.getByTestId('factor-result-target')).toContainText('128,640.00')
    await page.getByLabel('因子 1 的数值').fill('2.5')
    await page.getByLabel('因子 1 的最大数量').fill('1')
    await page
      .getByLabel('因子 1 的数值')
      .locator('..')
      .locator('input[type="checkbox"]')
      .check()
    await page.getByLabel('因子 2 的数值').fill('')
    await calculateButton.click()

    await expect(page.getByText('2.5×0.5(=1.25)', { exact: true }).first()).toBeVisible()

    await page.locator('#factor-target').fill('1.005')
    await page.getByLabel('因子 1 的数值').fill('1')
    await calculateButton.click()
    await expect(resultRows).toHaveCount(1)
    await expect(page.getByTestId('factor-result-target')).toHaveText('本轮目标 1.00')
    await expect(page.getByRole('button', { name: '复制价税合计', exact: true })).toContainText('1.00')
    await expect(resultRows.first()).toContainText('1×1')
  })

  test('短计算不会清空旧结果或闪烁可见 loading', async ({ page }) => {
    const calculateButton = page.getByTestId('factor-calculate')
    const resultRows = page.locator('[data-testid="factor-workbench"] tbody tr')

    await calculateButton.click()
    await expect(resultRows).toHaveCount(68)

    await page.evaluate(() => {
      const workbench = document.querySelector<HTMLElement>('[data-testid="factor-workbench"]')
      if (!workbench)
        throw new Error('factor workbench not found')

      const snapshots: Array<{ rows: number, buttonText: string, hasMask: boolean }> = []
      const collect = () => {
        snapshots.push({
          rows: workbench.querySelectorAll('tbody tr').length,
          buttonText: workbench.querySelector<HTMLElement>('[data-testid="factor-calculate"]')?.textContent?.trim() ?? '',
          hasMask: Boolean(workbench.querySelector('[role="status"]')),
        })
      }
      const observer = new MutationObserver(collect)
      observer.observe(workbench, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      })
      collect()
      Reflect.set(window, '__factorFlickerProbe', { observer, snapshots })
    })

    await calculateButton.click()
    await page.waitForTimeout(250)

    const snapshots = await page.evaluate(() => {
      const probe = Reflect.get(window, '__factorFlickerProbe') as {
        observer: MutationObserver
        snapshots: Array<{ rows: number, buttonText: string, hasMask: boolean }>
      }
      probe.observer.disconnect()
      return probe.snapshots
    })

    expect(snapshots.some(snapshot => snapshot.rows === 0)).toBe(false)
    expect(snapshots.some(snapshot => snapshot.buttonText === '计算中')).toBe(false)
    expect(snapshots.some(snapshot => snapshot.hasMask)).toBe(false)
  })

  test('税额计算准确且配置刷新后仍然保留', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.locator('#factor-target').fill('597140')
    await page.locator('#factor-tax-rate').fill('13')

    await expect(page.getByText('528,442.48', { exact: true })).toBeVisible()
    await expect(page.getByText('伍拾玖万柒仟壹佰肆拾元整', { exact: true })).toBeVisible()

    const taxRateInput = page.locator('#factor-tax-rate')
    await taxRateInput.fill('0')
    await expect(taxRateInput).toHaveValue('1')
    await taxRateInput.fill('14')
    await expect(taxRateInput).toHaveValue('13')
    await taxRateInput.fill('1.5')
    await expect(taxRateInput).toHaveValue('13')
    await taxRateInput.fill('')
    await expect(page.getByRole('alert')).toHaveText('税率请输入 1-13 的正整数')

    await page.locator('#factor-target').fill('12.34')
    await page.getByLabel('因子 1 的数值').fill('3.21')
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('sum-solver-state')))
      .toContain('12.34')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('#factor-target')).toHaveValue('12.34')
    await expect(page.getByLabel('因子 1 的数值')).toHaveValue('3.21')
    expect(pageErrors, '因子工作台不应产生客户端运行时错误').toEqual([])
  })

  test('超长税额金额与人民币大写保持稳定对齐', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('#factor-target').fill('999999999999.99')
    await page.locator('#factor-tax-rate').fill('13')

    const resultItems = page.getByTestId('tax-result-item')
    await expect(resultItems).toHaveCount(4)

    const itemMetrics = await resultItems.evaluateAll(items => items.map((item) => {
      const itemRect = item.getBoundingClientRect()
      return {
        hasOverflow: item.scrollWidth > item.clientWidth,
        height: itemRect.height,
        y: itemRect.y,
      }
    }))

    expect(itemMetrics.every(metric => !metric.hasOverflow)).toBe(true)
    expect(Math.max(...itemMetrics.map(metric => metric.height)) - Math.min(...itemMetrics.map(metric => metric.height))).toBeLessThanOrEqual(1)
    expect(new Set(itemMetrics.map(metric => metric.y)).size).toBe(1)
  })

  test('大量组合仅在结果区滚动且工作台不超出可视高度', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByLabel('因子 1 的数值').fill('2')
    await page.getByLabel('因子 2 的数值').fill('4')
    await page.getByLabel('因子 2 的最大数量').fill('5')
    await page.getByRole('button', { name: '添加因子' }).click()
    await page.getByLabel('因子 3 的数值').fill('1')
    await page.locator('#factor-target').fill('100')
    await page.locator('#factor-max-results').fill('500')
    await page.getByTestId('factor-calculate').click()

    const resultRows = page.locator('[data-testid="factor-workbench"] tbody tr')
    await expect(resultRows).toHaveCount(276)

    const metrics = await page.evaluate(() => {
      const workbench = document.querySelector<HTMLElement>('[data-testid="factor-workbench"]')
      const resultScroller = document.querySelector<HTMLElement>('[data-testid="factor-results-scroll"]')
      const workbenchRect = workbench?.getBoundingClientRect()
      return {
        workbenchBottom: workbenchRect?.bottom ?? Number.POSITIVE_INFINITY,
        viewportHeight: window.innerHeight,
        resultClientHeight: resultScroller?.clientHeight ?? Number.POSITIVE_INFINITY,
        resultScrollHeight: resultScroller?.scrollHeight ?? 0,
        resultOverflowY: resultScroller ? getComputedStyle(resultScroller).overflowY : '',
      }
    })

    expect(metrics.workbenchBottom).toBeLessThanOrEqual(metrics.viewportHeight)
    expect(metrics.resultClientHeight).toBeLessThan(metrics.resultScrollHeight)
    expect(metrics.resultOverflowY).toBe('auto')
  })

  test('共用金额、四格键盘复制与五档布局', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByTestId('factor-calculate').click()
    await expect(page.locator('[data-testid="factor-results-panel"] tbody tr')).toHaveCount(68)
    for (const [label, expected] of [['价税合计', '128640.00'], ['不含税金额', '113840.71'], ['税额', '14799.29'], ['大写', '壹拾贰万捌仟陆佰肆拾元整']]) {
      const cell = page.getByRole('button', { name: `复制${label}`, exact: true })
      await cell.focus()
      await expect(cell).toBeFocused()
      await page.keyboard.press('Enter')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
    }
    await expect(page.getByText('已复制', { exact: true })).toHaveCount(0, { timeout: 15_000 })
    await page.locator('#factor-target').focus()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const panels = await page.evaluate(() => {
        const rect = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect().toJSON()
        const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')!
        return { tax: rect('factor-tax-panel'), config: rect('factor-config-panel'), results: rect('factor-results-panel'), pageOverflow: document.documentElement.scrollWidth > innerWidth, workspaceOverflow: workspace.scrollWidth > workspace.clientWidth }
      })
      expect(panels.pageOverflow).toBe(false)
      expect(panels.workspaceOverflow).toBe(false)
      expect(panels.tax.bottom).toBeLessThanOrEqual(panels.config.top)
      if (width >= 1024)
        expect(panels.results.left).toBeGreaterThan(panels.config.right)
      else
        expect(panels.results.top).toBeGreaterThan(panels.config.bottom)
      const screenshotDir = process.env.CRM_EVIDENCE_DIR
      if (screenshotDir) {
        mkdirSync(screenshotDir, { recursive: true })
        await page.screenshot({ path: join(screenshotDir, `factor-workbench-${width}.png`), fullPage: true })
      }
    }
    const help = page.getByRole('button', { name: '查看因子求解说明' })
    await help.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText(/已计算后，包含或排除条件变化会自动重算/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(help).toBeFocused()
    await page.locator('#factor-target').fill('1280')
    await expect(page.getByRole('button', { name: '复制价税合计', exact: true })).toContainText('1,280.00')
    await page.getByTestId('factor-calculate').click()
    await expect(page.getByTestId('factor-result-target')).toContainText('1,280.00')
    await expect(page.locator('[data-testid="factor-results-panel"] tbody tr')).toHaveCount(1)
  })

  test('已保存旧配置和用户清空的配置在刷新后保留', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('sum-solver-state', JSON.stringify({ target: 10, maxResults: 25, factors: [{ id: 1, f: 2, m: null, d: false }, { id: 2, f: 4, m: 5, d: false }] })))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('#factor-target')).toHaveValue('10')
    await expect(page.locator('#factor-max-results')).toHaveValue('25')
    await page.getByTestId('factor-calculate').click()
    await expect(page.locator('[data-testid="factor-results-panel"] tbody tr')).toHaveCount(3)
    await page.locator('#factor-target').fill('')
    await page.locator('#factor-max-results').fill('')
    await page.getByRole('button', { name: '删除因子 1', exact: true }).click()
    await page.getByRole('button', { name: '删除因子 2', exact: true }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sum-solver-state')!).factors)).toEqual([])
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('#factor-target')).toHaveValue('')
    await expect(page.locator('#factor-max-results')).toHaveValue('')
    await expect(page.getByText('暂无因子，点击“添加因子”开始配置')).toBeVisible()
    await expect(page.getByTestId('factor-calculate')).toBeDisabled()
  })
})
