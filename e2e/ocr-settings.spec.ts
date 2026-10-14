import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

const VIEWPORT_WIDTHS = [390, 768, 1024, 1280, 1440] as const
const VIEWPORT_HEIGHTS: Record<(typeof VIEWPORT_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1280: 900,
  1440: 1000,
}

test.describe('Issue #204：OCR 设置', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  })
  test('展示紧凑纵向工作台且只开放真实参数，各宽度无页面溢出', async ({ page }) => {
    await page.goto('/settings/ocr')

    const settings = page.getByTestId('ocr-settings-page')
    await expect(settings.getByRole('heading', { name: 'OCR 设置', exact: true }))
      .toBeVisible({ timeout: 15_000 })
    await expect(settings.getByText(/Token 仅在 Nitro 服务端环境变量中保存/)).toBeVisible()
    await expect(settings.getByText('PaddleOCR-VL-1.6')).toBeVisible()
    await expect(settings.getByText('清单拆表', { exact: true })).toBeVisible()
    await expect(settings.getByTestId('ocr-document-table').getByRole('row').filter({ hasText: '清单拆表' })).toContainText('未接入')
    await expect(settings.getByRole('checkbox', { name: '文档方向识别' })).toBeChecked()
    await expect(settings.getByRole('checkbox', { name: '图表识别' })).not.toBeChecked()
    await expect(settings.getByLabel('建议通过阈值')).toBeDisabled()
    await expect(settings.getByText(/尚未接入全局判读/)).toBeVisible()
    await expect(settings.locator('input[type="password"]')).toHaveCount(0)
    for (const width of VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await expectNoPageOverflow(page, `OCR 设置 @ ${width}px`)
    }
  })

  for (const input of [
    { label: '关闭方向并开启图表', orientation: false, chart: true },
    { label: '方向与图表均开启', orientation: true, chart: true },
  ]) {
    test(`本地保存后显式重新进入设置保留识别参数：${input.label}`, async ({ page }) => {
      await page.goto('/settings/ocr')
      const chartRecognition = page.getByRole('checkbox', { name: '图表识别' })
      await expect(chartRecognition).toBeVisible()
      await page.getByRole('checkbox', { name: '文档方向识别' }).setChecked(input.orientation)
      await chartRecognition.setChecked(input.chart)

      const save = page.getByRole('button', { name: '保存设置' })
      await expect(save).toBeEnabled()
      await save.click()
      await expect(page.getByText('设置已保存，将用于后续识别任务。')).toBeVisible()

      await page.reload()
      await page.goto('/settings/ocr')
      await expect(page.getByRole('checkbox', { name: '文档方向识别' })).toBeChecked({ checked: input.orientation })
      await expect(page.getByRole('checkbox', { name: '图表识别' })).toBeChecked({ checked: input.chart })
    })
  }

  test('重新检测只读取状态，不发送密钥或文件', async ({ page }) => {
    const requests: { method: string, url: string, body: string | null }[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/ocr/'))
        requests.push({ method: request.method(), url: request.url(), body: request.postData() })
    })
    await page.goto('/settings/ocr')
    await expect(page.getByRole('button', { name: '重新检测' })).toBeEnabled()

    requests.length = 0
    await page.getByRole('button', { name: '重新检测' }).click()
    await expect.poll(() => requests.length).toBeGreaterThan(0)
    expect(requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        body: null,
      }),
    ])
    for (const request of requests)
      expect(new URL(request.url).pathname).toBe('/api/ocr/status')
  })
})
