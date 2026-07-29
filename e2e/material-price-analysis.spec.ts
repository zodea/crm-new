import type { Page } from '@playwright/test'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import initSqlJs from 'sql.js'
import {
  expectInViewport,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const SQL_JS = initSqlJs({
  locateFile: file => path.resolve('node_modules/sql.js/dist', file),
})

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

async function readBrowserSnapshot(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crm-new-browser', 1)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      const transaction = database.transaction('database_snapshots', 'readonly')
      const value = await new Promise<ArrayBuffer | Uint8Array>((resolve, reject) => {
        const request = transaction.objectStore('database_snapshots').get('main')
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
      })
      return Array.from(value instanceof Uint8Array ? value : new Uint8Array(value))
    }
    finally {
      database.close()
    }
  })
}

async function writeBrowserSnapshot(page: Page, bytes: number[]) {
  await page.evaluate(async (snapshot) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crm-new-browser', 1)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('database_snapshots', 'readwrite')
        transaction.objectStore('database_snapshots').put(
          new Uint8Array(snapshot).buffer,
          'main',
        )
        transaction.addEventListener('complete', () => resolve(), { once: true })
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
        transaction.addEventListener('error', () => reject(transaction.error), { once: true })
      })
    }
    finally {
      database.close()
    }
  }, bytes)
}

async function snapshotWithPriceFacts(snapshot: number[]): Promise<number[]> {
  const SQL = await SQL_JS
  const database = new SQL.Database(new Uint8Array(snapshot))
  try {
    database.run(`
      INSERT INTO delivery_records (
        id, project_id, supplier_id, order_no, delivery_date,
        ocr_status, archived, created_at, updated_at
      ) VALUES
        (
          'del_price_cmp_b', 'proj_demo_001', 'sup_demo_002', 'XS-CMP-001',
          '2026-07-13', 'reviewed', 1,
          '2026-07-13T09:00:00.000Z', '2026-07-13T09:00:00.000Z'
        ),
        (
          'del_price_trend_1', 'proj_demo_002', 'sup_demo_002', 'XS-TREND-001',
          '2026-06-01', 'reviewed', 1,
          '2026-06-01T09:00:00.000Z', '2026-06-01T09:00:00.000Z'
        ),
        (
          'del_price_trend_2', 'proj_demo_002', 'sup_demo_002', 'XS-TREND-002',
          '2026-07-01', 'reviewed', 1,
          '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z'
        );

      INSERT INTO delivery_lines (
        id, delivery_record_id, material_name, spec, unit, qty,
        unit_price, amount, amount_source, sort_order, created_at, updated_at
      ) VALUES
        (
          'dline_price_cmp_b', 'del_price_cmp_b', 'HRB400 螺纹钢', 'Φ12', '吨',
          1, 3950, 3950, 'manual', 0,
          '2026-07-13T09:00:00.000Z', '2026-07-13T09:00:00.000Z'
        ),
        (
          'dline_price_trend_1', 'del_price_trend_1', 'BV 电线', '2.5 mm²', 'm',
          1000, 2.50, 2500, 'manual', 0,
          '2026-06-01T09:00:00.000Z', '2026-06-01T09:00:00.000Z'
        ),
        (
          'dline_price_trend_2', 'del_price_trend_2', 'BV 电线', '2.5 mm²', 'm',
          1000, 2.80, 2800, 'manual', 0,
          '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z'
        );
    `)
    return Array.from(database.export())
  }
  finally {
    database.close()
  }
}

async function openPriceAnalysisWithFacts(page: Page) {
  await page.goto('/material/price')
  await expect(page.getByRole('searchbox', { name: '搜索材料名称、规格或单位' }))
    .toBeVisible({ timeout: 15_000 })

  const seededSnapshot = await readBrowserSnapshot(page)
  await writeBrowserSnapshot(page, await snapshotWithPriceFacts(seededSnapshot))
  await page.reload()
  await expect(page.getByRole('searchbox', { name: '搜索材料名称、规格或单位' }))
    .toBeVisible({ timeout: 15_000 })
}

test.describe('材料单价分析真实价格事实', () => {
  test('搜索选择材料后按事实切换趋势与厂家比较，并提供来源和合同下钻', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openPriceAnalysisWithFacts(page)

    const search = page.getByRole('searchbox', { name: '搜索材料名称、规格或单位' })
    await search.fill('电线')
    await page.getByRole('option', { name: /BV 电线.*2\.5 mm².*m/ }).click()

    await expect(page.getByRole('heading', { name: 'BV 电线 · 2.5 mm²' })).toBeVisible()
    await expect(page.getByText('官方与市场趋势', { exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'BV 电线 2.5 mm² 价格趋势图' })).toBeVisible()
    await page.getByText(/查看全部 \d+ 个价格来源/).click()
    await expect(page.getByRole('link', { name: /XS-TREND-002/ })).toHaveAttribute(
      'href',
      '/material/delivery/archive/del_price_trend_2',
    )

    const contracts = page.getByRole('region', { name: '相关厂家合作合同' })
    await expect(contracts.getByText('锦绣华庭')).toBeVisible()
    await expect(contracts.getByRole('link', { name: '电线电缆采购合同' }))
      .toHaveAttribute('href', '/contract/con_demo_cg04')

    await search.fill('HRB400')
    await page.getByRole('option', { name: /HRB400 螺纹钢.*Φ12.*吨/ }).click()
    await expect(page.getByText('厂家最新价对比', { exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: '厂家最新价' })).toContainText('¥3,800.00')
    await expect(page.getByRole('list', { name: '厂家最新价' })).toContainText('¥3,950.00')
    await expect(page.getByRole('list', { name: '厂家最新价' }).getByRole('link', { name: /XS-CMP-001/ }))
      .toHaveAttribute('href', '/material/delivery/archive/del_price_cmp_b')
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`搜索、材料选择和趋势图在 ${width}px 可达且页面不横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await openPriceAnalysisWithFacts(page)

      const search = page.getByRole('searchbox', { name: '搜索材料名称、规格或单位' })
      await search.fill('电线')
      await page.getByRole('option', { name: /BV 电线.*2\.5 mm².*m/ }).click()

      const chart = page.getByRole('img', { name: 'BV 电线 2.5 mm² 价格趋势图' })
      await chart.scrollIntoViewIfNeeded()
      await expectInViewport(chart, `${width}px 价格趋势图`)
      await expectNoPageOverflow(page, `${width}px 材料单价分析`)

      if (width <= 1024) {
        await expectLocalHorizontalScroll(
          page.getByTestId('material-price-trend-scroll'),
          `${width}px 价格趋势图`,
        )
      }

      const contracts = page.getByRole('region', { name: '相关厂家合作合同' })
      await contracts.scrollIntoViewIfNeeded()
      await expect(contracts).toBeVisible()
      await expect(contracts.getByRole('link', { name: '电线电缆采购合同' })).toBeVisible()
    })
  }
})
