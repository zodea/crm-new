import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { updateProductionSnapshot } from './helpers/browser-production-snapshot'

const scope = { project: 'payroll-e2e-project', month: '2025-11', crew: 'payroll-e2e-crew', status: '["draft","checked","released"]' }
const viewports = [390, 768, 1024, 1280, 1440]

async function installFixture(page: Page) {
  await page.goto('/subcontract/payroll')
  await expect(page.getByRole('region', { name: '工资单列表' })).toBeVisible({ timeout: 60_000 })
  await updateProductionSnapshot(page, (database) => {
    database.run(`
      INSERT INTO projects (id, name, code, source) VALUES
        ('payroll-e2e-project', '工资验证项目', 'PAYROLL-E2E', 'e2e-production-fixture'),
        ('payroll-e2e-other', '工资另一项目', 'PAYROLL-OTHER', 'e2e-production-fixture');
      INSERT INTO crews (id, name, trade) VALUES ('payroll-e2e-crew', '工资验证班组', '泥水工');
      INSERT INTO workers (id, name, crew_id, trade, current_project_id, daily_wage)
        VALUES ('worker-other', '另一项目工人', 'payroll-e2e-crew', '泥水工', 'payroll-e2e-other', 480);
    `)
    for (const [id, name, family, status] of [
      ['c1', '考勤验证工人', 'C1', 'draft'],
      ['b-draft', '历史草稿负责人', 'B', 'draft'],
      ['b-checked', '历史核对负责人', 'B', 'checked'],
      ['b-released', '历史已发负责人', 'B', 'released'],
    ]) {
      const amount = family === 'C1' ? 450 : 200
      database.run(`INSERT INTO workers (id, name, crew_id, trade, current_project_id, daily_wage)
        VALUES (?, ?, 'payroll-e2e-crew', '泥水工', 'payroll-e2e-project', 480)`, [`worker-${id}`, name!])
      database.run(`INSERT INTO wage_statements (
        id, project_id, crew_id, leader_worker_id, month, purpose, format_family, period_kind,
        quantity_source, status, pay_ratio, cumulative_amount, gross_amount, actual_amount, source_version
      ) VALUES (?, 'payroll-e2e-project', 'payroll-e2e-crew', ?, '2025-11', 'advance', ?, 'monthly',
        'field', ?, 1, ?, ?, ?, 'e2e-original-source')`, [
        id!,
        `worker-${id}`,
        family!,
        status!,
        amount,
        amount,
        status === 'released' ? 180 : null,
      ])
      database.run(`INSERT INTO wage_statement_members (id, statement_id, worker_id, is_leader)
        VALUES (?, ?, ?, 1)`, [`member-${id}`, id!, `worker-${id}`])
      database.run(`INSERT INTO wage_statement_lines (id, statement_id, worker_id, item_name, unit, quantity, unit_price, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        `line-${id}`,
        id!,
        `worker-${id}`,
        family === 'C1' ? '正常日工' : '历史工资明细',
        family === 'C1' ? '天' : '㎡',
        family === 'C1' ? 0.9375 : 10,
        family === 'C1' ? 480 : 20,
        amount,
      ])
    }
    database.run(`INSERT INTO attendance_records (id, project_id, crew_id, worker_id, work_date, hours, overtime_hours, work_content)
      VALUES ('attendance-c1', 'payroll-e2e-project', 'payroll-e2e-crew', 'worker-c1', '2025-11-03', 7.5, 0, '核对真实考勤')`)
  })
  await page.reload()
  await page.goto(`/subcontract/payroll?${new URLSearchParams(scope)}`)
  await expect(page.getByRole('region', { name: '工资单列表' }).getByText('考勤验证工人', { exact: true })).toBeVisible({ timeout: 30_000 })
}

function expectScope(url: string, expected = scope) {
  expect(Object.fromEntries(new URL(url).searchParams)).toEqual(expected)
}

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1)
}

test.describe('Issue #433 工资来源和退役入口', () => {
  test.setTimeout(120_000)
  test('工资详情与考勤签工往返恢复原筛选，五档保留局部滚动与键盘入口', async ({ page }, testInfo) => {
    await installFixture(page)
    const statementTable = page.getByRole('region', { name: '工资单列表' })
    await expect(statementTable).toContainText('真实考勤')
    await statementTable.locator('a[href^="/subcontract/payroll/c1?"]:visible').first().click()
    await expect(page.getByRole('heading', { name: '考勤验证工人请款簿' })).toBeVisible()
    expectScope(page.url())
    await expect(page.getByRole('region', { name: '请款簿基本信息' })).toContainText('真实考勤')
    await expect(page.getByRole('columnheader', { name: '考勤数量' })).toBeVisible()
    const back = page.getByRole('link', { name: '返回工资核算', exact: true }).first()
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 })
      await noOverflow(page)
      if (width <= 768) {
        const locallyScrollable = await page.getByRole('region', { name: '工资核算明细', exact: true }).evaluate(root =>
          [...root.querySelectorAll<HTMLElement>('*')].some(element =>
            element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(element).overflowX),
          ),
        )
        expect(locallyScrollable).toBe(true)
      }
      await back.focus()
      await expect(back).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`c1-detail-${width}.png`), fullPage: true })
      await page.getByRole('region', { name: '工资核算明细', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`c1-lines-${width}.png`), fullPage: true })
    }
    await back.click()
    await expect(page.getByRole('region', { name: '工资单列表' })).toBeVisible()
    expectScope(page.url())
    await page.getByRole('link', { name: '打开考勤', exact: true }).click()
    expectScope(page.url())
    await page.getByRole('link', { name: '零星签工', exact: true }).click()
    const toolbar = page.getByRole('region', { name: '签工筛选' })
    await expect(toolbar.locator('select').first()).toHaveValue(scope.project)
    await expect(toolbar.locator('input[type="month"]')).toHaveValue(scope.month)
    await expect(toolbar.locator('select').nth(1)).toHaveValue(scope.crew)
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 })
      await noOverflow(page)
      const returnLink = page.getByRole('link', { name: '返回工资核算', exact: true })
      await returnLink.focus()
      await expect(returnLink).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`daywork-${width}.png`), fullPage: true })
    }
    await page.getByRole('link', { name: '返回工资核算', exact: true }).click()
    expectScope(page.url())
  })

  test('历史 B 三态均只读，新建只提供 A/C1/C2', async ({ page }, testInfo) => {
    await installFixture(page)
    for (const id of ['b-draft', 'b-checked', 'b-released']) {
      // vxe 固定列会复制同一业务行；只点击该业务行当前可见的预览按钮。
      await page.getByRole('region', { name: '工资单列表' }).locator(`tr[rowid="${id}"] button:visible`).first().click()
      const detail = page.getByRole('region', { name: '工资单详情', exact: true })
      await expect(detail).toContainText('B 类工资已退役，历史记录只读')
      await expect(detail.getByRole('spinbutton')).toHaveCount(0)
      await expect(detail.getByRole('button', { name: /核对|发放|打印|导出/ })).toHaveCount(0)
      await expect(detail).toContainText('200.00')
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await noOverflow(page)
    await page.getByRole('region', { name: '工资单详情', exact: true }).getByRole('status').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('legacy-b-390.png'), fullPage: true })
    await page.getByRole('link', { name: '新建工资草稿', exact: true }).click()
    const format = page.getByRole('combobox', { name: '工资格式族' })
    await expect(format.locator('option')).toHaveText(['A · 户型派生', 'C1 · 月薪时工', 'C2 · 零星签工'])
    await format.selectOption('C1')
    await expect(page.getByRole('combobox', { name: '工资取数口径' }).locator('option')).toHaveText(['真实考勤'])
    await noOverflow(page)
    await page.getByRole('combobox', { name: '工资取数口径' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('c1-draft-390.png'), fullPage: true })
  })

  test('缓存页签同范围保留草稿，换来源后签工、考勤和工资应用新范围', async ({ page }) => {
    await installFixture(page)
    await page.getByRole('link', { name: '录入零星签工', exact: true }).click()
    const toolbar = page.getByRole('region', { name: '签工筛选' })
    await expect(toolbar.locator('select').first()).toHaveValue(scope.project)
    await page.getByLabel('证明人', { exact: true }).fill('未保存的证明人')
    await page.getByRole('link', { name: '返回工资核算', exact: true }).click()
    await page.getByRole('link', { name: '录入零星签工', exact: true }).click()
    await expect(page.getByLabel('证明人', { exact: true })).toHaveValue('未保存的证明人')
    await page.getByRole('link', { name: '打开考勤', exact: true }).click()
    await expect(page.locator('[data-ui="attendance-screen"] select').first()).toHaveValue(scope.project)
    await page.getByRole('link', { name: '工资核算', exact: true }).last().click()
    const filters = page.getByRole('region', { name: '工资筛选与入口' })
    await filters.locator('select').first().selectOption('payroll-e2e-other')
    await filters.locator('input[type="month"]').fill('2025-12')
    await filters.getByRole('button', { name: '状态，已选 3 项', exact: true }).click()
    await page.getByRole('checkbox', { name: '草稿', exact: true }).click()
    await page.getByRole('checkbox', { name: '已发放', exact: true }).click()
    await page.getByRole('button', { name: '应用', exact: true }).click()
    const changed = { ...scope, project: 'payroll-e2e-other', month: '2025-12', status: '["checked"]' }
    await page.getByRole('link', { name: '录入零星签工', exact: true }).click()
    await expect(toolbar.locator('select').first()).toHaveValue(changed.project)
    await expect(toolbar.locator('input[type="month"]')).toHaveValue(changed.month)
    await page.getByRole('link', { name: '打开考勤', exact: true }).click()
    await expect(page.locator('[data-ui="attendance-screen"] select').first()).toHaveValue(changed.project)
    await expect(page.locator('[data-ui="attendance-screen"] input[type="month"]')).toHaveValue(changed.month)
    await page.getByRole('link', { name: '零星签工', exact: true }).click()
    await toolbar.locator('input[type="month"]').fill('2026-01')
    await page.getByRole('link', { name: '返回工资核算', exact: true }).click()
    await expect(filters.locator('select').first()).toHaveValue(changed.project)
    await expect(filters.locator('input[type="month"]')).toHaveValue('2026-01')
    expectScope(page.url(), { ...changed, month: '2026-01' })
  })

  test('缓存签工与考勤接收全部班组及空工资状态，不复活上次筛选', async ({ page }) => {
    await installFixture(page)
    await page.getByRole('link', { name: '录入零星签工', exact: true }).click()
    await page.getByRole('link', { name: '打开考勤', exact: true }).click()
    await page.getByRole('link', { name: '工资核算', exact: true }).last().click()
    const filters = page.getByRole('region', { name: '工资筛选与入口' })
    await filters.locator('select').nth(1).selectOption('')
    // 通过公开 URL 恢复空状态，保留真实 KeepAlive 页面实例。
    await page.evaluate((query) => {
      window.history.pushState({}, '', `/subcontract/payroll?${new URLSearchParams(query)}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, { project: scope.project, month: scope.month, status: '' })
    await expect(filters.getByRole('button', { name: '状态，已选 0 项', exact: true })).toBeVisible()
    await expect(filters.locator('select').nth(1)).toHaveValue('')
    await page.getByRole('link', { name: '录入零星签工', exact: true }).click()
    await expect(page.getByRole('region', { name: '签工筛选' }).locator('select').nth(1)).toHaveValue('')
    await page.getByRole('link', { name: '打开考勤', exact: true }).click()
    await expect(page.locator('[data-ui="attendance-screen"] select').nth(1)).toHaveValue('')
    await page.getByRole('link', { name: '工资核算', exact: true }).last().click()
    await expect(filters.locator('select').nth(1)).toHaveValue('')
    await expect(filters.getByRole('button', { name: '状态，已选 0 项', exact: true })).toBeVisible()
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ project: scope.project, month: scope.month })
  })

  test('未知项目与班组深链在工资、考勤和签工都归一为当前有效选项', async ({ page }) => {
    await installFixture(page)
    for (const [path, toolbar] of [
      ['/subcontract/payroll', '[aria-label="工资筛选与入口"]'],
      ['/subcontract/attendance', '[data-ui="attendance-toolbar"]'],
      ['/subcontract/daywork', '[aria-label="签工筛选"]'],
    ]) {
      await page.goto(`${path}?project=missing&crew=missing&month=2025-11&status=unknown`)
      await expect(page.locator(`${toolbar} select`).first()).toHaveValue('payroll-e2e-other')
      await expect(page.locator(`${toolbar} select`).nth(1)).toHaveValue('')
      await expect(page.locator(`${toolbar} input[type="month"]`)).toHaveValue('2025-11')
    }
  })
})
