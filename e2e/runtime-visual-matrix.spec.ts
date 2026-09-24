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
import { VISUAL_BASE_URL, VISUAL_DATA_PROFILE } from './helpers/visual-environment'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'
const VISUAL_NOW = new Date('2026-08-12T12:00:00+08:00')
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
  sensitive?: (page: Page, width: number) => Locator[]
}

function stableSensitive(page: Page): Locator[] {
  return [
    page.locator('[data-shell-topbar] time'),
    page.locator('[data-shell-topbar] [class*="bg-danger"]'),
    page.locator('[data-shell-tab][data-active="true"] [data-tab-trigger] > .truncate'),
    page.locator('[data-shell-tabbar] [title="当前页签数量"]'),
  ]
}

function tableSensitive(page: Page): Locator[] {
  return [
    page.locator('.vxe-body--row .vxe-cell--label').filter({
      hasNot: page.locator('button'),
    }),
    page.locator('.vxe-body--row a:not(.icon-btn)'),
    page.locator('.vxe-body--row span.font-600'),
    page.locator('nav[aria-label="表格分页"] > span'),
    page.locator('nav[aria-label="表格分页"] [data-pager-page]'),
    page.locator('nav[aria-label="表格分页"] select'),
  ]
}

function workspaceSensitive(page: Page): Locator[] {
  return [
    page.getByRole('combobox'),
    page.locator('[data-shell-workspace] .font-mono'),
    page.locator('[data-shell-workspace] strong'),
    page.locator('section[aria-label="阶段进度"] article > div:first-child > span:not(.font-mono)'),
    page.locator('.quantity-matrix thead th:not(.quantity-matrix__corner)'),
    page.locator('.quantity-matrix tbody th[role="rowheader"]'),
    page.locator('[data-testid="quantity-matrix-cell"] > span'),
    page.locator('[data-testid="quantity-assignment-unit-picker"] > div:first-child > span'),
    page.locator('[data-testid="quantity-assignment-unit-picker"] fieldset section > div:first-child label'),
    page.locator('[data-testid="quantity-assignment-unit-picker"] .quantity-assignment-unit-grid label > span'),
  ]
}

function homeSensitive(page: Page): Locator[] {
  const dashboard = page.locator('[data-home-dashboard]')
  return [
    ...stableSensitive(page),
    dashboard.locator('.project-switcher-root [class*="truncate"]'),
    dashboard.locator('[data-ui="state-panel"] h2, [data-ui="state-panel"] p'),
    dashboard.locator('[data-home-partial] h2, [data-home-partial] p'),
    dashboard.locator('.home-schedule header strong'),
    dashboard.locator('.home-schedule .month-label'),
    dashboard.locator('.home-schedule .group-button .truncate'),
    dashboard.locator('.home-schedule .task-button .truncate'),
    dashboard.locator('.home-schedule .chip'),
    dashboard.locator('.home-schedule statuschip'),
  ]
}

function entityDetailSensitive(page: Page): Locator[] {
  const shell = page.locator('[data-ui="entity-detail-shell"]')
  return [
    ...stableSensitive(page),
    ...tableSensitive(page),
    shell.locator('[data-ui="entity-detail-mark"]'),
    shell.locator('header h2'),
    shell.locator('header p'),
    shell.locator('header .chip'),
    shell.locator('[data-ui="entity-detail-summary"] .font-mono'),
    shell.locator('ol li strong'),
    shell.locator('ol li span'),
    shell.locator('[role="tab"] .font-mono'),
    shell.locator('aside li span:not([aria-hidden="true"])'),
  ]
}

async function redactSensitiveText(locators: Locator[]) {
  await Promise.all(locators.map(locator =>
    locator.evaluateAll(elements => elements.forEach(element =>
      element.setAttribute('data-visual-sensitive', ''),
    )),
  ))
}

async function expectVisualEnvironment(page: Page) {
  const actual = await page.evaluate(() => {
    return {
      mode: document.querySelector<HTMLMetaElement>('meta[name="ruihang-data-profile"]')?.content,
      origin: window.location.origin,
    }
  })

  expect(actual).toEqual({
    mode: VISUAL_DATA_PROFILE,
    origin: new URL(VISUAL_BASE_URL).origin,
  })
  await expect(page.getByRole('button', { name: '关闭测试数据' }))
    .toHaveAttribute('aria-pressed', 'true')
}

async function navigateFromSidebar(page: Page, width: number, label: string) {
  let sidebar: Locator
  if (width < 1024) {
    await page.getByRole('button', { name: '切换侧边栏' }).click()
    sidebar = page.getByRole('dialog', { name: '导航菜单' })
    await expect(sidebar).toBeVisible()
  }
  else {
    sidebar = page.locator('[data-sidebar="sidebar"]').first()
  }

  await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill(label)
  await sidebar.getByRole('link', { name: label, exact: true }).click()
  await expect(page.locator('[data-shell-topbar] h1')).toHaveText(label)
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
      page.locator('[data-shell-workspace]'),
    ],
    sensitive: page => stableSensitive(page),
  },
  {
    key: 'home-dashboard-default',
    path: '/?project=proj_demo_001',
    prepare: async (page) => {
      await expect(page.locator('[data-home-dashboard] .home-schedule')).toBeVisible()
    },
    sensitive: page => homeSensitive(page),
  },
  {
    key: 'home-dashboard-loading',
    path: '/dev/home-dashboard?state=loading',
    prepare: async (page) => {
      await expect(page.locator('[data-home-dashboard] [data-state="loading"]')).toBeVisible()
    },
    sensitive: page => homeSensitive(page),
  },
  {
    key: 'home-dashboard-empty',
    path: '/dev/home-dashboard?state=schedule-empty',
    prepare: async (page) => {
      await expect(page.locator('[data-home-dashboard] [data-state="empty"]')).toBeVisible()
    },
    sensitive: page => homeSensitive(page),
  },
  {
    key: 'home-dashboard-partial',
    path: '/dev/home-dashboard?state=partial',
    prepare: async (page) => {
      await expect(page.locator('[data-home-dashboard] [data-home-partial]')).toBeVisible()
      await expect(page.locator('[data-home-dashboard] .home-schedule')).toBeVisible()
    },
    sensitive: page => homeSensitive(page),
  },
  {
    key: 'home-dashboard-error',
    path: '/dev/home-dashboard?state=error',
    prepare: async (page) => {
      await expect(page.locator('[data-home-dashboard] [data-state="error"]')).toBeVisible()
    },
    sensitive: page => homeSensitive(page),
  },
  {
    key: 'shell-stress',
    path: '/',
    prepare: async (page, width) => {
      await navigateFromSidebar(page, width, '项目列表')
      const detailLink = page.getByRole('link', { name: '合和新城', exact: true }).first()
      await expect(detailLink).toBeVisible()
      await detailLink.click()
      await expect(page).toHaveURL(/\/project\/[^/]+$/)

      for (const label of [
        '施工合同',
        '分包合同',
        '工程量管理',
        '工资核算',
        '材料采购合同',
        '送货单识别',
        '单价对比',
        '发票识别',
        '发票台账',
        '分供方',
      ])
        await navigateFromSidebar(page, width, label)

      await expect(page.locator('[data-ui="supplier-list-table"] .vxe-body--row').first())
        .toBeVisible()

      const tabList = page.getByRole('navigation', { name: '已打开页面' })
      await expect(page.getByRole('button', { name: '向前翻动页签' })).toBeVisible()
      await expect(page.getByRole('button', { name: '向后翻动页签' })).toBeVisible()
      expect(await tabList.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)

      if (width < 1024)
        await page.getByRole('button', { name: '切换侧边栏' }).click()
      await page.getByRole('searchbox', { name: '搜索菜单' }).fill('合同')
      const firstResult = page.locator('[data-sidebar="sidebar"]').last().getByRole('link', { name: '施工合同' })
      await expect(firstResult).toBeVisible()
      await expect(firstResult).toBeInViewport()
      if (width < 1024) {
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: '导航菜单' })).toBeHidden()
      }
    },
    sensitive: page => [
      ...stableSensitive(page),
      page.locator('[data-shell-workspace] *'),
      page.locator('[data-shell-tab] [data-tab-trigger] > .truncate'),
    ],
  },
  {
    key: 'notification-sheet',
    path: '/',
    prepare: async (page, width) => {
      await page.getByRole('button', { name: /打开通知中心/ }).click()
      const sheet = page.getByRole('dialog', { name: '消息中心' })
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveAttribute('data-sheet-placement', width <= 768 ? 'bottom' : 'right')
      await sheet.evaluate(element =>
        Promise.all(element.getAnimations().map(animation => animation.finished)),
      )
    },
    sensitive: page => [
      ...stableSensitive(page),
      page.locator('[data-shell-workspace] *'),
      page.getByRole('dialog', { name: '消息中心' }).locator('[data-notification-count]'),
      page.getByRole('dialog', { name: '消息中心' }).locator('article span:not([aria-hidden="true"])'),
    ],
  },
  {
    key: 'list',
    path: '/project',
    prepare: async (page) => {
      await expect(page.locator('.vxe-body--row').first()).toBeVisible()
      await page.locator('.vxe-body--row span[class*="cell--status"], .vxe-body--row span.font-600')
        .evaluateAll(elements => elements.forEach(element =>
          element.setAttribute('data-visual-status', ''),
        ))
    },
    sensitive: page => [
      ...stableSensitive(page),
      ...tableSensitive(page),
      page.locator('.vxe-body--row [data-visual-status]'),
      page.locator('[data-shell-workspace] section.panel').first().locator('.text-12px.text-ink-soft').first(),
    ],
  },
  {
    key: 'detail',
    path: '/project/proj_demo_001?origin=demo',
    prepare: async (page) => {
      await expect(page.locator('[data-ui="project-detail-screen"]')).toBeVisible()
      await expect(page.getByRole('status', { name: '测试数据只读详情' })).toBeVisible()
    },
    sensitive: page => [
      ...stableSensitive(page),
      ...tableSensitive(page),
      page.locator('[data-shell-topbar] h1'),
      page.locator('[data-shell-workspace] h2'),
      page.locator('[data-shell-workspace] h2').locator('xpath=../following-sibling::div[1]'),
      page.locator('[data-shell-workspace] h2').locator('xpath=following-sibling::span[1]'),
      page.locator('[data-shell-workspace] h2').locator('xpath=../../preceding-sibling::span[1]'),
      page.locator('[data-shell-workspace] .info-cell > div:last-child'),
      page.locator('[data-shell-workspace] .font-mono'),
      page.locator('[data-shell-workspace] strong'),
      page.locator('[data-shell-workspace] .text-right'),
      page.locator('[data-shell-workspace] section[aria-labelledby="project-phase-title"] [class*="min-w-48"]'),
      page.locator('[data-shell-workspace] .space-y-1\\.5 > div > .chip'),
      page.locator('[data-shell-workspace] section[aria-labelledby="project-phase-title"] button[aria-label*="文件，共"]'),
      page.locator('[data-shell-workspace] section.panel.mb-3 .grid.gap-2 > div > span:first-child'),
      page.locator('[data-shell-workspace] #project-file-list-title + .chip'),
      page.locator('[data-shell-workspace] .chip-brand'),
      page.locator('[data-shell-workspace] a.cell--link'),
      page.locator('[data-ui="project-detail-screen"] header p'),
      page.locator('[data-ui="project-detail-screen"] header dd'),
      page.locator('[data-ui="project-info-section"] dd'),
    ],
  },
  {
    key: 'entity-detail-shell',
    path: '/dev/detail-shell',
    prepare: async (page) => {
      await expect(page.getByRole('heading', {
        name: '华南区域机电设备与建筑辅材长期战略合作分供方有限公司',
      })).toBeVisible()
      await expect(page.getByRole('complementary', { name: '文件与动态' })).toBeVisible()
    },
    sensitive: page => entityDetailSensitive(page),
  },
  {
    key: 'form',
    path: '/project/form',
    prepare: async (page) => {
      await expect(page.getByRole('heading', { name: '新建 · 项目' })).toBeVisible()
      await expect(page.getByRole('group', { name: '表单操作' })).toBeVisible()
    },
    sensitive: page => stableSensitive(page),
  },
  {
    key: 'workspace',
    path: '/subcontract/quantity',
    prepare: async (page) => {
      await expect(page.getByRole('grid', { name: '工程量楼层房号矩阵' })).toBeVisible()
    },
    sensitive: page => [
      ...stableSensitive(page),
      ...workspaceSensitive(page),
      page.getByText(/\d+\s*\/\s*\d+\s*户/),
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
    sensitive: (page, width) => [
      ...stableSensitive(page),
      ...workspaceSensitive(page),
      ...(width < 1024
        ? [page.locator('[data-shell-workspace] *')]
        : []),
    ],
  },
]

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: VISUAL_NOW })
  await page.addInitScript((dataVisibilityStorageKey) => {
    localStorage.removeItem('ruihang-sidebar-pinned')
    localStorage.removeItem('ruihang-sidebar-groups')
    localStorage.removeItem('ruihang-shell-theme')
    localStorage.setItem(dataVisibilityStorageKey, 'true')

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
  }, DATA_VISIBILITY_STORAGE_KEY)
})

test.describe('#184 / #186 / #187 / #188 / #189 运行态视觉基线', () => {
  for (const sample of SAMPLES) {
    for (const width of RESPONSIVE_WIDTHS) {
      test(`${sample.key} @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
        const path = typeof sample.path === 'function' ? sample.path(width) : sample.path
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        await expectVisualEnvironment(page)
        await page.addStyleTag({
          content: `
            :root {
              --font-sans: "Microsoft YaHei", sans-serif !important;
              --font-mono: Consolas, "Courier New", monospace !important;
            }
            [data-shell-topbar] [class*="bg-danger"] {
              width: 16px !important;
              min-width: 16px !important;
              padding: 0 !important;
              font-size: 0 !important;
            }
            input[type="date"][data-visual-empty-date]::-webkit-datetime-edit {
              color: transparent !important;
            }
            *, *::before, *::after {
              caret-color: transparent !important;
              transition-duration: 0s !important;
            }
            [data-visual-sensitive],
            [data-visual-sensitive] * {
              color: transparent !important;
              -webkit-text-fill-color: transparent !important;
              text-shadow: none !important;
            }
            [data-visual-status] {
              position: relative;
            }
            [data-visual-status]::after {
              position: absolute;
              top: 50%;
              left: 0;
              width: 30px;
              height: 4px;
              border-radius: 999px;
              content: "";
              transform: translateY(-50%);
            }
            [data-visual-status].cell--status-warn::after {
              background: var(--warn);
            }
            [data-visual-status].cell--status-ok::after {
              background: var(--ok);
            }
            [data-visual-status].text-brand-deep::after {
              background: var(--brand);
            }
            [data-visual-status].text-ink-soft::after {
              background: var(--ink-faint);
            }
            nuxt-devtools-frame {
              display: none !important;
            }
            .today-line,
            .today-label {
              left: 50% !important;
            }
          `,
        })
        await sample.prepare(page, width)
        await page.locator('input[type="date"]').evaluateAll(inputs => inputs.forEach((input) => {
          if (input instanceof HTMLInputElement && !input.value)
            input.dataset.visualEmptyDate = ''
        }))
        await redactSensitiveText(sample.sensitive?.(page, width) ?? stableSensitive(page))
        if (sample.key === 'detail') {
          await page.getByTestId('project-schedule-progress-value')
            .evaluateAll(elements => elements.forEach((element) => {
              if (element instanceof HTMLElement)
                element.style.width = '50%'
            }))
        }
        await expectNoPageOverflow(page, `${sample.key} @ ${width}px`)

        await expect(page).toHaveScreenshot(`${sample.key}-${width}.png`, {
          animations: 'disabled',
          caret: 'hide',
          mask: sample.masks?.(page, width) ?? [],
          maskColor: MASK_COLOR,
          maxDiffPixels: 0,
        })
      })
    }
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
