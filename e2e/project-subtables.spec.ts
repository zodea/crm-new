import { expect, test } from '@playwright/test'
import { installProjectCentralFixture } from './helpers/project-central-fixture'

// 旧本地子表取数、归档范围与金额的正向覆盖保留在 tests/project/subtables.test.ts、
// tests/project/detail-aggregate.test.ts、tests/project/finance-facts.test.ts。
// 当前项目商务卡片进入各领域中央列表，不再要求本地十页签或固定演示金额。
const JOURNEYS = [
  { name: '甲方变洽签', path: '/owner/change', kind: 'change' },
  { name: '月度报量', path: '/owner/report', kind: 'report' },
  { name: '竣工验收', path: '/owner/acceptance', kind: 'acceptance', variant: 'acceptance' },
  { name: '保修管理', path: '/owner/acceptance', kind: 'warranty', variant: 'warranty' },
  { name: '最终结算', path: '/owner/final-settlement', kind: 'final-settlement' },
  { name: '甲方罚扣', path: '/owner/penalty', kind: 'penalty' },
  { name: '项目罚扣', path: '/project/penalty', kind: 'project-penalty' },
  { name: '分包结算', path: '/subcontract/settlement', kind: 'sub-settlement' },
  { name: '分包变洽签', path: '/subcontract/change', kind: 'sub-change' },
] as const

for (const journey of JOURNEYS) {
  test(`项目商务 ${journey.name}：中央目标保留项目、来源与返回锚点`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page)
    await fixture.open()
    const section = page.getByRole('region', { name: /^项目商务单据/ })
    const link = section.getByRole('link', { name: new RegExp(`^${journey.name}\\s`) })
    await expect(link).toBeVisible()
    const target = new URL((await link.getAttribute('href'))!, page.url())
    expect(target.pathname).toBe(journey.path)
    expect(target.searchParams.get('projectId')).toBe(fixture.id)
    expect(target.searchParams.get('origin')).toBe('real')
    expect(target.searchParams.get('variant')).toBe('variant' in journey ? journey.variant : null)
    const returnTo = new URL(target.searchParams.get('returnTo')!, page.url())
    expect(returnTo.pathname).toBe(`/project/${fixture.id}`)
    expect(returnTo.searchParams.get('origin')).toBe('real')
    expect(returnTo.searchParams.get('ownerJourney')).toBeTruthy()
    expect(returnTo.hash).toBe(`#project-owner-document-card-${journey.kind}`)

    await link.click()
    await expect(page).toHaveURL(target.href)
    expect(fixture.errors).toEqual([])
  })
}
