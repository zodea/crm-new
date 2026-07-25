import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

// 项目导入落库旅程（#58 验收「导入走 #81 映射页签并真实插入行、出现在列表」）：
// 从项目列表工具栏触发 → 映射页签解析与预匹配 → 逐行经 store.add 真实入库 →
// 页签自动关闭回列表 → 新行可见。顺带验证非法阶段值经 normalizeProjectStatus 归一。

test('项目导入：从列表触发映射页签，导入后真实新增行并回到列表可见', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('共 12 个')).toBeVisible()

  // 从项目列表工具栏触发导入（实体触发、模板隐含）。
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await expect(page).toHaveURL(/\/import\/mapping\/project$/)
  await expect(page.getByText('施工项目 · 模板驱动，源列映射到系统字段')).toBeVisible()

  // 表头与模板标签逐字同名 → 智能预匹配全部命中，必填（项目名称）已映上。
  // 「在建」不在 PROJECT_STATUSES 内，用于验证 status 归一回落「筹备中」。
  await page.getByLabel('选择导入文件').setInputFiles({
    name: 'projects.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      '项目名称,客户,项目经理,业务流程阶段',
      '导入项目甲,合和地产,张三,施工中',
      '导入项目乙,锦绣置业,李四,在建',
    ].join('\n'), 'utf-8'),
  })

  const fieldRow = (key: string) => page.locator(`[data-field="${key}"]`)
  await expect(fieldRow('name')).toHaveAttribute('data-status', 'matched')
  await expect(fieldRow('customerName')).toHaveAttribute('data-status', 'matched')
  await expect(fieldRow('manager')).toHaveAttribute('data-status', 'matched')
  await expect(fieldRow('status')).toHaveAttribute('data-status', 'matched')

  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByRole('table')).toContainText('导入项目甲')
  await page.getByRole('button', { name: '开始导入' }).click()

  // 成功后页签自动关闭并回到列表。
  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已导入 2 行：施工项目', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/project$/)

  // 真实入库：新行经共享 store 出现在列表，总数 12 → 14。
  await expect(page.getByText('共 14 个')).toBeVisible()
  await expect(page.getByRole('link', { name: '导入项目甲' })).toBeVisible()
  await expect(page.getByRole('link', { name: '导入项目乙' })).toBeVisible()

  // 合法阶段原样保留；非法「在建」归一为「筹备中」，不写进非法阶段值。
  await expect(page.getByRole('cell', { name: '施工中', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: '在建', exact: true })).toHaveCount(0)

  expect(pageErrors, '项目导入旅程不应产生客户端运行错误').toEqual([])
})
