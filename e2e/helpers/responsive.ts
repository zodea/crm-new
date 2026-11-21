import type { Locator, Page } from '@playwright/test'
import process from 'node:process'
import { expect, test } from '@playwright/test'

export const RESPONSIVE_WIDTHS = process.env.CRM_E2E_TIER === 'pr'
  ? [390, 1024, 1440] as const
  : [390, 768, 1024, 1440] as const
export const EQUIVALENT_200_PERCENT_VIEWPORT = { width: 720, height: 500 } as const

export async function checkResponsiveWidths(page: Page, widths: readonly number[], check: (width: number) => Promise<void>) {
  for (const width of widths) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await check(width)
    })
  }
}

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
    if (!(element instanceof HTMLElement))
      return null
    return {
      client: element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
      scroll: element.scrollWidth,
    }
  })

  expect(metrics, `${context} 应具有独立横向滚动容器`).not.toBeNull()
  expect(metrics!.overflowX, `${context} 应由目标容器自身承载横向滚动`).toMatch(/auto|scroll/)
  expect(metrics!.scroll, `${context} 的内容应宽于局部容器`).toBeGreaterThan(metrics!.client)
}

export async function expectInViewport(locator: Locator, context: string) {
  await expect(locator, `${context} 应可见`).toBeVisible()
  await expect(locator, `${context} 应在当前视口内可达`).toBeInViewport()
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

export async function expectTabSequence(
  page: Page,
  start: Locator,
  targets: Locator[],
  context: string,
) {
  await start.focus()
  await expect(start, `${context} 起点`).toBeFocused()

  let expectedIndex = 0
  for (let step = 0; step < 100; step++) {
    await page.keyboard.press('Tab')

    if (await start.evaluate(element => element === document.activeElement))
      throw new Error(`${context} 在命中全部目标前发生了焦点回绕`)

    let focusedTarget = -1
    for (let index = 0; index < targets.length; index++) {
      if (await targets[index]!.evaluate(element => element === document.activeElement)) {
        focusedTarget = index
        break
      }
    }
    if (focusedTarget === -1)
      continue

    expect(
      focusedTarget,
      `${context} 的第 ${expectedIndex + 1} 个关键焦点目标顺序错误`,
    ).toBe(expectedIndex)
    await expectInViewport(targets[focusedTarget]!, `${context} Tab 目标`)
    expectedIndex++
    if (expectedIndex === targets.length)
      return
  }

  throw new Error(`${context} 在 100 次 Tab 内未按顺序命中全部关键目标`)
}

export async function expectEscapeReturnsFocus(
  page: Page,
  overlay: Locator,
  trigger: Locator,
  context: string,
) {
  await expect(overlay, `${context} 浮层`).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay, `${context} 浮层`).toBeHidden()
  await expect(trigger, `${context} 关闭后焦点`).toBeFocused()
}

export async function expectOverlayAboveShell(overlay: Locator, context: string) {
  await overlay.evaluate(async (element) => {
    const surface = element.closest('[data-overlay-surface]')
      ?? element.querySelector('[data-overlay-surface]')
      ?? element
    const animated = [
      surface,
      ...document.querySelectorAll('[data-overlay-backdrop]'),
    ]
    await Promise.all(animated.flatMap(target =>
      target.getAnimations({ subtree: true }).map(animation =>
        animation.finished.catch(() => undefined),
      ),
    ))
  })

  const levels = await overlay.evaluate((element) => {
    const zIndex = (target: Element | null) => {
      if (!target)
        return 0
      const value = Number.parseInt(getComputedStyle(target).zIndex, 10)
      return Number.isFinite(value) ? value : 0
    }
    const shellElements = document.querySelectorAll(
      '[data-shell-topbar], [data-shell-tabbar], [data-sidebar="sidebar"]',
    )

    const surface = element.closest('[data-overlay-surface]')
      ?? element.querySelector('[data-overlay-surface]')
      ?? element
    const backdrop = [...document.querySelectorAll<HTMLElement>('[data-overlay-backdrop]')]
      .findLast((candidate) => {
        const rect = candidate.getBoundingClientRect()
        const style = getComputedStyle(candidate)
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
      })
    const rect = surface.getBoundingClientRect()
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )
    const shellHits = Array.from(shellElements)
      .filter(shell =>
        shell !== surface
        && !surface.contains(shell)
        && !shell.contains(surface),
      )
      .map((shell) => {
        const shellRect = shell.getBoundingClientRect()
        if (shellRect.width <= 0 || shellRect.height <= 0)
          return null
        const x = shellRect.left + shellRect.width / 2
        const y = shellRect.top + shellRect.height / 2
        const shellHit = document.elementFromPoint(x, y)
        const covered = shellHit != null && (
          shellHit === surface
          || surface.contains(shellHit)
          || shellHit === backdrop
          || (backdrop?.contains(shellHit) ?? false)
        )
        return {
          covered,
          hit: shellHit?.tagName.toLowerCase() ?? 'none',
          shell: shell.getAttribute('data-shell-topbar') != null
            ? 'topbar'
            : shell.getAttribute('data-shell-tabbar') != null
              ? 'tabbar'
              : 'sidebar',
        }
      })
      .filter(item => item != null)

    return {
      backdropFound: backdrop != null,
      hitInsideOverlay: hit === surface || (hit != null && surface.contains(hit)),
      hitSummary: hit
        ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${[...hit.classList].slice(0, 3).join('.')}`
        : 'none',
      overlay: zIndex(element),
      surface: zIndex(surface),
      shellHits,
      shell: Math.max(
        0,
        ...Array.from(shellElements)
          .filter(shell => shell !== element && !element.contains(shell))
          .map(zIndex),
      ),
    }
  })

  expect(levels.backdropFound, `${context} 应具有可见 backdrop`).toBe(true)
  expect(
    levels.hitInsideOverlay,
    `${context} 中心重叠点应命中浮层自身，实际命中 ${levels.hitSummary}`,
  ).toBe(true)
  expect(levels.shellHits.length, `${context} 应与至少一个应用壳元素形成验证点`).toBeGreaterThan(0)
  expect(
    levels.shellHits.filter(item => !item.covered),
    `${context} 的应用壳重叠点应由 surface 或 backdrop 覆盖`,
  ).toEqual([])
}
