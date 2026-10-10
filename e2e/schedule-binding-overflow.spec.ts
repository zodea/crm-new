import type { BoqBuildingContext } from '../app/lib/boq/central-building-contract'
import type { ScheduleBindingRead } from '../app/lib/schedule/central-binding-contract'
import { expect, test } from '@playwright/test'

/** 明确的组件读取夹具：用于实际VXE单元格布局，不代表四条来源已通过迁入。 */
test('组件读取夹具：四条稳定清单来源与完整长说明可键盘滚动并进入第四行', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const total = { value: 12, knownValue: 12, missingCount: 0, sourceCount: 4, unitMissing: false, completeness: 'complete' as const }
  const preview = { projectId: 'overflow-project', groupId: 'overflow-group', groupName: '多来源交互验收组', contractId: 'overflow-contract', contractName: '多来源施工合同', contractNo: 'OVERFLOW-1', buildings: [{ id: 'building', code: 'B1', name: '一栋', covered: true, contractLineCount: 4 }], extraContractBuildings: [], blockers: [], warnings: [], canBind: true, items: [{ id: 'item', code: 'I', name: '同一分项', unit: '㎡', mapped: true, provisional: total, contract: total, differenceQty: 0, reasons: ['逐户核对原件并保留每份数量来源。'.repeat(15), '最后一条原件核对说明'], floorPlanIds: ['floor'], contractLineIds: ['line1', 'line2', 'line3', 'line4'] }] }
  const read: ScheduleBindingRead = { workspaceId: 'workspace-default', actorId: 'actor-default', origin: 'real', sourceVersion: 'overflow-binding-1', capabilities: ['schedule:read', 'schedule:write'], group: { id: preview.groupId, projectId: preview.projectId, name: preview.groupName, scopeBasis: 'contract', contractId: preview.contractId }, contracts: [{ id: preview.contractId, projectId: preview.projectId, no: preview.contractNo, name: preview.contractName, lineCount: 4 }], state: 'bound', preview: null, binding: { contractId: preview.contractId, contractNo: preview.contractNo, contractName: preview.contractName, boundAt: '2026-09-12T12:00:00Z', actorId: 'actor-default', sourceVersion: 'overflow-binding-1', preview, legacyDetailMissing: false } }
  const boq: BoqBuildingContext = { workspaceId: read.workspaceId, actorId: read.actorId, origin: 'real', projectId: preview.projectId, contractId: preview.contractId, contractName: preview.contractName, sourceVersion: 'overflow-boq-1', capabilities: ['owner-document:read'], buildings: [{ id: 'building', code: 'B1', name: '一栋' }], audit: [], lines: preview.items[0]!.contractLineIds.map((id, index) => ({ id, itemName: `多来源清单${index + 1}`, unit: '㎡', qty: 3, unitPrice: 2, effectiveQty: 3, effectiveUnitPrice: 2, building: 'B1', sourceKind: 'confirmed-import', readOnlyReason: null })) }
  await page.route('**/api/read/schedule/binding**', route => route.fulfill({ json: read }))
  await page.route('**/api/read/boq/building-context**', route => route.fulfill({ json: boq }))
  await page.goto(`/schedule/${preview.projectId}/bind/${preview.groupId}?origin=real`)
  const sources = page.getByRole('region', { name: '同一分项 ㎡ 共4条清单来源' })
  const reasons = page.getByRole('region', { name: '同一分项 ㎡ 完整来源说明' })
  const fourth = page.getByRole('button', { name: '查看清单来源 4', exact: true })
  await expect(sources).toHaveAttribute('tabindex', '0', { timeout: 30_000 })
  await sources.focus()
  for (let index = 0; index < 4; index++)
    await page.keyboard.press('Tab')
  await expect(fourth).toBeFocused()
  await expect.poll(() => sources.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  await reasons.focus()
  await page.keyboard.press('End')
  await expect.poll(() => reasons.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  await expect(reasons).toContainText('最后一条原件核对说明')
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 720 })
    const table = page.getByRole('region', { name: '分项与数量差异', exact: true })
    await table.evaluate(node => node.scrollIntoView({ block: 'center' }))
    await table.locator('.vxe-table--body-inner-wrapper').evaluate((node) => {
      node.scrollLeft = node.scrollWidth
    })
    await fourth.focus()
    await reasons.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(fourth).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  await fourth.click()
  await expect(page).toHaveURL(url => url.pathname === '/contract/boq/building-evidence' && url.searchParams.get('line') === 'line4' && url.searchParams.get('project') === preview.projectId && url.searchParams.get('contract') === preview.contractId)
  await expect(page.getByRole('combobox', { name: '合同清单行', exact: true })).toContainText('多来源清单4')
  await expect(page.getByRole('heading', { name: '合同清单来源', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
