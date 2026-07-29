import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

test.describe('Issue #204：OCR 设置', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 展示脱敏运行状态与真实接入矩阵`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/settings/ocr')

      const settings = page.getByTestId('ocr-settings-page')
      await expect(settings.getByRole('heading', { name: 'OCR 设置', exact: true }))
        .toBeVisible({ timeout: 15_000 })
      await expect(settings.getByText(/Token 仅在 Nitro 服务端环境变量中保存/)).toBeVisible()
      await expect(settings.getByText('PaddleOCR-VL-1.6')).toBeVisible()
      await expect(settings.getByText('清单拆表', { exact: true })).toBeVisible()
      await expect(settings.getByText('未接入', { exact: true }).first()).toBeVisible()
      await expect(settings.getByText('本地自托管参数尚未开放')).toBeVisible()
      await expect(settings.locator('input[type="password"]')).toHaveCount(0)
      await expectNoPageOverflow(page, `OCR 设置 @ ${width}px`)
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
    expect(requests[0]!.url).toContain('/api/ocr/status')
  })
})
