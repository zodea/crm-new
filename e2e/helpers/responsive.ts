import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const RESPONSIVE_WIDTHS = [390, 768, 1024, 1440] as const
export const EQUIVALENT_200_PERCENT_VIEWPORT = { width: 720, height: 500 } as const

export async function expectNoPageOverflow(page: Page, context: string) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll, `${context} 不应产生页面级横向溢出`)
    .toBeLessThanOrEqual(widths.client)
}

export async function expectLocalHorizontalScroll(root: Locator, context: string) {
  const metrics = await root.evaluate((element) => {
    const candidates = [element, ...element.querySelectorAll<HTMLElement>('*')]
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement))
        continue
      const overflowX = getComputedStyle(candidate).overflowX
      if (/auto|scroll/.test(overflowX) && candidate.scrollWidth > candidate.clientWidth + 1) {
        return {
          client: candidate.clientWidth,
          scroll: candidate.scrollWidth,
        }
      }
    }
    return null
  })

  expect(metrics, `${context} 应具有独立横向滚动容器`).not.toBeNull()
  expect(metrics!.scroll, `${context} 的内容应宽于局部容器`).toBeGreaterThan(metrics!.client)
}

export async function tabUntilFocused(
  page: Page,
  target: Locator,
  direction: 'forward' | 'backward' = 'forward',
  maxSteps = 100,
) {
  await expect(target).toBeVisible({ timeout: 5_000 })
  const key = direction === 'forward' ? 'Tab' : 'Shift+Tab'
  for (let step = 0; step < maxSteps; step++) {
    if (await target.evaluate(element => element === document.activeElement))
      return
    await page.keyboard.press(key)
  }
  await expect(target).toBeFocused()
}
