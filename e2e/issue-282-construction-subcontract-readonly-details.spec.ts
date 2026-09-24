import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetContracts(request: APIRequestContext, id: string) {
  for (const domain of ['construction', 'subcontract'] as const) {
    const response = await request.post(`/api/testing/${domain}-contracts/reset`, {
      headers: {
        'x-ruihang-test-reset': '1',
        'x-ruihang-test-session': id,
      },
      data: { scenario: 'ready' },
    })
    expect(response.ok()).toBe(true)
  }
}

test.describe('Issue #282：施工与分包合同专属只读详情', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await resetContracts(page.context().request, id)
  })

  test('两类合同列表只用稳定 ID 提供项目与交易对方入口', async ({ page }) => {
    await page.goto('/contract/construction?search=合和新城')
    const constructionList = page.getByTestId('construction-contract-list')
    await expect(constructionList).toBeVisible({ timeout: 20_000 })
    await expect(constructionList.getByRole('link', { name: '合和新城', exact: true })).toHaveAttribute(
      'href',
      '/project/proj_demo_001?origin=demo',
    )
    await expect(constructionList.getByRole('link', { name: '合和地产集团', exact: true })).toHaveAttribute(
      'href',
      '/base/customer/customer_demo_001?origin=demo',
    )

    await page.goto('/contract/subcontract?search=泥水班组')
    const subcontractList = page.getByTestId('subcontract-contract-list')
    await expect(subcontractList).toBeVisible({ timeout: 20_000 })
    await expect(subcontractList.getByRole('link', { name: '合和新城', exact: true })).toHaveAttribute(
      'href',
      '/project/proj_demo_001?origin=demo',
    )
    await expect(subcontractList.getByRole('link', { name: '陈家泥水班组', exact: true })).toHaveAttribute(
      'href',
      '/base/supplier/sup_demo_006?origin=demo',
    )
  })
})
