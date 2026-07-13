import { expect, test } from '@playwright/test'

test('打开多个页签后可切换并从右键菜单关闭当前页签', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  expect(pageErrors, '首页加载不应产生客户端运行错误').toEqual([])

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  const homeTab = tabBar.getByRole('button', { name: '首页', exact: true })

  await expect(homeTab).toBeVisible()
  await expect(homeTab).toHaveAttribute('aria-current', 'page')
  await expect(tabBar.getByRole('button', { name: '关闭 首页' })).toHaveCount(0)

  await page.getByRole('link', { name: '项目列表', exact: true }).click()

  await expect(page).toHaveURL(/\/project$/)
  await expect(homeTab).toBeVisible()

  const projectTab = tabBar.getByRole('button', { name: '项目列表', exact: true })
  await expect(projectTab).toBeVisible()
  await expect(projectTab).toHaveAttribute('aria-current', 'page')
  await expect(tabBar.getByRole('button', { name: '关闭 项目列表' })).toBeVisible()

  const sidebar = page.locator('[data-sidebar="sidebar"]')
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
  expect(pageErrors, '页签切换和关闭不应产生客户端运行错误').toEqual([])
})

test('第 16 个工作页签被阻断并只显示临时 toast', async ({ page }) => {
  test.setTimeout(60_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  const sidebar = page.locator('[data-sidebar="sidebar"]')

  await sidebar.getByRole('link', { name: '项目列表', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)

  const projectDetailLinks = page.getByRole('link', { name: '查看项目详情' })
  await expect(projectDetailLinks.first()).toBeVisible()
  await projectDetailLinks.first().click()
  await expect(page).toHaveURL(/\/project\/[^/]+$/)

  const workPages = [
    ['施工合同', '/contract/construction'],
    ['分包合同', '/contract/subcontract'],
    ['工程量管理', '/subcontract/quantity'],
    ['工资核算', '/subcontract/payroll'],
    ['材料采购合同', '/contract/material'],
    ['送货单识别', '/material/delivery'],
    ['单价对比', '/material/price'],
    ['发票台账', '/finance/ledger'],
    ['发票识别', '/finance/invoice'],
    ['开票·税额工具', '/finance/invoice/factor'],
    ['分供方', '/base/supplier'],
    ['班组管理', '/base/crew'],
    ['工人信息', '/base/worker'],
  ] as const

  for (const [label, path] of workPages) {
    await sidebar.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`))
  }

  await expect(page.getByTitle('当前页签数量')).toContainText('16 个页签')

  const projectTab = tabBar.getByRole('button', { name: '项目列表', exact: true })
  await projectTab.click()
  await expect(page).toHaveURL(/\/project$/)

  await expect(projectDetailLinks.nth(1)).toBeVisible()
  await projectDetailLinks.nth(1).click()

  await expect(page.getByText('页签已达上限 15 个', { exact: true })).toBeVisible()
  await expect(page.getByText('请先关闭不需要的页签', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/project$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('16 个页签')
  await expect(projectTab).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(pageErrors, '达到页签上限的完整旅程不应产生客户端运行错误').toEqual([])
})
