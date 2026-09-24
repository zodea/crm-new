import type { Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

async function prepare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
  })
  const fixture = await installQuantityProductionFixture(page, { totals: true })
  await page.goto(`/subcontract/quantity/${fixture.projectId}/${fixture.units['201']}?origin=real&returnTo=${encodeURIComponent(fixture.matrixUrl)}`)
  await expect(page.getByRole('heading', { name: /1栋 2层 201户/ })).toBeVisible({ timeout: 60_000 })
}

test.describe('Issue #440 工程量三量合计与真实导出', () => {
  test('中央慢响应导出先选择目录，再读取和写入当前台账', async ({ page }) => {
    test.setTimeout(120_000)
    await prepare(page)
    await page.getByRole('link', { name: '返回工程量矩阵' }).click()
    const exportButton = page.getByRole('button', { name: '导出台账', exact: true })
    await expect(exportButton).toBeEnabled()
    await page.evaluate(() => {
      const state = { picked: false, active: false, size: 0 }
      Object.assign(window, { quantityExportTest: state })
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
        state.picked = true
        state.active = navigator.userActivation.isActive
        return { name: '合成导出目录', getFileHandle: async (_name: string, options: { create: boolean }) => {
          if (!options.create)
            throw new DOMException('合成目录没有同名文件', 'NotFoundError')
          return { createWritable: async () => ({
            write: async (data: Uint8Array) => { state.size = data.byteLength },
            close: async () => {},
          }) }
        } }
      } })
    })
    await page.route('**/api/read/quantity/workspace?**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 6_500))
      await route.continue()
    })
    try {
      await exportButton.click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { quantityExportTest: { picked: boolean } }).quantityExportTest.picked), { timeout: 2_000 }).toBe(true)
      await expect.poll(() => page.evaluate(() => (window as unknown as { quantityExportTest: { size: number } }).quantityExportTest.size), { timeout: 15_000 }).toBeGreaterThan(100)
      expect(await page.evaluate(() => (window as unknown as { quantityExportTest: { active: boolean } }).quantityExportTest.active)).toBe(true)
    }
    finally {
      await page.unrouteAll({ behavior: 'wait' })
    }
  })

  test('五档视口分单位合计、共用分项去重与缺量说明键盘往返', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await prepare(page)
    const footer = page.getByRole('region', { name: '全户合计' })
    await expect(footer.getByRole('group', { name: '㎡全户合计' })).toContainText(/暂估量\s*30/)
    await expect(footer.getByRole('group', { name: '㎡全户合计' })).toContainText(/合同量\s*0/)
    await expect(footer.getByRole('group', { name: 'm全户合计' })).toContainText(/现场量\s*8/)
    await expect(footer).toContainText('缺 1 项')

    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 960 })
      await footer.scrollIntoViewIfNeeded()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      const help = footer.getByRole('button', { name: '查看全户现场量合计说明' })
      await help.focus()
      await help.press('Enter')
      const popover = page.locator('[data-ui="context-help-popover"]')
      await expect(popover).toContainText('已知部分为 12，不能作为完整合计')
      const bounds = await popover.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`totals-${width}.png`), fullPage: true })
      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
      await expect(help).toBeFocused()
      if (width === 390) {
        const hasLocalScroll = await page.locator('.overflow-x-auto').evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth))
        expect(hasLocalScroll).toBe(true)
      }
    }
    expect(errors).toEqual([])
  })

  test('从实际页面下载台账，缺值为空而数字零保留，按单位分行且非报量阶段不带量', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await prepare(page)
    await page.getByRole('link', { name: '返回工程量矩阵' }).click()
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出台账', exact: true }).click()
    const download = await event
    const artifactPath = testInfo.outputPath('quantity-ledger.xlsx')
    await download.saveAs(artifactPath)
    const workbook = XLSX.read(await readFile(artifactPath), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['月度完成量']!, { defval: '' })
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.单位 === '㎡')).toMatchObject({
      月份: '2026-08',
      工序阶段: '泥水完成',
      完成户数: 1,
      合同量: 0,
      合同量完整度: '完整',
      暂估量: 30,
      现场量: '',
      现场量完整度: '缺 1 项',
      现场量已知部分: 12,
    })
    expect(rows.find(row => row.单位 === 'm')).toMatchObject({ 现场量: 8, 现场量完整度: '完整' })
    expect(download.suggestedFilename()).toMatch(/^E2E正式工程量项目_工程量台账_\d{4}-\d{2}-\d{2}\.xlsx$/)
    await writeFile(testInfo.outputPath('workbook-readback.json'), JSON.stringify({ fileName: download.suggestedFilename(), sheets: workbook.SheetNames, monthly: rows }, null, 2))
  })
})
