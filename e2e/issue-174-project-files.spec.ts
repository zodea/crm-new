import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

test('阶段任务文件与项目文件柜引用同一份持久化文件', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project/proj_demo_001')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /施工准备/ }).click()

  const beforeButton = page.getByRole('button', {
    name: /施工组织设计方案文件，共 \d+ 份/,
  })
  const beforeLabel = await beforeButton.getAttribute('aria-label')
  const beforeCount = Number(beforeLabel?.match(/共 (\d+) 份/)?.[1] ?? 0)
  await page.getByLabel('上传施工组织设计方案文件').setInputFiles({
    name: '施工组织设计-现场签认.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('phase-file-payload'),
  })
  await expect(page.getByText('已登记 1 份阶段文件', { exact: true })).toBeVisible()

  const taskFiles = page.getByRole('button', {
    name: `施工组织设计方案文件，共 ${beforeCount + 1} 份`,
  })
  await expect(taskFiles).toBeVisible()
  await expect(page.getByLabel('施工组织设计方案文件列表')).toContainText(
    '施工组织设计-现场签认.pdf',
  )

  await page.getByRole('button', { name: /项目文件柜/ }).click()
  const cabinet = page.getByRole('region', { name: '项目文件柜' })
  await expect(cabinet.getByText('施工组织设计-现场签认.pdf', { exact: true }).last()).toBeVisible()
  await expect(cabinet.getByText('施工准备', { exact: true }).last()).toBeVisible()
  await expect(cabinet.getByText('施工组织设计方案', { exact: true }).last()).toBeVisible()

  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /项目文件柜/ }).click()
  await expect(page.getByText('施工组织设计-现场签认.pdf', { exact: true }).last()).toBeVisible()

  expect(pageErrors, '附件闭环不应产生客户端运行错误').toEqual([])
})
