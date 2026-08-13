import { expect, test } from '@playwright/test'

// 项目详情旅程（#61）：列表↔详情双页联动、同项目复用页签、软删后详情落「不存在」态。
// 复用现有页签基建与共享 store：seed/projects.json 提供演示数据（proj_demo_001 = 合和新城）。

async function selectCustomer(page: import('@playwright/test').Page, name: string) {
  const lookup = page.getByRole('combobox', { name: '检索客户' })
  await lookup.fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
}

test('项目列表↔详情：详情编辑联动列表、同项目复用页签', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })

  // 打开详情页签：URL 命中项目 id，页签标题回填为项目名。
  await page.getByRole('link', { name: '合和新城' }).first().click()
  await expect(page).toHaveURL(/\/project\/proj_demo_001$/)
  await expect(tabBar.getByRole('button', { name: '合和新城', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '合和新城' })).toBeVisible()

  // 详情顶部编辑 → 进入整页表单改名 → 保存：详情与列表共享 store 即时更新。
  await page.getByRole('link', { name: '编辑项目', exact: true }).click()
  await expect(page).toHaveURL('/project/form/proj_demo_001')
  await page.getByLabel('项目名称 *').fill('合和新城·改')
  await page.getByRole('group', { name: '表单操作' })
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await expect(page).toHaveURL('/project/proj_demo_001')
  await expect(page.getByRole('heading', { name: '合和新城·改' })).toBeVisible()

  // 回列表：行名随共享 store 联动更新（反馈轮9 双页联动）。
  await tabBar.getByRole('button', { name: '项目列表', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)
  await expect(page.getByRole('link', { name: '合和新城·改', exact: true })).toBeVisible()

  // 同项目再次打开 → 复用同一详情页签，不新增。页签总数保持 3（首页+列表+唯一详情）
  // 即复用证据：若新开了页签会变 4。此处只断言页签数，不断言页签标题——切回后的动态
  // 标题回退是已知共性缺陷 #98（另会话处理），与本片复用逻辑无关。
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')
  await page.getByRole('link', { name: '合和新城·改', exact: true }).click()
  await expect(page).toHaveURL(/\/project\/proj_demo_001$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')

  expect(pageErrors, '列表↔详情联动旅程不应产生客户端运行错误').toEqual([])
})

test('项目详情：项目被软删后，其详情页签落到「不存在」态而非永远加载中', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')

  // 建一个无下游的新项目并打开其详情页签。
  await page.getByRole('button', { name: '新增项目' }).click()
  await expect(page).toHaveURL('/project/form')
  await page.getByLabel('项目名称 *').fill('E2E待删项目')
  await selectCustomer(page, '合和地产')
  await page.getByLabel('项目经理 *').fill('E2E项目经理')
  await page.getByRole('group', { name: '表单操作' })
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await expect(page).toHaveURL(/\/project\/proj_/)
  await expect(page.getByRole('heading', { name: 'E2E待删项目' })).toBeVisible()

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })

  // 回列表删除该项目（不撤回）。
  await tabBar.getByRole('button', { name: '项目列表', exact: true }).click()
  await expect(page).toHaveURL(/\/project$/)
  // vxe-table 固定列会把名称列和操作列渲染成两张同步表；新建记录位于首行。
  await page.getByRole('button', { name: '删除项目' }).first().click()
  const confirmDialog = page.getByRole('dialog')
  // 仅浏览详情不会自动插入 phase_tasks，因此新项目仍是无下游的 simple 删除确认。
  await expect(confirmDialog.getByPlaceholder('E2E待删项目')).toHaveCount(0)
  await confirmDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByRole('link', { name: 'E2E待删项目' })).toHaveCount(0, { timeout: 10_000 })

  // 切回详情页签：显示明确「不存在」空态与返回入口，而非卡在「加载中」。
  await tabBar.getByRole('button', { name: 'E2E待删项目', exact: true }).click()
  await expect(page.getByText('项目不存在或已被删除')).toBeVisible()
  await expect(page.getByRole('link', { name: '返回项目列表' })).toBeVisible()

  expect(pageErrors, '软删详情态旅程不应产生客户端运行错误').toEqual([])
})
