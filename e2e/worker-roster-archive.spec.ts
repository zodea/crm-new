import type { Page } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

import { PHOTO, preparePayrollRosterWorkspace } from './helpers/payroll-roster-workspace'

test.use({ actionTimeout: 15000 })
async function capture(page: Page, name: string) {
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), { message: `${name} @ ${width}px` }).toBe(true)
    await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth), { message: `${name} @ ${width}px` }).toBe(true)
  }
}
function unzip(bytes: Buffer) {
  const files: { name: string, data: Buffer }[] = []
  let offset = 0
  while (offset + 30 < bytes.length && bytes.readUInt32LE(offset) === 0x04034B50) {
    const length = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const begin = offset + 30 + nameLength + extraLength
    files.push({ name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), data: bytes.subarray(begin, begin + length) })
    offset = begin + length
  }
  return files
}

test('工人整页维护、工资成员归档、冷回读、真实照片 ZIP 与权限撤销', async ({ page }, info) => {
  test.setTimeout(240000)
  const pageErrors: string[] = []
  page.on('pageerror', cause => pageErrors.push(cause.message))
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  const f = await preparePayrollRosterWorkspace(page, info)
  await page.goto(`/base/worker/private/${f.leader}?origin=real`)
  await expect(page.locator('[data-ui="entity-form-shell"]').getByRole('heading', { name: '工人私密资料', exact: true })).toBeVisible({ timeout: 30000 })
  expect(pageErrors).toEqual([])
  await page.getByLabel('签订情况', { exact: true }).selectOption('true')
  await page.getByLabel('签订日期', { exact: true }).fill('2026-08-01')
  await page.getByRole('link', { name: '编辑工人主档', exact: true }).click()
  const leaveDialog = page.getByRole('dialog', { name: '放弃资料修改', exact: true })
  await expect(leaveDialog).toBeVisible()
  await leaveDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('签订日期', { exact: true })).toHaveValue('2026-08-01')
  await page.getByLabel('上传证件照', { exact: true }).setInputFiles({ name: '证件照.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByLabel('上传银行卡照', { exact: true }).setInputFiles({ name: '银行卡.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByRole('button', { name: '保存资料与照片', exact: true }).click()
  await expect(page.getByText('资料版本 2；', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('签订情况', { exact: true })).toHaveValue('true')
  await expect(page.getByLabel('签订日期', { exact: true })).toHaveValue('2026-08-01')
  await capture(page, 'worker-private')
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await page.locator('#section-photos').scrollIntoViewIfNeeded()
  }
  await page.goto(`/subcontract/payroll/roster?origin=real&project=${f.projectId}`)
  await page.getByLabel(`选择工资 ${f.statementId}`, { exact: true }).check()
  await page.getByLabel('资料登记日期', { exact: true }).fill('2026-09-22')
  await page.getByRole('button', { name: '核对所选 1 份工资的名册', exact: true }).click()
  const table = page.getByRole('region', { name: '名册成员', exact: true })
  await expect(table).toContainText('无考勤零收款成员')
  await expect(table).toContainText('440101199001011234')
  await page.route('**/api/commands/worker-roster', async (route) => {
    const applied = await route.fetch()
    expect(applied.ok(), await applied.text()).toBe(true)
    await route.fulfill({ status: 503, json: { data: { code: 'unavailable', message: '验收：提交已保存但响应丢失' } } })
  }, { times: 1 })
  await page.getByRole('button', { name: '按当前预览归档新版本', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '核对原提交', exact: true }).click()
  await expect(page.getByText('已归档版本 1', { exact: true })).toBeVisible()
  expect(await f.roster.archives(f.projectId)).toHaveLength(1)
  await expect(table).toContainText('6222000000001234')
  await capture(page, 'roster-archive')
  const scroll = page.getByLabel('实名名册横向滚动区域')
  await scroll.focus()
  await page.keyboard.press('ArrowRight')
  await expect(scroll).toBeFocused()
  await expect.poll(() => scroll.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载名册与照片 ZIP', exact: true }).click()
  const download = await downloading
  const output = info.outputPath('archive.zip')
  await download.saveAs(output)
  const files = unzip(await readFile(output))
  expect(files.filter(file => file.name.startsWith('photos/'))).toHaveLength(2)
  expect(files.filter(file => file.name.startsWith('photos/')).every(file => file.data.equals(PHOTO))).toBe(true)
  const book = XLSX.read(files.find(file => file.name.endsWith('.xlsx'))!.data, { type: 'buffer' })
  expect(XLSX.utils.sheet_to_json(book.Sheets['实名名册']!)).toHaveLength(2)
  const versions = await f.roster.archives(f.projectId)
  const original = await f.roster.archive(f.projectId, versions[0]!.id)
  expect(original.members.some(member => member.workerId === f.zero)).toBe(true)
  await page.goto(`/base/worker/private/${f.leader}?origin=real`)
  await page.getByLabel('签订日期', { exact: true }).fill('2026-09-20')
  await page.getByLabel('上传证件照', { exact: true }).setInputFiles({ name: '后来补充证件照.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByRole('button', { name: '保存资料与照片', exact: true }).click()
  await expect(page.getByText('资料版本 3；', { exact: false })).toBeVisible()
  await page.goto(`/subcontract/payroll/roster?origin=real&project=${f.projectId}`)
  await page.getByLabel(`选择工资 ${f.statementId}`, { exact: true }).check()
  await page.getByLabel('资料登记日期', { exact: true }).fill('2026-09-23')
  await page.getByRole('button', { name: '核对所选 1 份工资的名册', exact: true }).click()
  await page.getByRole('button', { name: '按当前预览归档新版本', exact: true }).click()
  await expect(page.getByText('已归档版本 2', { exact: true })).toBeVisible()
  const newer = await f.roster.archive(f.projectId, (await f.roster.archives(f.projectId)).find(row => row.version === 2)!.id)
  expect(newer.scope.registeredOn).toBe('2026-09-23')
  expect(newer.members.find(member => member.workerId === f.leader)!.values.portraitId).not.toBe(original.members.find(member => member.workerId === f.leader)!.values.portraitId)
  expect((await f.roster.archive(f.projectId, original.id)).members).toEqual(original.members)
  const oldPhoto = original.members.find(member => member.workerId === f.leader)!.photos[0]!
  expect((await f.roster.file({ projectId: f.projectId, archiveId: original.id, workerId: f.leader, assetId: oldPhoto.id })).payloadBase64).toBe(PHOTO.toString('base64'))
  await f.access(false)
  const denied = await page.request.get('/api/read/worker-roster/archive', { params: { projectId: f.projectId, archiveId: original.id } })
  expect(denied.status()).toBe(403)
  expect(await denied.text()).not.toContain('440101199001011234')
  expect((await page.request.get(`/api/read/workers/${f.leader}/form`)).status()).toBe(403)
  await page.getByRole('button', { name: '下载名册与照片 ZIP', exact: true }).click()
  await expect(page.locator('[data-ui="entity-form-shell"]').getByText('当前身份没有工人私密资料读取权限', { exact: true })).toBeVisible()
  await expect(page.getByText('440101199001011234', { exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
