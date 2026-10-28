import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ video: 'off', trace: 'off', screenshot: 'off' })

const OCR_INPUT = {
  settings: { useChartRecognition: true, requestTimeoutMs: 45000 },
  updatedAt: '2026-09-15T00:00:00.000Z',
}

test('OCR 设置重读失败锁定写入，键盘重试恢复原配置', async ({ page }) => {
  test.setTimeout(120_000)
  const databaseModules: string[] = []
  page.on('request', (request) => {
    if (decodeURIComponent(request.url()).replaceAll('\\', '/').includes('/lib/db/client.ts'))
      databaseModules.push(request.url())
  })
  await page.goto('/settings/ocr')
  await expect(page.getByTestId('ocr-settings-page').getByRole('heading', { name: 'OCR 设置', exact: true })).toBeVisible({ timeout: 60_000 })
  const form = page.getByTestId('ocr-recognition-settings-form')
  await expect(form.getByText('已保存', { exact: true })).toBeVisible()

  expect(databaseModules).toHaveLength(1)
  await page.evaluate(async ({ moduleUrl, settings, updatedAt }) => {
    const { db } = await import(moduleUrl)
    await db.execute(
      'INSERT INTO ocr_settings (id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json',
      ['default', JSON.stringify(settings), updatedAt],
    )
    const select = db.select.bind(db)
    let shouldFail = true
    db.select = async (sql: string, args: unknown[]) => {
      if (shouldFail && sql.includes('FROM ocr_settings')) {
        shouldFail = false
        throw new Error('测试：暂时无法读取 OCR 设置')
      }
      return select(sql, args)
    }
    const execute = db.execute.bind(db)
    db.execute = async (sql: string, args: unknown[]) => {
      if (sql.includes('ocr_settings'))
        throw new Error('重读场景禁止写入设置')
      return execute(sql, args)
    }
  }, { moduleUrl: databaseModules[0]!, ...OCR_INPUT })

  await page.getByRole('button', { name: '刷新当前页', exact: true }).click()
  await expect(page.getByText('测试：暂时无法读取 OCR 设置', { exact: true })).toBeVisible()
  await expect(form.getByText('已保存', { exact: true })).toHaveCount(0)
  await expect(form.getByRole('checkbox', { name: '图表识别' })).toBeDisabled()
  await expect(form.getByRole('button', { name: '恢复默认' })).toBeDisabled()
  await expect(form.getByRole('button', { name: '保存设置' })).toBeDisabled()

  const retry = page.getByRole('button', { name: '重新读取设置' })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await retry.focus()
    await retry.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(retry).toBeFocused()
    await expectNoPageOverflow(page, `OCR 设置读取失败 @ ${width}px`)
    if (process.env.CRM_EVIDENCE_DIR) {
      await mkdir(process.env.CRM_EVIDENCE_DIR, { recursive: true })
    }
  }
  await retry.press('Enter')
  await expect(form.getByText('已保存', { exact: true })).toBeVisible()
  await expect(form.getByRole('checkbox', { name: '图表识别' })).toBeChecked()
  await expect(form.getByLabel('单次请求超时（秒）')).toHaveValue('45')
  await expect(retry).toHaveCount(0)
})
