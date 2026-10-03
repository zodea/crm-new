import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

// 生命周期查询和合法转换正向保留在 tests/project/acceptance-lifecycle.test.ts、
// tests/owner-document/lifecycle.test.ts；专属正式详情见 issue-324-acceptance-warranty-canonical.spec.ts。
for (const input of PROJECT_INPUTS) {
  for (const journey of [
    { label: '竣工验收', variant: 'acceptance' },
    { label: '保修管理', variant: 'warranty' },
  ]) {
    test(`${input.label} ${journey.label}中央入口保留 variant 与返回身份`, async ({ page }) => {
      const fixture = await installProjectCentralFixture(page, input)
      await fixture.open()
      const link = page.getByRole('region', { name: /^项目商务单据/ }).getByRole('link', { name: new RegExp(`^${journey.label}\\s`) })
      await expect(link).toBeVisible()
      const target = new URL((await link.getAttribute('href'))!, page.url())
      expect(target.pathname).toBe('/owner/acceptance')
      expect(Object.fromEntries(['origin', 'projectId', 'variant'].map(key => [key, target.searchParams.get(key)]))).toEqual({ origin: 'real', projectId: fixture.id, variant: journey.variant })
      const source = new URL(target.searchParams.get('returnTo')!, page.url())
      expect(source.pathname).toBe(`/project/${fixture.id}`)
      expect(source.searchParams.get('origin')).toBe('real')
      expect(source.hash).toBe(`#project-owner-document-card-${journey.variant}`)
      await expect(page.getByRole('tab', { name: '竣工验收及保修', exact: true })).toHaveCount(0)
      await link.click()
      await expect(page).toHaveURL(target.href)
      expect(fixture.errors).toEqual([])
    })
  }
}
