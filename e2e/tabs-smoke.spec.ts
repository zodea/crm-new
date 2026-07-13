import { expect, test } from '@playwright/test'

test('页签完整旅程：打开、切换、右键关闭并触发上限提示', async ({ page }) => {
  test.setTimeout(60_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  const sidebar = page.locator('[data-sidebar="sidebar"]')
  const homeTab = tabBar.getByRole('button', { name: '首页', exact: true })

  await expect(homeTab).toBeVisible()
  await expect(homeTab).toHaveAttribute('aria-current', 'page')
  await expect(tabBar.getByRole('button', { name: '关闭 首页' })).toHaveCount(0)

  await sidebar.getByRole('link', { name: '项目列表', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)

  const projectTab = tabBar.getByRole('button', { name: '项目列表', exact: true })
  await expect(projectTab).toHaveAttribute('aria-current', 'page')

  await sidebar.getByRole('link', { name: '分供方', exact: true }).click()
  await expect(page).toHaveURL(/\/base\/supplier$/)

  const supplierTab = tabBar.getByRole('button', { name: '分供方', exact: true })
  await expect(supplierTab).toHaveAttribute('aria-current', 'page')

  await sidebar.getByRole('link', { name: '发票台账', exact: true }).click()
  await expect(page).toHaveURL(/\/finance\/ledger$/)

  const ledgerTab = tabBar.getByRole('button', { name: '发票台账', exact: true })
  await expect(ledgerTab).toHaveAttribute('aria-current', 'page')

  await projectTab.click()
  await expect(page).toHaveURL(/\/project$/)
  await expect(projectTab).toHaveAttribute('aria-current', 'page')

  await projectTab.click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText([
    '关闭当前',
    '关闭其他',
    '关闭右侧',
    '关闭全部',
  ])
  await menu.getByRole('menuitem', { name: '关闭当前' }).click()

  await expect(page).toHaveURL(/\/base\/supplier$/)
  await expect(projectTab).toHaveCount(0)
  await expect(homeTab).toBeVisible()
  await expect(supplierTab).toHaveAttribute('aria-current', 'page')
  await expect(ledgerTab).toBeVisible()

  await sidebar.getByRole('link', { name: '项目列表', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)

  const projectDetailLinks = page.getByRole('link', { name: '查看项目详情' })
  await expect(projectDetailLinks.first()).toBeVisible()
  await projectDetailLinks.first().click()
  await expect(page).toHaveURL(/\/project\/[^/]+$/)

  const sidebarPagesToReachTabLimit = [
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
  ] as const

  for (const [label, path] of sidebarPagesToReachTabLimit) {
    await sidebar.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`))
  }

  await expect(page.getByTitle('当前页签数量')).toContainText('16 个页签')

  await projectTab.click()
  await expect(page).toHaveURL(/\/project$/)
  await expect(projectDetailLinks.nth(1)).toBeVisible()
  await projectDetailLinks.nth(1).click()

  const limitToast = page.getByText('页签已达上限 15 个', { exact: true })
  const limitDescription = page.getByText('请先关闭不需要的页签', { exact: true })
  await expect(limitToast).toBeVisible()
  await expect(limitDescription).toBeVisible()
  await expect(page).toHaveURL(/\/project$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('16 个页签')
  await expect(projectTab).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(limitToast).toBeHidden({ timeout: 10_000 })
  await expect(limitDescription).toBeHidden()
  expect(pageErrors, '页签完整旅程不应产生客户端运行错误').toEqual([])
})
