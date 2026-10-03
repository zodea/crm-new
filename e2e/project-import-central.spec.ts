import type { Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })
const projectName = 'Excel中央浏览器423'
const customerName = 'Excel导入合成甲方'
const sessions = new Map<string, string>()
const customers = new WeakMap<Page, { id: string, name: string }>()
function headers(info: TestInfo) {
  let session = sessions.get(info.testId)
  if (!session) {
    session = `project-excel-${randomUUID()}`
    sessions.set(info.testId, session)
  }
  return { 'x-ruihang-test-session': session }
}
async function reset(page: Page, info: TestInfo) {
  for (const entity of ['projects', 'customers']) {
    const result = await page.context().request.post(`/api/testing/${entity}/reset`, { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
    expect(result.ok()).toBe(true)
  }
}
test.beforeEach(async ({ page }, info) => {
  await page.context().setExtraHTTPHeaders(headers(info))
  await page.setExtraHTTPHeaders(headers(info))
  await page.addInitScript(() => {
    const key = 'ruihang:workspace-default:include-demo'
    if (localStorage.getItem(key) === null)
      localStorage.setItem(key, 'false')
  })
  await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  await reset(page, info)
  const session = await (await page.request.get('/api/read/business-session')).json()
  const created = await page.request.post('/api/commands/customers', { data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'customer:write', commandId: randomUUID(), baseVersion: null, action: 'save', draft: { name: customerName, contact: 'Excel合成联系人' }, attachments: {} } })
  expect(created.ok(), await created.text()).toBe(true)
  const receipt = await created.json()
  customers.set(page, { id: receipt.id, name: customerName })
})
test.afterEach(async ({ page }, info) => {
  await reset(page, info)
  sessions.delete(info.testId)
})

function workbook(rows: unknown[][] = [[projectName, customerName, '合成经理423', '施工中', 'EXCEL-423-001']]) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['说明'], ['隔离合成样本，不含真实业务数据']]), '说明')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), '空白预留')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['合成项目导入验收'],
    ['项目名称', '客户', '项目经理', '业务流程阶段', '外部旧ID'],
    [],
    ...rows,
  ]), '项目423')
  return { name: '项目导入423.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(book, { type: 'array', bookType: 'xlsx' })) }
}
async function upload(page: Page, file = workbook()) {
  await page.getByLabel('选择导入文件').setInputFiles(file)
  await page.getByLabel('选择导入 Sheet').selectOption('项目423')
  await page.getByRole('button', { name: '使用此工作表' }).click()
  await expect(page.locator('[data-field="manager"]')).toHaveAttribute('data-status', 'matched')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('region', { name: '客户身份与阶段核对表' })).toBeVisible()
}
async function centralRows(page: Page) {
  return page.evaluate(async () => ((await (await fetch('/api/read/projects?includeDemo=false&pageSize=100')).json()).items as Array<{ project: { id: string, label: string } }>).filter(item => item.project.id !== 'project-real-320'))
}

for (const input of [
  { name: 'Excel中央合成筹备工程', customerBy: 'id', manager: '合成经理甲', status: '筹备中', externalRef: 'EXCEL-PREP-001' },
  { name: 'Excel中央合成施工工程', customerBy: 'name', manager: '合成经理乙', status: '施工中', externalRef: 'EXCEL-ACTIVE-002' },
] as const) {
  test(`真实 Excel ${input.customerBy}/${input.status}保存与冷回读，重传只返回原 ID`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const customer = customers.get(page)!
    const customerToken = input.customerBy === 'id' ? customer.id : customer.name
    const file = workbook([[input.name, customerToken, input.manager, input.status, input.externalRef]])
    await page.goto('/project')
    await page.getByRole('button', { name: '导入项目', exact: true }).click()
    await expect(page).toHaveURL(/\/import\/mapping\/project$/)
    await upload(page, file)
    const preview = page.getByRole('region', { name: '客户身份与阶段核对表' })
    await expect(preview).toContainText(customer.id)
    await expect(preview.getByRole('cell', { name: '4', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page).toHaveURL(/\/project$/)
    await expect(page.getByRole('link', { name: input.name, exact: true })).toBeVisible()
    const rows = await centralRows(page)
    expect(rows).toHaveLength(1)
    const id = rows[0]!.project.id
    expect(rows[0]).toMatchObject({ customer: { state: 'resolved', id: customer.id, label: customer.name } })
    const form = await page.evaluate(async id => (await (await fetch(`/api/read/projects/${id}/form`)).json()), id)
    expect(form).toMatchObject({ draft: { customerId: customer.id, manager: input.manager, status: input.status }, importSource: { fileName: file.name, sheetName: '项目423', rowNumber: 4, externalRef: input.externalRef, rawSnapshot: { 项目名称: input.name } } })
    await page.getByRole('link', { name: input.name, exact: true }).click()
    await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
    await page.goto('/import/mapping/project')
    await upload(page, file)
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page).toHaveURL(/\/project$/)
    const reimportedRows = await centralRows(page)
    expect(reimportedRows.map(item => item.project)).toEqual(rows.map(item => item.project))
    const reimportedForm = await page.evaluate(async id => (await (await fetch(`/api/read/projects/${id}/form`)).json()), id)
    expect(reimportedForm).toMatchObject({ version: form.version, draft: form.draft, importSource: form.importSource })
    expect(errors).toEqual([])
  })
}

test('部分成功保留原始行拒绝，响应丢失及回读失败沿原命令重试，成功行不重复', async ({ page }) => {
  await page.goto('/import/mapping/project')
  await upload(page, workbook([
    ['成功行423', customerName, '经理423', '施工中', 'PART-423-1'],
    ['缺客户423', '不存在客户423', '经理423', '施工中', 'PART-423-2'],
    ['响应丢失423', customerName, '经理423', '旧阶段', 'PART-423-3'],
  ]))
  await expect(page.getByRole('region', { name: '客户身份与阶段核对表' })).toContainText('旧阶段 → 筹备中')
  let lost = false
  await page.route('**/api/commands/projects', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().draft.name === '响应丢失423' && !lost) {
      lost = true
      await route.fetch()
      await route.abort('connectionreset')
    }
    else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: '开始导入', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('当前行尚未确认完成')
  expect(await centralRows(page)).toHaveLength(2)
  await page.unroute('**/api/commands/projects')
  await page.route('**/api/read/projects/*/form', route => route.abort('connectionreset'))
  await page.getByRole('button', { name: '重试未导入行' }).click()
  await expect(page.getByRole('alert')).toContainText('当前行尚未确认完成')
  await page.unroute('**/api/read/projects/*/form')
  await page.getByRole('button', { name: '重试未导入行' }).click()
  await expect(page.getByRole('status').filter({ hasText: '已成功' })).toContainText('已成功 2 行 · 未导入 1 行')
  await expect(page.getByRole('region', { name: '项目行级拒绝清单' })).toContainText('缺客户423')
  await expect(page.getByRole('region', { name: '项目行级拒绝清单' }).getByRole('cell', { name: '5', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始导入', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重试未导入行' }).click()
  await expect(page.getByRole('status').filter({ hasText: '已成功' })).toContainText('已成功 2 行 · 未导入 1 行')
  expect(await centralRows(page)).toHaveLength(2)
})

test('预览期间锁定映射；取消不写入，确认来源切换后重载并保持正式写源', async ({ page }) => {
  const file = workbook()
  await page.goto('/import/mapping/project')
  await page.getByLabel('选择导入文件').setInputFiles(file)
  await page.getByLabel('选择导入 Sheet').selectOption('空白预留')
  await page.getByRole('button', { name: '使用此工作表' }).click()
  await expect(page.getByRole('alert')).toContainText('没有数据行')
  await page.getByLabel('选择导入 Sheet').selectOption('项目423')
  await page.getByRole('button', { name: '使用此工作表' }).click()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/read/customers?**', async (route) => {
    await gate
    await route.continue()
  })
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByLabel('客户的源列', { exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('region', { name: '客户身份与阶段核对表' })).toBeVisible()
  await page.unroute('**/api/read/customers?**')
  await page.getByRole('button', { name: '包含测试数据' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expectNoPageOverflow(page, '来源切换确认浮层')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await centralRows(page)).toHaveLength(0)
  await page.getByRole('button', { name: '包含测试数据' }).click()
  await page.getByRole('button', { name: '确认切换' }).click()
  await expect(page.getByRole('button', { name: '关闭测试数据' })).toBeVisible()
  await page.goto('/import/mapping/project')
  await expect(page.getByLabel('选择导入文件')).toBeAttached()
  expect(await centralRows(page)).toHaveLength(0)
  await upload(page, file)
  await page.getByRole('button', { name: '开始导入', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)
  expect(await centralRows(page)).toHaveLength(1)
  await page.getByRole('button', { name: '关闭测试数据' }).click()
  await page.getByRole('button', { name: '确认切换' }).click()
  await expect(page.getByRole('link', { name: projectName, exact: true })).toBeVisible()
  expect(await centralRows(page)).toHaveLength(1)
})

test('预览后客户停用或权限撤回在中央提交时给出行级拒绝', async ({ page }, info) => {
  await page.goto('/import/mapping/project')
  const customer = await page.evaluate(async () => {
    const context = await (await fetch('/api/read/business-session')).json()
    return (await (await fetch('/api/commands/customers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, requiredCapability: 'customer:write', commandId: 'preview-customer-423', baseVersion: null, action: 'save', draft: { name: '可变客户423', contact: '合成联系人' }, attachments: {} }) })).json()) as { id: string, version: string }
  })
  await upload(page, workbook([['停用关系项目423', customer.id, '经理423', '施工中', 'INACTIVE-423']]))
  await page.evaluate(async (customer) => {
    const context = await (await fetch('/api/read/business-session')).json()
    const response = await fetch(`/api/commands/customers/${customer.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, id: customer.id, requiredCapability: 'customer:write', commandId: 'inactive-customer-423', baseVersion: customer.version, action: 'save', draft: { id: customer.id, name: '可变客户423', contact: '合成联系人', status: 'inactive' }, attachments: {} }) })
    if (!response.ok)
      throw new Error('停用合成客户失败')
  }, customer)
  await page.getByRole('button', { name: '开始导入', exact: true }).click()
  await expect(page.getByRole('region', { name: '项目行级拒绝清单' })).toContainText('已停用')
  expect(await centralRows(page)).toHaveLength(0)
  await page.context().request.post('/api/testing/customers/reset', { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario: 'forbidden' } })
  await page.getByRole('button', { name: '重试未导入行' }).click()
  await expect(page.getByRole('region', { name: '项目行级拒绝清单' })).toContainText('无客户查看权限')
  expect(await centralRows(page)).toHaveLength(0)
})

test('导入期间取消只完成当前行，重新上传原文件恢复剩余行不重复创建', async ({ page }) => {
  const file = workbook([['取消当前行423', customerName, '经理423', '', 'CANCEL-1'], ['取消后续行423', customerName, '经理423', '', 'CANCEL-2']])
  await page.goto('/import/mapping/project')
  await upload(page, file)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    received = resolve
  })
  await page.route('**/api/commands/projects', async (route) => {
    const result = await route.fetch()
    received()
    await gate
    await route.fulfill({ response: result })
  })
  await page.getByRole('button', { name: '开始导入', exact: true }).click()
  await started
  await page.getByRole('button', { name: '停止并返回列表' }).click()
  await expect(page.getByRole('button', { name: '等待当前行结束' })).toBeDisabled()
  await expect(page).toHaveURL(/\/import\/mapping\/project$/)
  release()
  await expect(page).toHaveURL(/\/project$/)
  await expect(page.getByRole('link', { name: '取消当前行423', exact: true })).toBeVisible()
  expect(await centralRows(page)).toHaveLength(1)
  await page.unroute('**/api/commands/projects')
  await page.getByRole('button', { name: '导入项目', exact: true }).click()
  await expect(page).toHaveURL(/\/import\/mapping\/project$/)
  await upload(page, file)
  await page.getByRole('button', { name: '开始导入', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)
  await expect(page.getByRole('link', { name: '取消后续行423', exact: true })).toBeVisible()
  expect(await centralRows(page)).toHaveLength(2)
})

for (const width of [390, 768, 1024, 1280, 1440]) {
  test(`${width}px 上传映射预览失败表局部横滚、键盘焦点与取消`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/import/mapping/project')
    await expectNoPageOverflow(page, '上传')
    await upload(page, workbook([['拒绝行423', '不存在客户423', '经理423', '', 'VIEW-423']]))
    await expect(page.getByRole('heading', { name: '导入项目', exact: true })).toBeFocused()
    await expectNoPageOverflow(page, `预览 ${width}`)
    const table = page.getByRole('region', { name: '客户身份与阶段核对表' })
    await table.focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page.getByRole('region', { name: '项目行级拒绝清单' })).toBeVisible()
    await expectNoPageOverflow(page, `失败 ${width}`)
    await page.screenshot({ path: info.outputPath(`viewport-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '返回项目列表', exact: true }).click()
    await expect(page).toHaveURL(/\/project$/)
    expect(await centralRows(page)).toHaveLength(0)
  })
}
