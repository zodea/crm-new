import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installMaterialProductionFixture } from './helpers/material-production-fixture'
import { expectInViewport, expectLocalHorizontalScroll, expectNoPageOverflow } from './helpers/responsive'

const PRICE_INPUTS = [
  { key: 'wire', orderNo: 'E2E-PRICE-WIRE-LATEST', query: '电线', materialName: 'BV 电线', spec: '2.5 mm²', unit: 'm', qty: 1000, firstPrice: 2.5, nextPrice: 2.8, nextAmount: 2800, nextSupplier: false, heading: 'BV 电线 · 1×2.5 mm²', chart: 'BV 电线 1×2.5 mm² 价格趋势图', option: /BV 电线.*2\.5 mm².*m/, prices: ['¥2.50', '¥2.80'], expectedOfficialChange: '-0.47%' },
  { key: 'steel', orderNo: 'E2E-PRICE-STEEL-LATEST', query: 'HRB400', materialName: 'HRB400 螺纹钢', spec: 'Φ12', unit: '吨', qty: 1, firstPrice: 3800, nextPrice: 3950, nextAmount: 3950, nextSupplier: true, heading: 'HRB400 螺纹钢 · Φ12', chart: 'HRB400 螺纹钢 Φ12 价格趋势图', option: /HRB400 螺纹钢.*Φ12.*吨/, prices: ['¥3,800.00', '¥3,950.00'] },
] as const
const VIEWPORTS = [390, 768, 1024, 1280, 1440] as const
const SOURCE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='

async function openPriceAnalysisWithFacts(page: Page, input: (typeof PRICE_INPUTS)[number]) {
  await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  const fixture = await installMaterialProductionFixture(page, { deliveryLines: [{ materialName: input.materialName, spec: input.spec, unit: input.unit, qty: input.qty, unitPrice: input.firstPrice, amount: input.qty * input.firstPrice, amountSource: 'manual', note: '合成价格事实' }] })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const identity = { workspaceId: session.workspaceId, actorId: session.actorId }
  let supplierId = fixture.supplierId
  if (input.nextSupplier) {
    const created = await page.request.post('/api/commands/suppliers', { data: { ...identity, requiredCapability: 'supplier:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: 'E2E价格比较第二厂家', supplierCategory: '材料供应商', aliases: [] }, attachments: {} } })
    expect(created.ok(), await created.text()).toBe(true)
    supplierId = (await created.json()).id
  }
  const orderNo = input.orderNo
  const archived = await page.request.post('/api/commands/deliveries', { data: {
    ...identity,
    requiredCapability: 'delivery:write',
    commandId: randomUUID(),
    origin: 'real',
    baseVersion: null,
    action: 'archive',
    uploadBatchId: null,
    source: { fileName: `${input.key}-price.png`, mimeType: 'image/png', fileSize: Buffer.from(SOURCE_PNG, 'base64').length, payloadBase64: SOURCE_PNG },
    draft: { projectId: fixture.projectId, supplierId, orderNo, deliveryDate: '2026-09-01', note: '合成后续归档价格', rawSiteText: fixture.projectSiteAlias, reviewFlag: '', confirmations: {}, lines: [{ materialName: input.materialName, spec: input.spec, unit: input.unit, qty: input.qty, unitPrice: input.nextPrice, amount: input.nextAmount, amountSource: 'manual', note: '' }] },
  } })
  expect(archived.ok(), await archived.text()).toBe(true)
  const latest = await archived.json()
  await page.goto('/material/price?origin=real')
  const search = page.getByRole('searchbox', { name: '搜索材料名称、规格或单位' })
  await expect(search).toBeVisible({ timeout: 30_000 })
  await search.fill(input.query)
  await page.getByRole('option', { name: input.option }).click()
  await expect(page.getByRole('heading', { name: input.heading, exact: true })).toBeVisible()
  return { ...fixture, latestId: latest.id, orderNo }
}

test.describe('材料单价分析中央归档价格事实', () => {
  for (const input of PRICE_INPUTS) {
    test(`${input.query} 搜索、真实价格、归档来源与厂家合同下钻`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      const fixture = await openPriceAnalysisWithFacts(page, input)
      if (input.nextSupplier) {
        await expect(page.getByText('厂家最新价对比', { exact: true })).toBeVisible()
        const comparison = page.getByRole('list', { name: '厂家最新价' })
        for (const price of input.prices)
          await expect(comparison).toContainText(price)
        await expect(comparison.getByRole('link', { name: `来源 ${fixture.orderNo}`, exact: true })).toHaveAttribute('href', `/material/delivery/archive/${fixture.latestId}?origin=real`)
      }
      else {
        await expect(page.getByText('官方与市场趋势', { exact: true })).toBeVisible()
        await expect(page.getByRole('img', { name: input.chart, exact: true })).toBeVisible()
        const officialComparison = page.getByRole('region', { name: '官方信息价对比' })
        await expect(officialComparison.getByText('信息价环比')).toBeVisible()
        await expect(officialComparison.getByText(input.expectedOfficialChange, { exact: true })).toBeVisible()
      }
      await page.getByText(/查看全部 \d+ 个价格来源/).click()
      await expect(page.locator('details').getByRole('link', { name: new RegExp(fixture.orderNo) })).toHaveAttribute('href', `/material/delivery/archive/${fixture.latestId}?origin=real`)
      const contracts = page.getByRole('region', { name: '相关厂家合作合同' })
      await expect(contracts.getByText(fixture.projectName, { exact: true })).toBeVisible()
      await expect(contracts.getByRole('link', { name: fixture.contractName, exact: true })).toHaveAttribute('href', `/contract/${fixture.contractId}?contractKind=material&origin=real`)
    })
    test(`${input.query} 各宽度趋势与合作合同可达，且只在自身区域滚动`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const fixture = await openPriceAnalysisWithFacts(page, input)
      const visual = input.nextSupplier ? page.getByRole('list', { name: '厂家最新价' }) : page.getByRole('img', { name: input.chart, exact: true })
      for (const width of VIEWPORTS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
        await visual.scrollIntoViewIfNeeded()
        await expectInViewport(visual, `${width}px ${input.query}价格事实`)
        await expectNoPageOverflow(page, `${width}px 材料单价分析`)
        if (!input.nextSupplier && width <= 1024)
          await expectLocalHorizontalScroll(page.getByTestId('material-price-trend-scroll'), `${width}px ${input.query}趋势图`)
      }
      const contracts = page.getByRole('region', { name: '相关厂家合作合同' })
      await contracts.scrollIntoViewIfNeeded()
      await expect(contracts.getByRole('link', { name: fixture.contractName, exact: true })).toBeVisible()
    })
  }
})
