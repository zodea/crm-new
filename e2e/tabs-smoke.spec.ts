import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

async function openSidebarRoute(page: Page, label: string, path: string) {
  const sidebar = page.locator('[data-sidebar="sidebar"]')
  await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill(label)
  await sidebar.getByRole('link', { name: label, exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe(path)
}

// 上限 15 指可关闭页签；固定首页另行验证，不依赖偶然的初始页签数量。
for (const input of [
  { width: 1280, first: PROJECT_INPUTS[0], second: PROJECT_INPUTS[1] },
  { width: 1440, first: PROJECT_INPUTS[1], second: PROJECT_INPUTS[0] },
]) {
  test(`页签完整旅程：正式项目、切换、右键关闭与15上限 @ ${input.width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: input.width, height: 900 })
    await page.addInitScript(() => localStorage.setItem('ruihang-sidebar-pinned', 'true'))
    const sessionId = `tabs-journey-${randomUUID()}`
    const first = await installProjectCentralFixture(page, input.first, { sessionId })
    const second = await installProjectCentralFixture(page, input.second, { sessionId })
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const tabBar = page.getByRole('navigation', { name: '已打开页面' })
    const homeTab = tabBar.getByRole('button', { name: '首页', exact: true })
    await expect(homeTab).toBeVisible()
    await expect(homeTab).toHaveAttribute('aria-current', 'page')
    await expect(tabBar.getByRole('button', { name: '关闭 首页' })).toHaveCount(0)

    await openSidebarRoute(page, '项目列表', '/project')
    const projectTab = tabBar.getByRole('button', { name: '项目列表', exact: true })
    await expect(projectTab).toHaveAttribute('aria-current', 'page')
    await openSidebarRoute(page, '分供方', '/base/supplier')
    const supplierTab = tabBar.getByRole('button', { name: '分供方', exact: true })
    await expect(supplierTab).toHaveAttribute('aria-current', 'page')
    await openSidebarRoute(page, '发票台账', '/finance/ledger')
    const ledgerTab = tabBar.getByRole('button', { name: '发票台账', exact: true })
    await expect(ledgerTab).toHaveAttribute('aria-current', 'page')

    await projectTab.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/project')
    await expect(projectTab).toHaveAttribute('aria-current', 'page')
    await projectTab.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText(['关闭当前', '关闭其他', '关闭右侧', '关闭全部'])
    await menu.getByRole('menuitem', { name: '关闭当前', exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/base/supplier')
    await expect(projectTab).toHaveCount(0)
    await expect(homeTab).toBeVisible()
    await expect(supplierTab).toHaveAttribute('aria-current', 'page')
    await expect(ledgerTab).toBeVisible()

    await openSidebarRoute(page, '项目列表', '/project')
    await page.getByRole('link', { name: input.first.name, exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/project/${first.id}`)
    expect(new URL(page.url()).searchParams.get('origin')).toBe('real')
    await expect(page.getByRole('heading', { name: input.first.name, exact: true })).toBeVisible()

    for (const [label, path] of [
      ['施工合同', '/contract/construction'],
      ['分包合同', '/contract/subcontract'],
      ['工程量管理', '/subcontract/quantity'],
      ['工资核算', '/subcontract/payroll'],
      ['材料采购合同', '/contract/material'],
      ['送货单识别', '/material/delivery'],
      ['单价对比', '/material/price'],
      ['发票识别', '/finance/invoice'],
      ['开票·税额工具', '/finance/invoice/factor'],
      ['班组管理', '/base/crew'],
      ['工人信息', '/base/worker'],
    ] as const) {
      await openSidebarRoute(page, label, path)
    }
    await expect(tabBar.getByRole('button', { name: /^关闭 / })).toHaveCount(15)
    await expect(homeTab).toBeVisible()

    await projectTab.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/project')
    await page.getByRole('link', { name: input.second.name, exact: true }).click()
    const limitToast = page.getByText('页签已达上限 15 个', { exact: true })
    const limitDescription = page.getByText('请先关闭不需要的页签', { exact: true })
    await expect(limitToast).toBeVisible()
    await expect(limitDescription).toBeVisible()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/project')
    await expect(tabBar.getByRole('button', { name: /^关闭 / })).toHaveCount(15)
    await expect(tabBar.getByRole('button', { name: input.second.name, exact: true })).toHaveCount(0)
    await expect(projectTab).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(limitToast).toBeHidden({ timeout: 10_000 })
    await expect(limitDescription).toBeHidden()
    expect(second.id).not.toBe(first.id)
    expect(pageErrors, '页签完整旅程不应产生客户端运行错误').toEqual([])
  })
}
