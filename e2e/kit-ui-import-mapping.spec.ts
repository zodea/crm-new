import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

async function openImportDemo(page: Page) {
  await page.goto('/dev/kit-ui')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '打开导入映射演示' }).click()
  await expect(page).toHaveURL(/\/import\/mapping\/demo-supplier$/)
}

function csvFile(name: string, content: string) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf-8') }
}

test('导入映射：坏文件报错、预匹配三色态、必填门控、删行并成功导入后自动关闭', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await openImportDemo(page)
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')

  const stepper = page.locator('[aria-label="处理步骤"] [data-state]')
  await expect(stepper.nth(0)).toHaveAttribute('data-state', 'active')

  // 只有表头没有数据行 → 上传步报错并停留。
  const fileInput = page.getByLabel('选择导入文件')
  await fileInput.setInputFiles(csvFile('empty.csv', '名称,类别\n'))
  await expect(page.getByRole('alert')).toContainText('文件没有数据行')
  await expect(stepper.nth(0)).toHaveAttribute('data-state', 'active')

  // 正常文件 → 自动进入映射步。
  await fileInput.setInputFiles(csvFile('suppliers.csv', [
    '分供方名称,类型,联系人,电话,匹配标识',
    '华东建材,材料,张三,13800000001,HQ-001',
    '南方设备,设备,李四,13800000002,HQ-002',
    '金城幕墙,幕墙,王五,13800000003,HQ-003',
  ].join('\n')))
  await expect(stepper.nth(0)).toHaveAttribute('data-state', 'completed')
  await expect(stepper.nth(1)).toHaveAttribute('data-state', 'active')

  // 智能预匹配三色态：别名精确=已匹配、包含=待确认、必填未映=必填缺失。
  const fieldRow = (key: string) => page.locator(`[data-field="${key}"]`)
  await expect(fieldRow('name')).toHaveAttribute('data-status', 'matched')
  await expect(fieldRow('contact')).toHaveAttribute('data-status', 'matched')
  await expect(fieldRow('externalRef')).toHaveAttribute('data-status', 'matched')
  await expect(fieldRow('phone')).toHaveAttribute('data-status', 'pending')
  await expect(fieldRow('category')).toHaveAttribute('data-status', 'required-missing')

  // 必填未映上：下一步被拦住并给出缺失提示。
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('必填字段未映射：合作类别')

  // 手动映射必填字段 + 确认待确认字段。
  await page.getByLabel('合作类别的源列').selectOption('类型')
  await expect(fieldRow('category')).toHaveAttribute('data-status', 'matched')
  await page.getByRole('button', { name: '确认' }).click()
  await expect(fieldRow('phone')).toHaveAttribute('data-status', 'matched')

  await page.getByRole('button', { name: '下一步' }).click()
  await expect(stepper.nth(2)).toHaveAttribute('data-state', 'active')

  // 预览：3 行可见，删除第 2 行（南方设备）。
  await expect(page.getByRole('table')).toContainText('南方设备')
  await page.getByRole('button', { name: '删除第 2 行' }).click()
  await expect(page.getByRole('table')).not.toContainText('南方设备')
  await expect(page.getByText('共 2 行待导入，已删除 1 行')).toBeVisible()

  await page.getByRole('button', { name: '开始导入' }).click()

  const systemToaster = page.locator('[data-sonner-toaster][data-y-position="top"]')
  const success = systemToaster.getByText('已导入 2 行：演示·分供方', { exact: true })
  await expect(success).toBeVisible()
  await expect(success).toHaveCount(1)
  await expect(page).toHaveURL(/\/dev\/kit-ui$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('2 个页签')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-ripple], .ripple')).toHaveCount(0)
  expect(pageErrors, '导入完整旅程不应产生客户端运行错误').toEqual([])
})

test('导入映射：写入失败保留页签，重试从失败行续导后完成', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await openImportDemo(page)

  await page.getByLabel('选择导入文件').setInputFiles(csvFile('retry.csv', [
    '分供方名称,类别,匹配标识',
    '华东建材,材料,OK-1',
    '故障行,设备,FAIL-E2E-1',
    '金城幕墙,幕墙,OK-2',
  ].join('\n')))

  // 别名「类别」精确匹配，必填直接放行。
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '开始导入' }).click()

  // 第 2 行首次写入失败：进度停在 1/3，页签保留。
  await expect(page.getByRole('alert')).toContainText('演示写入失败：FAIL-E2E-1')
  await expect(page.getByText('1/3 行')).toBeVisible()
  await expect(page.locator('[aria-label="处理步骤"] [data-state="failed"]')).toHaveCount(1)
  await expect(page).toHaveURL(/\/import\/mapping\/demo-supplier$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')

  // 重试从失败行续导（演示瞬时故障第二次成功）。
  await page.getByRole('button', { name: '重试失败行' }).click()
  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已导入 3 行：演示·分供方', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/dev\/kit-ui$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('2 个页签')
  expect(pageErrors, '失败与续导旅程不应产生客户端运行错误').toEqual([])
})
