import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { expectInViewport, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

// 中央项目详情只读业务事实，从已接管领域入口穿透；尚未接管的本地阶段、文件柜、
// 成本预算、支出页签、往来支付、到货归档、验收保修页签与档案导出均不出现。

async function expectLink(page: Page, scope: Locator, name: RegExp | string, expected: { path: string, projectId: string, extra?: Record<string, string>, returnHash?: string }) {
  const link = typeof name === 'string' ? scope.getByRole('link', { name, exact: true }) : scope.getByRole('link', { name })
  await expect(link).toBeVisible()
  const target = new URL((await link.getAttribute('href'))!, page.url())
  expect(target.pathname, String(name)).toBe(expected.path)
  expect(target.searchParams.get('projectId'), String(name)).toBe(expected.projectId)
  expect(target.searchParams.get('origin'), String(name)).toBe('real')
  for (const [key, value] of Object.entries(expected.extra ?? {}))
    expect(target.searchParams.get(key), `${String(name)} ${key}`).toBe(value)
  const returnTo = target.searchParams.get('returnTo')
  if (returnTo) {
    const source = new URL(returnTo, page.url())
    expect(source.pathname, String(name)).toBe(`/project/${expected.projectId}`)
    if (expected.returnHash)
      expect(source.hash, String(name)).toBe(expected.returnHash)
  }
  return { link, target }
}

test('中央项目详情：基础资料与各领域入口保持正式身份，未接管的本地能力不出现，各宽度不溢出', async ({ page }) => {
  const input = PROJECT_INPUTS[0]
  const fixture = await installProjectCentralFixture(page, input)
  expect((await fixture.read()).item.budget.value).toBeNull()
  await fixture.open()
  await page.reload()
  await expect(page).toHaveURL(fixture.url)

  const readonly = page.getByRole('status', { name: '中央项目只读详情', exact: true })
  await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.status)
  await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.code)
  await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.address)
  await expect(readonly.getByRole('group', { name: '参建单位' })).toContainText(input.manager)
  await expect(readonly.getByRole('group', { name: '系统信息' })).toBeVisible()
  await expect(readonly.getByRole('textbox')).toHaveCount(0)
  await expect(readonly.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '编辑项目', exact: true })).toHaveAttribute('href', `/project/form/${fixture.id}?origin=real`)

  for (const name of ['编辑阶段', '导出项目档案包'])
    await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0)
  for (const name of ['成本预算', '支出合同管理', '物资管理', '竣工验收及保修'])
    await expect(page.getByRole('tab', { name, exact: true }), name).toHaveCount(0)
  for (const name of ['项目文件柜', '目标成本分类控制', '往来收款', '往来付款', '支付记录', '项目到货归档'])
    await expect(page.getByRole('region', { name, exact: true }), name).toHaveCount(0)
  await expect(page.getByRole('list', { name: '项目六阶段流程' })).toHaveCount(0)
  await expect(page.getByLabel(/上传.*阶段|上传施工组织设计方案文件/)).toHaveCount(0)

  const commercial = page.getByRole('region', { name: /^项目商务单据/ })
  await expectLink(page, page.getByRole('region', { name: '材料采购合同', exact: true }), '查看材料采购合同（0）', { path: '/contract/material', projectId: fixture.id })
  await expectLink(page, page.getByTestId('auxiliary-journey'), /其他支出合同/, { path: '/contract/other-expense', projectId: fixture.id })
  await expectLink(page, commercial, /分包变洽签/, { path: '/subcontract/change', projectId: fixture.id })
  await expectLink(page, commercial, /分包结算/, { path: '/subcontract/settlement', projectId: fixture.id })
  for (const [label, variant] of [['竣工验收', 'acceptance'], ['保修管理', 'warranty']] as const)
    await expectLink(page, commercial, new RegExp(`^${label}\\s`), { path: '/owner/acceptance', projectId: fixture.id, extra: { variant }, returnHash: `#project-owner-document-card-${variant}` })
  const receipt = await expectLink(page, page.getByRole('region', { name: '项目收款', exact: true }), '查看收款登记', { path: '/finance/receipt', projectId: fixture.id, returnHash: '#project-receipt-link' })

  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expectInViewport(page.getByRole('link', { name: '编辑项目', exact: true }), `${width}px 正式整页编辑入口`)
    await expectNoPageOverflow(page, `${width}px 中央项目详情`)
  }

  await receipt.link.click()
  await expect(page).toHaveURL(receipt.target.href)
  expect(fixture.errors).toEqual([])
})

test('中央项目详情：材采与竣工验收入口可跳转，侧栏目标成本进入正式来源', async ({ page }) => {
  const fixture = await installProjectCentralFixture(page, PROJECT_INPUTS[1])
  await fixture.open()
  const material = await expectLink(page, page.getByRole('region', { name: '材料采购合同', exact: true }), '查看材料采购合同（0）', { path: '/contract/material', projectId: fixture.id })
  await material.link.click()
  await expect(page).toHaveURL(material.target.href)

  await fixture.open()
  const acceptance = await expectLink(page, page.getByRole('region', { name: /^项目商务单据/ }), /^竣工验收\s/, { path: '/owner/acceptance', projectId: fixture.id, extra: { variant: 'acceptance' } })
  await acceptance.link.click()
  await expect(page).toHaveURL(acceptance.target.href)

  const sidebar = page.locator('[data-sidebar="sidebar"]')
  await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill('目标成本')
  const budgets = sidebar.getByRole('link', { name: '目标成本', exact: true })
  await expect(budgets).toHaveAttribute('href', '/project/target-cost')
  await budgets.click()
  await expect(page.getByRole('heading', { name: '目标成本列表', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '预算资料来源', exact: true })).toHaveValue('real')
  expect(fixture.errors).toEqual([])
})
