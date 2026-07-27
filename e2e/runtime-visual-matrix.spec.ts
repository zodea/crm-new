import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  expectEscapeReturnsFocus,
  expectInViewport,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  expectOverlayAboveShell,
  expectTabSequence,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}
const MASK_COLOR = '#e9edf4'

interface VisualSample {
  key: string
  path: string | ((width: number) => string)
  prepare: (page: Page, width: number) => Promise<void>
  masks?: (page: Page, width: number) => Locator[]
}

function stableMasks(page: Page): Locator[] {
  return [
    page.locator('[data-shell-topbar] time'),
    page.locator('[data-shell-topbar] [class*="bg-danger"]'),
  ]
}

const SAMPLES: VisualSample[] = [
  {
    key: 'shell',
    path: '/',
    prepare: async (page, width) => {
      await expect(page.locator('[data-shell-workspace]')).toBeVisible()
      if (width < 1024)
        await expect(page.getByRole('button', { name: '切换侧边栏' })).toBeVisible()
      else
        await expect(page.locator('[data-sidebar="sidebar"]').first()).toBeVisible()
    },
    masks: page => [
      ...stableMasks(page),
      page.locator('[data-shell-workspace]'),
    ],
  },
  {
    key: 'list',
    path: '/project',
    prepare: async (page) => {
      await expect(page.locator('.vxe-body--row').first()).toBeVisible()
    },
    masks: page => [
      ...stableMasks(page),
      page.locator('.vxe-body--row'),
    ],
  },
  {
    key: 'detail',
    path: '/project/proj_demo_001',
    prepare: async (page) => {
      await expect(page.getByRole('tablist').first()).toBeVisible()
    },
    masks: page => [
      ...stableMasks(page),
      page.locator('[data-shell-topbar] h1'),
      page.locator('[data-shell-workspace] .font-mono'),
      page.locator('[data-shell-workspace] .vxe-body--row'),
      page.locator('[data-shell-workspace] a.cell--link'),
    ],
  },
  {
    key: 'form',
    path: '/project/form',
    prepare: async (page) => {
      await expect(page.getByRole('heading', { name: '新建 · 项目' })).toBeVisible()
      await expect(page.getByRole('group', { name: '表单操作' })).toBeVisible()
    },
    masks: page => stableMasks(page),
  },
  {
    key: 'workspace',
    path: '/subcontract/quantity',
    prepare: async (page) => {
      await expect(page.getByRole('grid', { name: '工程量楼层房号矩阵' })).toBeVisible()
    },
    masks: page => [
      ...stableMasks(page),
      page.getByRole('combobox'),
      page.getByTestId('quantity-matrix-cell'),
    ],
  },
  {
    key: 'overlay',
    path: width => width < 1024 ? '/' : '/subcontract/quantity',
    prepare: async (page, width) => {
      if (width < 1024) {
        await page.getByRole('button', { name: '切换侧边栏' }).click()
        await expect(page.getByRole('dialog', { name: '导航菜单' })).toBeVisible()
        return
      }

      await page.getByRole('button', { name: '责任配置', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '户 × 工种责任配置' })).toBeVisible()
    },
    masks: (page, width) => [
      ...stableMasks(page),
      ...(width < 1024
        ? []
        : [page.getByTestId('quantity-assignment-unit-picker')]),
    ],
  },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('ruihang-sidebar-pinned')
    localStorage.removeItem('ruihang-sidebar-groups')
    localStorage.removeItem('ruihang-shell-theme')

    const removeNuxtDevtools = () => {
      document.querySelectorAll('nuxt-devtools-frame').forEach(frame => frame.remove())
    }
    const observeNuxtDevtools = () => {
      removeNuxtDevtools()
      new MutationObserver(removeNuxtDevtools)
        .observe(document.documentElement, { childList: true, subtree: true })
    }

    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', observeNuxtDevtools, { once: true })
    else
      observeNuxtDevtools()
  })
})

test.describe('#184 六类运行态视觉基线', () => {
  for (const sample of SAMPLES) {
    test(`${sample.key} 覆盖四档视口`, async ({ page }) => {
      test.setTimeout(120_000)

      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
        const path = typeof sample.path === 'function' ? sample.path(width) : sample.path
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        await page.addStyleTag({
          content: `
            *, *::before, *::after {
              caret-color: transparent !important;
              transition-duration: 0s !important;
            }
            nuxt-devtools-frame {
              display: none !important;
            }
          `,
        })
        await sample.prepare(page, width)
        await expectNoPageOverflow(page, `${sample.key} @ ${width}px`)

        await expect(page).toHaveScreenshot(`${sample.key}-${width}.png`, {
          animations: 'disabled',
          caret: 'hide',
          mask: sample.masks?.(page, width) ?? stableMasks(page),
          maskColor: MASK_COLOR,
          maxDiffPixelRatio: 0.001,
        })
      }
    })
  }
})

test.describe('#184 公共交互断言', () => {
  test('整页表单主操作可达且键盘顺序稳定', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/project/form')

    const firstField = page.getByLabel('项目名称 *')
    const actions = page.getByRole('group', { name: '表单操作' })
    const cancel = actions.getByRole('button', { name: '取消', exact: true })
    const save = actions.getByRole('button', { name: '保存', exact: true })

    await expectTabSequence(page, firstField, [cancel, save], '项目整页表单')
    await expectInViewport(save, '项目保存主操作')
    await expectNoPageOverflow(page, '项目整页表单 @ 390px')
  })

  test('密集矩阵局部横滚，Dialog 保持层级并在 Esc 后归还焦点', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/subcontract/quantity')

    await expectLocalHorizontalScroll(
      page.getByTestId('quantity-matrix-scroll'),
      '工程量矩阵',
    )
    await expectNoPageOverflow(page, '工程量矩阵 @ 390px')

    await page.setViewportSize({ width: 1440, height: 1000 })
    const trigger = page.getByRole('button', { name: '责任配置', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    await expectOverlayAboveShell(dialog, '责任配置 Dialog')
    await expectEscapeReturnsFocus(page, dialog, trigger, '责任配置 Dialog')
  })

  test('移动导航 Sheet 保持层级并在 Esc 后归还焦点', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    const trigger = page.getByRole('button', { name: '切换侧边栏' })
    await trigger.click()
    const sheet = page.getByRole('dialog', { name: '导航菜单' })
    await expectOverlayAboveShell(sheet, '移动导航 Sheet')
    await expectEscapeReturnsFocus(page, sheet, trigger, '移动导航 Sheet')
  })
})
