import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

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
  for (const input of PROJECT_INPUTS) {
    test(`central list retains the Ruihang palette and compact geometry: ${input.label}`, async ({ page }) => {
      const fixture = await installProjectCentralFixture(page, input)
      await page.goto('/project')
      await expect(page.locator('[data-shell-workspace]')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('link', { name: input.name, exact: true }).first()).toBeVisible({ timeout: 20_000 })

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

      await expect(page.getByRole('link', { name: input.name, exact: true }).first()).toHaveAttribute('href', new RegExp(`/project/${fixture.id}\\?origin=real&`))
    })

    test(`central detail keeps the current readonly hierarchy and compact headings: ${input.label}`, async ({ page }) => {
      const fixture = await installProjectCentralFixture(page, input)
      await fixture.open()
      await expect(page.locator('[data-shell-workspace]')).toBeVisible()

      const detailSectionHeadingStyle = await visualStyle(page.getByText('项目商务单据', { exact: true }))
      expect(detailSectionHeadingStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(detailSectionHeadingStyle.height).toBeLessThanOrEqual(34)

      const metadata = page.locator('header[aria-labelledby="project-detail-title"]')
      await expect(metadata).toContainText(input.manager)
      const orderedSections = [metadata, page.getByRole('region', { name: '材料采购合同', exact: true }), page.getByRole('region', { name: '项目收款', exact: true }), page.getByRole('region', { name: /^项目商务单据/ }), page.getByRole('status', { name: '中央项目只读详情', exact: true })]
      const topPositions = await Promise.all(orderedSections.map(async locator => (await locator.boundingBox())?.y))
      expect(topPositions.every(position => position !== undefined)).toBe(true)
      expect(topPositions).toEqual([...topPositions].sort((left, right) => (left ?? 0) - (right ?? 0)))
    })
  }

  for (const width of [390, 768, 1024, 1280, 1440]) {
    test(`search controls retain compact geometry at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/project')
      await expect(page.locator('[data-shell-workspace]')).toBeVisible()

      const searchStyle = await visualStyle(page.getByRole('searchbox', { name: /搜索项目/ }))
      expect(searchStyle.borderRadius).toBeLessThanOrEqual(4)
      expect(searchStyle.height).toBeLessThanOrEqual(32)

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    })
  }
})
