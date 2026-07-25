import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

function boqWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['合和新城户内装修清单'],
    ['分部', '工种', '分项编码', '分项名称', '单位', '工程量', '不含税单价', '户型', '房间'],
    ['机电安装', '水暖工', 'PLUMB-PIPE', '给排水管安装', 'm', 43, 36, 'A', '整户范围'],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, '户内安装')
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #115：BOQ 清单、变更与月度报量', () => {
  test('真实 seed 在一个工作区展示有效合同值、签证台账与月报量', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'BOQ · 变更 · 月度报量' })).toBeVisible()
    await expect(page.getByTestId('project-switcher-trigger')).toContainText('合和新城')
    const wallRow = page.getByRole('row').filter({ hasText: '墙砖铺贴' }).first()
    await expect(wallRow).toBeVisible()
    await expect(page.getByText('(原 26)', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: /变更单/ }).click()
    await expect(page.getByRole('cell', { name: 'BG-2026-001' })).toBeVisible()
    await expect(page.getByText('已签证', { exact: true }).last()).toBeVisible()

    await page.getByRole('tab', { name: /月度报量/ }).click()
    await expect(page.getByRole('button', { name: /2026-06/ })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '地砖铺贴' })).toBeVisible()
    await expect(page.getByText('62', { exact: true }).first()).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
    expect(pageErrors).toEqual([])
  })

  test('三步拆表向导识别表头、预览并把新行回接户型工程量', async ({ page }) => {
    await page.goto('/contract/boq/import?project=proj_demo_001&contract=con_demo_sg01')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: '合同清单拆表' })).toBeVisible()

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '选择文件', exact: true }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: '新增施工清单.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: boqWorkbook(),
    })

    await expect(page.getByText('已识别 A 类', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一步：人工确认', exact: true }).click()
    await expect(page.getByRole('heading', { name: '人工确认列映射' })).toBeVisible()
    await page.getByRole('button', { name: '下一步：结果预览', exact: true }).click()
    await expect(page.getByRole('heading', { name: '拆表结果预览' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '给排水管安装' })).toContainText('43')
    await page.getByRole('button', { name: '确认导入 1 行', exact: true }).click()

    await expect(page).toHaveURL(/\/contract\/boq\?/)
    await expect(page.getByText('已导入 1 行，1 行已回接户型工程量', { exact: true })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '新增施工清单.xlsx·户内安装·3' })).toContainText('43')
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    test(`${viewport.width}px 清单/变更/报量全部可达且页面不横滚`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/contract/boq')
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('tab', { name: /合同清单/ })).toBeVisible()
      await page.getByRole('tab', { name: /变更单/ }).click()
      await expect(page.getByRole('button', { name: '新建变更单', exact: true })).toBeVisible()
      await page.getByRole('tab', { name: /月度报量/ }).click()
      await expect(page.getByText('自动汇总 + 手调留痕', { exact: true })).toBeVisible()
      await expectDocumentDoesNotOverflow(page)
    })
  }
})
