import type { Page, TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { payrollC1Workspace } from './helpers/payroll-c1-workspace'

test.use({ actionTimeout: 15000 })
async function evidence(page: Page, info: TestInfo, name: string) {
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
}

test('原考勤保存失败保稿、冷页原编号恢复与切月份迟到读取', async ({ page }, info) => {
  test.setTimeout(150000)
  const { repository, project, leader } = await payrollC1Workspace(page, '2026-10')
  const url = `/subcontract/attendance?${new URLSearchParams({ origin: 'real', project: project.id, month: '2026-10', crew: leader.crewId || '' })}`
  await page.goto(url)
  await page.getByRole('button', { name: '日薪481负责人 2026-10-03 考勤', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('正常工时', { exact: true }).fill('7.51')
  await dialog.getByLabel('施工内容', { exact: true }).fill('冷页恢复仍是原日期原输入')
  let original = ''
  await page.route('**/api/commands/payroll-attendance', async (route) => {
    if (!original) {
      original = route.request().postDataJSON().commandId
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收：暂时无法确认写入' }) })
    }
    else {
      await route.continue()
    }
  })
  await dialog.getByRole('button', { name: '保存考勤', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('正常工时', { exact: true })).toHaveValue('7.51')
  await evidence(page, info, 'attendance-failed-original-input')
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '打开原提交', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('正常工时', { exact: true })).toHaveValue('7.51')
  await expect(dialog.getByLabel('施工内容', { exact: true })).toHaveValue('冷页恢复仍是原日期原输入')
  const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-attendance') && request.postDataJSON()?.commandId === original)
  await dialog.getByRole('button', { name: '核对原提交', exact: true }).click()
  await replay
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.unroute('**/api/commands/payroll-attendance')
  const refreshed = await repository.attendanceMatrix({ origin: 'real' }, { projectId: project.id, month: '2026-10', crewId: leader.crewId })
  expect(refreshed.records.filter(record => record.workerId === leader.id && record.workDate === '2026-10-03')).toMatchObject([{ hours: 7.51, workContent: '冷页恢复仍是原日期原输入' }])

  let releaseOld!: () => void
  const gate = new Promise<void>(resolve => releaseOld = resolve)
  let started!: () => void
  const oldStarted = new Promise<void>(resolve => started = resolve)
  await page.route('**/api/read/payroll/attendance?**', async (route) => {
    const scope = JSON.parse(new URL(route.request().url()).searchParams.get('scope') || '{}')
    if (scope.month === '2026-11') {
      const response = await route.fetch()
      started()
      await gate
      await route.fulfill({ response })
    }
    else {
      await route.continue()
    }
  })
  await page.getByLabel('考勤月份', { exact: true }).fill('2026-11')
  await page.getByLabel('考勤月份', { exact: true }).blur()
  await oldStarted
  await page.getByLabel('考勤月份', { exact: true }).fill('2026-12')
  await page.getByLabel('考勤月份', { exact: true }).blur()
  await expect(page.getByRole('button', { name: '日薪481负责人 2026-12-31 考勤', exact: true })).toBeVisible()
  const oldFinished = page.waitForResponse(response => response.url().includes('/api/read/payroll/attendance?') && JSON.parse(new URL(response.url()).searchParams.get('scope') || '{}').month === '2026-11')
  releaseOld()
  await oldFinished
  await page.unroute('**/api/read/payroll/attendance?**')
  await expect(page.getByLabel('考勤月份', { exact: true })).toHaveValue('2026-12')
  await expect(page.getByRole('button', { name: '日薪481负责人 2026-11-30 考勤', exact: true })).toHaveCount(0)
  await evidence(page, info, 'attendance-late-read-current-month')
  await writeFile(info.outputPath('recovery-result.json'), JSON.stringify({ originalCommand: original, projectId: project.id, date: '2026-10-03', currentMonth: '2026-12', hours: 7.51 }, null, 2))
})

test('个人标准保存失响应后冷页仍按原编号确认，不覆盖原配置空值', async ({ page }, info) => {
  test.setTimeout(120000)
  const { repository, project, leader } = await payrollC1Workspace(page, '2026-11')
  const url = `/subcontract/payroll/config?${new URLSearchParams({ origin: 'real', format: 'C1', project: project.id, month: '2026-11', crew: leader.crewId || '' })}`
  const before = await repository.c1Config({ origin: 'real' }, { projectId: project.id, month: '2026-11', crewId: leader.crewId })
  const previous = before.rates.find(rate => rate.workerId === leader.id)!
  expect(previous.configuredDailyWage).toBeNull()
  const overtimeRate = previous.configuredOvertimeRate === 54 ? 53 : 54
  await page.goto(url)
  await expect(page.getByLabel('日薪481负责人兜底日薪', { exact: true })).toHaveValue('')
  await page.getByLabel('日薪481负责人加班价', { exact: true }).fill(String(overtimeRate))
  let original = ''
  await page.route('**/api/commands/payroll-c1', async (route) => {
    if (!original && route.request().postDataJSON()?.action.kind === 'save-c1-rates') {
      original = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('failed')
    }
    else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: '保存个人标准', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  // 整页写态不自动恢复；冷启动后明确重开原配置，原命令仍由相同会话和范围恢复。
  await expect(page).not.toHaveURL(url)
  await page.goto(url)
  await expect(page.getByLabel('日薪481负责人加班价', { exact: true })).toHaveValue(String(overtimeRate))
  await expect(page.getByLabel('日薪481负责人兜底日薪', { exact: true })).toHaveValue('')
  await expect(page.locator('#section-scope').getByText(project.name!, { exact: true })).toBeVisible()
  const originalCrew = before.options.crews.find(crew => crew.id === leader.crewId)
  expect(originalCrew?.name).toBeTruthy()
  await expect(page.locator('#section-scope').getByText(originalCrew!.name!, { exact: true })).toBeVisible()
  await evidence(page, info, 'c1-config-cold-original-pending')
  const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-c1') && request.postDataJSON()?.commandId === original)
  await page.getByRole('button', { name: '核对原提交', exact: true }).click()
  await replay
  await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存个人标准', exact: true })).toBeDisabled()
  const read = await repository.c1Config({ origin: 'real' }, { projectId: project.id, month: '2026-11', crewId: leader.crewId })
  expect(read.rates.find(rate => rate.workerId === leader.id)).toMatchObject({ profileDailyWage: 481, configuredDailyWage: null, configuredOvertimeRate: overtimeRate, overtimeRate })
  await writeFile(info.outputPath('config-recovery-result.json'), JSON.stringify({ originalCommand: original, projectId: project.id, month: '2026-11', configuredDailyWage: null, overtimeRate }, null, 2))
})
