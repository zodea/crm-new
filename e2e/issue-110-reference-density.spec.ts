import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'

interface ElementVisualStyle {
  backgroundColor: string
  borderRadius: number
  boxShadow: string
  fontWeight: number
  height: number
}

async function visualStyle(locator: Locator): Promise<ElementVisualStyle> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)

    return {
      backgroundColor: style.backgroundColor,
      borderRadius: Number.parseFloat(style.borderTopLeftRadius),
      boxShadow: style.boxShadow,
      fontWeight: Number.parseInt(style.fontWeight, 10),
      height: element.getBoundingClientRect().height,
    }
  })
}

test.describe('Issues #110/#183 reference density and token contract', () => {
  test('real list stays on the Ruihang palette and uses flat compact geometry', async ({ page }) => {
    await page.goto('/project')
    await expect(page.locator('[data-shell-workspace]')).toBeVisible()
    await expect(page.getByRole('link', { name: '合和新城' }).first()).toBeVisible()

    const rootTokens = await page.locator('html').evaluate((element) => {
      const style = getComputedStyle(element)

      return {
        brand: style.getPropertyValue('--brand').trim().toUpperCase(),
        panel: style.getPropertyValue('--panel').trim().toUpperCase(),
      }
    })

    expect(rootTokens).toEqual({
      brand: '#3976C6',
      panel: '#FFFFFF',
    })

    const tablePanel = page.locator('.panel').filter({ has: page.locator('.vxe-table') }).first()
    const tablePanelStyle = await visualStyle(tablePanel)
    expect(tablePanelStyle.borderRadius).toBeLessThanOrEqual(4)
    expect(tablePanelStyle.boxShadow).toBe('none')

    const tableHeaderStyle = await visualStyle(page.locator('.vxe-header--column').first())
    expect(tableHeaderStyle.fontWeight).toBeGreaterThanOrEqual(700)
    expect(tableHeaderStyle.height).toBeLessThanOrEqual(38)

    const tableRowStyle = await visualStyle(page.locator('.vxe-body--row').first())
    expect(tableRowStyle.height).toBeLessThanOrEqual(38)

    await expect(page.locator('.vxe-body--row').first()).toContainText('合和新城')
  })

  test('real detail hierarchy follows the reference workflow without changing module contents', async ({ page }) => {
    await page.goto('/project/proj_demo_001')
    await expect(page.locator('[data-shell-workspace]')).toBeVisible()

    const sectionHeader = page.locator('[data-ui="section-header"]').first()
    await expect(sectionHeader).toBeVisible()
    const sectionHeaderStyle = await visualStyle(sectionHeader)
    expect(sectionHeaderStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(sectionHeaderStyle.height).toBeLessThanOrEqual(34)

    const tabs = page.getByRole('tablist').first()
    const firstTabStyle = await visualStyle(tabs.getByRole('tab').first())
    expect(firstTabStyle.height).toBeLessThanOrEqual(34)

    const detailSectionHeadingStyle = await visualStyle(page.getByRole('heading', { name: '基础信息' }).first())
    expect(detailSectionHeadingStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(detailSectionHeadingStyle.height).toBeLessThanOrEqual(34)

    const orderedSections = [
      page.getByRole('region', { name: '阶段时间线 · 任务文件' }),
      page.getByRole('heading', { name: '施工进度排程' }),
      page.getByRole('region', { name: '项目经营数据' }),
      page.getByRole('region', { name: '票据信息' }),
      tabs,
    ]
    const topPositions = await Promise.all(orderedSections.map(async locator => (await locator.boundingBox())?.y))
    expect(topPositions.every(position => position !== undefined)).toBe(true)
    expect(topPositions).toEqual([...topPositions].sort((left, right) => (left ?? 0) - (right ?? 0)))
  })

  test('search controls use compact rectangular geometry across responsive widths', async ({ page }) => {
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/project')
      await expect(page.locator('[data-shell-workspace]')).toBeVisible()

      const searchStyle = await visualStyle(page.getByRole('searchbox', { name: /搜索项目/ }))
      expect(searchStyle.borderRadius).toBeLessThanOrEqual(4)
      expect(searchStyle.height).toBeLessThanOrEqual(32)

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    }
  })
})
