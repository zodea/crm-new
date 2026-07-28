import type { Page } from '@playwright/test'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import initSqlJs from 'sql.js'
import { expectInViewport, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

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

async function snapshotWithoutProjects(snapshot: number[]): Promise<number[]> {
  const SQL = await SQL_JS
  const database = new SQL.Database(new Uint8Array(snapshot))
  try {
    database.run('DROP TABLE projects')
    return Array.from(database.export())
  }
  finally {
    database.close()
  }
}

test.describe('Issue #185：项目页面状态与恢复旅程', () => {
  test('真实项目列表覆盖默认、加载、错误与重试', async ({ page }) => {
    test.setTimeout(60_000)
    await page.route('**/sql-wasm.wasm', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.continue()
    })

    await page.goto('/project', { waitUntil: 'commit' })
    await expect(page.getByRole('status', { name: '正在加载表格数据' }))
      .toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.vxe-body--row').first()).toBeVisible({ timeout: 15_000 })

    const healthySnapshot = await readBrowserSnapshot(page)
    await writeBrowserSnapshot(page, await snapshotWithoutProjects(healthySnapshot))
    await page.reload({ waitUntil: 'commit' })

    const error = page.getByRole('alert', { name: '项目列表加载失败' })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(error).toContainText('项目加载失败')

    await writeBrowserSnapshot(page, healthySnapshot)
    await error.getByRole('button', { name: '重新加载' }).click()
    await expect(error).toBeHidden()
    await expect(page.locator('.vxe-body--row').first()).toBeVisible({ timeout: 15_000 })
  })

  test('清除业务筛选时同步清除表头筛选状态', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/project')
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()

    const statusHeader = page.locator('.vxe-header--column')
      .filter({ hasText: '业务流程阶段' })
      .first()
    const filterButton = statusHeader.locator('.vxe-filter--btn')
    await filterButton.click()

    const filterPanel = page.locator('.vxe-table--filter-wrapper:visible')
    await expect(filterPanel).toBeVisible()
    const constructionOption = filterPanel.locator('.vxe-table--filter-option')
      .filter({ hasText: '施工中' })
    await constructionOption.click()
    await expect(constructionOption).toHaveClass(/is--checked/)
    await filterPanel.getByText('筛选', { exact: true }).click()

    await page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })
      .fill('__no_matching_project__')
    const empty = page.getByRole('status', { name: '没有符合条件的项目' })
    await empty.getByRole('button', { name: '清除筛选' }).click()

    await expect(page.locator('.vxe-body--row').first()).toBeVisible()
    await filterButton.click()
    const clearedOption = page.locator('.vxe-table--filter-wrapper:visible')
      .locator('.vxe-table--filter-option')
      .filter({ hasText: '施工中' })
    await expect(clearedOption).not.toHaveClass(/is--checked/)
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`列表筛选空态可通过键盘清除并恢复 @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/project')
      await page.waitForLoadState('networkidle')

      const search = page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })
      await expect(search).toBeVisible({ timeout: 15_000 })
      await search.fill('__no_matching_project__')

      const empty = page.getByRole('status', { name: '没有符合条件的项目' })
      await expect(empty).toBeVisible()
      await expect(empty).toContainText('可清除搜索、状态和表头筛选后查看全部项目。')

      const clear = empty.getByRole('button', { name: '清除筛选' })
      await expectInViewport(clear, `项目列表空态主操作 @ ${width}px`)
      await clear.focus()
      await expect(clear).toBeFocused()
      await page.keyboard.press('Enter')

      await expect(search).toHaveValue('')
      await expect(page.locator('.vxe-body--row').first()).toBeVisible()
      await expectNoPageOverflow(page, `项目列表恢复态 @ ${width}px`)
    })

    test(`详情缺失态可通过键盘返回列表 @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/project/__missing_project__')
      await page.waitForLoadState('networkidle')

      const empty = page.getByRole('status', { name: '项目不存在或已被删除' })
      await expect(empty).toBeVisible()
      await expect(empty).toContainText('该项目可能已在别处被删除，可返回列表查看。')

      const back = empty.getByRole('link', { name: '返回项目列表' })
      await expectInViewport(back, `项目详情缺失态返回入口 @ ${width}px`)
      await back.focus()
      await expect(back).toBeFocused()
      await page.keyboard.press('Enter')

      await expect(page).toHaveURL(/\/project$/)
      await expect(page.getByRole('heading', { name: '施工项目' })).toBeVisible()
      await expectNoPageOverflow(page, `项目详情缺失态 @ ${width}px`)
    })
  }
})
