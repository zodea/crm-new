import { expect, test } from '@playwright/test'

// #433 原 B 三态只读、实际来源往返与局部滚动已并入 payroll-central.spec.ts；
// Native 草稿保留/核对/发放由组件和领域回归保留，中央写流程依 P1–P3 接续验收。
test.describe('工资中央来源、筛选与退役写入口', () => {
  test('多状态浮层可用键盘关闭，真实新query与非法状态不复活旧筛选', async ({ page }) => {
    await page.goto('/subcontract/payroll?origin=real&status=%5B%22draft%22%2C%22checked%22%5D')
    const filter = page.getByRole('button', { name: '工资状态，已选 2 项', exact: true })
    await expect(filter).toBeVisible({ timeout: 30_000 })
    await filter.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '应用', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(filter).toBeFocused()
    await page.goto('/subcontract/payroll?origin=real&status=confirmed')
    await expect(page.getByRole('button', { name: '工资状态，已选 0 项', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '工资状态，已选 0 项', exact: true })).toBeVisible()
  })
  test('未选项目的来源往返保月份与工资状态，签工确认状态分开', async ({ page }) => {
    await page.goto('/subcontract/daywork?origin=real&month=2026-08&status=%5B%22draft%22%2C%22checked%22%5D&dayworkStatus=confirmed')
    await expect(page.getByRole('heading', { name: '零星签工', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('combobox', { name: '签工筛选项目', exact: true })).toHaveValue('')
    await expect(page.getByRole('checkbox', { name: '已确认', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: '待确认', exact: true })).not.toBeChecked()
    await page.getByRole('link', { name: '返回工资核算', exact: true }).click()
    await expect(page.getByRole('button', { name: '工资状态，已选 2 项', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('month')).toBe('2026-08')
    expect(new URL(page.url()).searchParams.get('crew')).toBeNull()
  })
  for (const { path, projectField } of [
    { path: '/subcontract/payroll', projectField: '项目' },
    { path: '/subcontract/attendance', projectField: null },
    { path: '/subcontract/daywork', projectField: null },
  ]) {
    test(`未知中央项目在${path}显示失效而不归一为首项`, async ({ page }) => {
      await page.goto(`${path}?origin=real&project=missing-payroll-project&crew=missing-crew&month=2026-08`)
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 })
      expect(new URL(page.url()).searchParams.get('project')).toBe('missing-payroll-project')
      if (path === '/subcontract/attendance') {
        await expect(page.getByRole('region', { name: '月度考勤矩阵', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '保存考勤', exact: true })).toHaveCount(0)
      }
      else if (projectField) {
        await expect(page.getByRole('combobox', { name: projectField, exact: true })).toHaveValue('missing-payroll-project')
      }
      await expect(page.getByRole('button', { name: /保存|确认签工|确认实际发放/ })).toHaveCount(0)
    })
  }
})
