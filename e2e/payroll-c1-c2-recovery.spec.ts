import type { Page } from '@playwright/test'
import type { PayrollDayworkCommand, PayrollDayworkFormRead, PayrollDayworkRecordDraft } from '../app/lib/payroll/central-daywork-contract'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { payrollC1Workspace } from './helpers/payroll-c1-workspace'
import { payrollC2Workspace } from './helpers/payroll-c2-workspace'

test.describe('C1 命令恢复', () => {
  test.use({ actionTimeout: 15000 })
  async function evidence(page: Page, name: string) {
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 960 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), { message: `${name} @ ${width}px` }).toBe(true)
    }
  }

  test('原考勤保存失败保稿、冷页原编号恢复与切月份迟到读取', async ({ page }, info) => {
    test.setTimeout(150000)
    const { repository, project, leader } = await payrollC1Workspace(page, '2026-10', info)
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
    await evidence(page, 'attendance-failed-original-input')
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
    await evidence(page, 'attendance-late-read-current-month')
    await writeFile(info.outputPath('recovery-result.json'), JSON.stringify({ originalCommand: original, projectId: project.id, date: '2026-10-03', currentMonth: '2026-12', hours: 7.51 }, null, 2))
  })

  test('个人标准保存失响应后冷页仍按原编号确认，不覆盖原配置空值', async ({ page }, info) => {
    test.setTimeout(120000)
    const { repository, project, leader } = await payrollC1Workspace(page, '2026-11', info)
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
    await evidence(page, 'c1-config-cold-original-pending')
    const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-c1') && request.postDataJSON()?.commandId === original)
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await replay
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存个人标准', exact: true })).toBeDisabled()
    const read = await repository.c1Config({ origin: 'real' }, { projectId: project.id, month: '2026-11', crewId: leader.crewId })
    expect(read.rates.find(rate => rate.workerId === leader.id)).toMatchObject({ profileDailyWage: 481, configuredDailyWage: null, configuredOvertimeRate: overtimeRate, overtimeRate })
    await writeFile(info.outputPath('config-recovery-result.json'), JSON.stringify({ originalCommand: original, projectId: project.id, month: '2026-11', configuredDailyWage: null, overtimeRate }, null, 2))
  })
})

test.describe('C2 命令恢复', () => {
  test.use({ actionTimeout: 15000 })
  async function evidence(page: Page, name: string, selector?: string) {
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 960 })
      if (selector)
        await page.locator(selector).first().scrollIntoViewIfNeeded()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), { message: `${name} @ ${width}px` }).toBe(true)
    }
  }
  function saveCommand(read: PayrollDayworkFormRead, record: PayrollDayworkRecordDraft): PayrollDayworkCommand {
    return {
      commandId: randomUUID(),
      workspaceId: read.context.workspaceId,
      actorId: read.context.actorId,
      origin: read.context.origin,
      requiredCapability: 'payroll:write',
      sourceVersion: read.context.sourceVersion,
      projectId: read.record?.projectId ?? record.projectId,
      recordId: read.recordId,
      draftKey: read.draftKey,
      originalScope: read.record ? { projectId: read.record.projectId, crewId: read.record.crewId, workerId: read.record.workerId, workDate: read.record.workDate } : null,
      action: { kind: 'save-daywork', record },
    }
  }

  test('新签工失响应后冷页按原编号保存一次，日期和正文不丢失', async ({ page }, info) => {
    test.setTimeout(150000)
    const { repository, project, leader } = await payrollC2Workspace(page, '2026-10', info)
    const url = `/subcontract/daywork/new?${new URLSearchParams({ origin: 'real', project: project.id, month: '2026-10', crew: leader.crewId || '', draftKey: 'c2-daywork-cold-original' })}`
    await page.goto(url)
    await page.getByRole('combobox', { name: '签工用工人', exact: true }).fill('签工负责人')
    await page.getByRole('option', { name: '签工负责人', exact: true }).click()
    await page.getByLabel('用工日期', { exact: true }).fill('2026-10-03')
    await page.getByLabel('开始时间', { exact: true }).fill('08:00')
    await page.getByLabel('结束时间', { exact: true }).fill('12:00')
    await page.getByLabel('用工数', { exact: true }).selectOption('0.5')
    await page.getByLabel('施工内容', { exact: true }).fill('冷页后仍保存原半工和长施工内容，不重复登记')
    let original: PayrollDayworkCommand | null = null
    await page.route('**/api/commands/payroll-daywork', async (route) => {
      if (!original) {
        original = route.request().postDataJSON()
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收：暂时无法确认签工保存结果' }) })
      }
      else { await route.continue() }
    })
    await page.getByRole('button', { name: '保存待确认', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await expect(page.getByLabel('施工内容', { exact: true })).toHaveValue('冷页后仍保存原半工和长施工内容，不重复登记')
    await evidence(page, 'daywork-unknown-keeps-input')
    await evidence(page, 'daywork-unknown-form-actions', 'button:has-text("保存待确认")')
    page.once('dialog', dialog => dialog.accept())
    await page.reload()
    await page.goto(url)
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await expect(page.getByLabel('用工日期', { exact: true })).toHaveValue('2026-10-03')
    await expect(page.getByLabel('用工数', { exact: true })).toHaveValue('0.5')
    await expect(page.getByLabel('施工内容', { exact: true })).toHaveValue('冷页后仍保存原半工和长施工内容，不重复登记')
    await evidence(page, 'daywork-cold-original-pending')
    const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-daywork'))
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    expect((await replay).postDataJSON()).toEqual(original)
    await expect(page).toHaveURL(/\/subcontract\/daywork\?/)
    const refreshed = await repository.dayworkList({ origin: 'real' }, { projectId: project.id, month: '2026-10', crewId: leader.crewId, dayworkStatuses: [] })
    const records = refreshed.records.filter(record => record.workerId === leader.id && record.workDate === '2026-10-03')
    expect(records).toMatchObject([{ laborUnits: 0.5, status: 'draft', workContent: '冷页后仍保存原半工和长施工内容，不重复登记' }])
    await writeFile(info.outputPath('daywork-cold-recovery.json'), JSON.stringify({ original, records: records.map(record => ({ id: record.id, workDate: record.workDate, laborUnits: record.laborUnits, status: record.status })) }, null, 2))
  })

  test('原签工保存成功但冷读失败，后来合法修改后仍可确认原提交并保留旧输入', async ({ page }, info) => {
    test.setTimeout(150000)
    const { repository, project, leader } = await payrollC2Workspace(page, '2026-11', info)
    const record: PayrollDayworkRecordDraft = { projectId: project.id, crewId: leader.crewId, workerId: leader.id, workDate: '2026-11-03', workContent: '起始原签工', startTime: '08:00', endTime: '12:00', laborUnits: 0.5, witness: '', confirmedOn: null, status: 'draft', note: '' }
    const initial = await repository.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: 'c2-later-change-source', draft: record })
    const created = await repository.executeDaywork(saveCommand(initial, record))
    await page.goto(`/subcontract/daywork/form/${created.recordId}?origin=real`)
    await page.getByLabel('施工内容', { exact: true }).fill('本窗口原提交的施工内容')
    let original: PayrollDayworkCommand | null = null
    let failRead = true
    page.on('request', (request) => {
      if (request.url().endsWith('/api/commands/payroll-daywork') && !original)
        original = request.postDataJSON()
    })
    await page.route('**/api/read/payroll/daywork-form', async (route) => {
      if (original && failRead && route.request().postDataJSON().input?.recordId === created.recordId) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收：原签工已保存，后读暂不可用' }) })
      }
      else { await route.continue() }
    })
    await page.getByRole('button', { name: '保存待确认', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '工资提交核对', exact: true }).or(page.locator('[aria-label="工资提交核对"]'))).toContainText('提交已保存，等待读取原结果')
    await expect(page.getByLabel('施工内容', { exact: true })).toHaveValue('本窗口原提交的施工内容')
    await evidence(page, 'daywork-success-read-failure')
    await evidence(page, 'daywork-success-read-failure-status', '[aria-label="工资提交核对"]')
    await evidence(page, 'daywork-success-read-failure-actions', 'button:has-text("保存待确认")')
    // 独立公开 HTTP 命令模拟另一窗口合法更正，不改数据库或伪造后读结果。
    const current = await repository.dayworkForm({ origin: 'real' }, { recordId: created.recordId })
    expect(current.record?.workContent).toBe('本窗口原提交的施工内容')
    const later = { ...record, workDate: '2026-11-04', workContent: '另一窗口后来核实的当前事实' }
    await repository.executeDaywork(saveCommand(current, later))
    failRead = false
    const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-daywork'))
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    expect((await replay).postDataJSON()).toEqual(original)
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '原提交后续更新', exact: true })).toContainText('原提交已完成，记录随后有更新')
    await expect(page.getByRole('region', { name: '原提交后续更新', exact: true })).toContainText('2026-11-04')
    await expect(page.getByLabel('用工日期', { exact: true })).toHaveValue('2026-11-03')
    await expect(page.getByLabel('施工内容', { exact: true })).toHaveValue('本窗口原提交的施工内容')
    await expect(page.getByRole('button', { name: '保存待确认', exact: true })).toBeDisabled()
    await evidence(page, 'daywork-original-ack-after-later-change')
    await page.getByText('查看当前原记录', { exact: true }).click()
    await expect(page.getByRole('region', { name: '原提交后续更新', exact: true })).toContainText('另一窗口后来核实的当前事实')
    await evidence(page, 'daywork-original-ack-current-expanded', '[aria-label="原提交后续更新"]')
    await evidence(page, 'daywork-original-ack-retained-content', '[data-field="workContent"]')
    const after = await repository.dayworkForm({ origin: 'real' }, { recordId: created.recordId })
    expect(after.record).toMatchObject({ workDate: '2026-11-04', workContent: '另一窗口后来核实的当前事实' })
    await writeFile(info.outputPath('daywork-later-change-result.json'), JSON.stringify({ original, originalRecordId: created.recordId, currentRecord: after.record, pendingCleared: true, oldInputRetained: true }, null, 2))
  })

  test('C2 主体配置保存失响应后冷页仍按原键核对，明确空规则保持为空', async ({ page }, info) => {
    test.setTimeout(120000)
    const { repository, project, leader } = await payrollC2Workspace(page, '2026-12', info)
    const scope = { projectId: project.id, leaderWorkerId: leader.id }
    const before = await repository.c2Config({ origin: 'real' }, scope)
    const price = before.config?.unitRate === 360 ? 361 : 360
    const url = `/subcontract/payroll/config?${new URLSearchParams({ origin: 'real', format: 'C2', project: project.id, leader: leader.id, month: '2026-12', crew: leader.crewId || '' })}`
    await page.goto(url)
    await page.getByLabel('大工单价', { exact: true }).fill(String(price))
    await page.getByLabel('确认规则', { exact: true }).fill('')
    let original: unknown
    await page.route('**/api/commands/payroll-c2', async (route) => {
      if (!original && route.request().postDataJSON()?.action.kind === 'save-c2-config') {
        original = route.request().postDataJSON()
        const response = await route.fetch()
        expect(response.ok(), await response.text()).toBe(true)
        await route.abort('failed')
      }
      else { await route.continue() }
    })
    await page.getByRole('button', { name: '保存主体配置', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    page.once('dialog', dialog => dialog.accept())
    await page.reload()
    await page.goto(url)
    await expect(page.getByLabel('大工单价', { exact: true })).toHaveValue(String(price))
    await expect(page.getByLabel('确认规则', { exact: true })).toHaveValue('')
    await expect(page.locator('#section-scope')).toContainText(project.name!)
    await expect(page.locator('#section-scope')).toContainText('签工负责人')
    await evidence(page, 'c2-config-cold-original-pending')
    const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-c2'))
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    expect((await replay).postDataJSON()).toEqual(original)
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存主体配置', exact: true })).toBeDisabled()
    const after = await repository.c2Config({ origin: 'real' }, scope)
    expect(after.config).toMatchObject({ unitRate: price, ruleText: '' })
    await writeFile(info.outputPath('c2-config-recovery.json'), JSON.stringify({ original, configId: after.config!.id, price, ruleText: after.config!.ruleText }, null, 2))
  })

  test('签工切换月份后迟到的旧读取不覆盖当前记录或两类状态筛选', async ({ page }, info) => {
    test.setTimeout(120000)
    const { repository, project, leader } = await payrollC2Workspace(page, '2027-01', info)
    for (const month of ['2027-01', '2027-02']) {
      const record: PayrollDayworkRecordDraft = { projectId: project.id, crewId: leader.crewId, workerId: leader.id, workDate: `${month}-03`, workContent: `${month} 当前月真实签工`, startTime: '08:00', endTime: '12:00', laborUnits: 0.5, witness: '', confirmedOn: null, status: 'draft', note: '' }
      const read = await repository.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: `c2-late-read-${month}`, draft: record })
      await repository.executeDaywork(saveCommand(read, record))
    }
    await page.goto(`/subcontract/daywork?${new URLSearchParams({ origin: 'real', project: project.id, month: '2026-12', crew: leader.crewId || '', status: '["draft","checked"]', dayworkStatus: '["draft"]' })}`)
    await expect(page.getByLabel('签工月份', { exact: true })).toHaveValue('2026-12')
    let releaseOld!: () => void
    const gate = new Promise<void>(resolve => releaseOld = resolve)
    let started!: () => void
    const oldStarted = new Promise<void>(resolve => started = resolve)
    await page.route('**/api/read/payroll/daywork?**', async (route) => {
      const scope = JSON.parse(new URL(route.request().url()).searchParams.get('scope') || '{}')
      if (scope.month === '2027-01') {
        const response = await route.fetch()
        started()
        await gate
        await route.fulfill({ response })
      }
      else { await route.continue() }
    })
    try {
      await page.getByLabel('签工月份', { exact: true }).fill('2027-01')
      await page.getByLabel('签工月份', { exact: true }).blur()
      await oldStarted
      await page.getByLabel('签工月份', { exact: true }).fill('2027-02')
      await page.getByLabel('签工月份', { exact: true }).blur()
      await expect(page.getByRole('cell', { name: '2027-02 当前月真实签工', exact: true })).toBeVisible()
      const oldFinished = page.waitForResponse(response => response.url().includes('/api/read/payroll/daywork?') && JSON.parse(new URL(response.url()).searchParams.get('scope') || '{}').month === '2027-01')
      releaseOld()
      await oldFinished
      await expect(page.getByLabel('签工月份', { exact: true })).toHaveValue('2027-02')
      await expect(page.getByRole('cell', { name: '2027-01 当前月真实签工', exact: true })).toHaveCount(0)
      await expect(page.getByRole('cell', { name: '2027-02 当前月真实签工', exact: true })).toBeVisible()
      const query = new URL(page.url()).searchParams
      expect(JSON.parse(query.get('status')!)).toEqual(['draft', 'checked'])
      expect(JSON.parse(query.get('dayworkStatus')!)).toEqual(['draft'])
      await evidence(page, 'daywork-late-read-current-month')
    }
    finally {
      releaseOld()
      await page.unroute('**/api/read/payroll/daywork?**')
    }
  })
})
