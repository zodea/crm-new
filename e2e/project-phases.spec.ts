import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

// 六阶段与本地编辑正向覆盖保留在 tests/project/phases.test.ts、
// tests/stores/phase-task.test.ts 和 tests/components/ProjectTimeline.test.ts。
// 当前中央详情读取业务阶段，不提供尚未接管的本地阶段任务编辑。
for (const input of PROJECT_INPUTS) {
  test(`${input.label}：中央业务阶段与整页编辑目标保持同一正式身份`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page, input)
    await fixture.open()

    const readonly = page.getByRole('status', { name: '中央项目只读详情', exact: true })
    await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.status)
    await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.code)
    await expect(page.getByRole('link', { name: '编辑项目', exact: true }))
      .toHaveAttribute('href', `/project/form/${fixture.id}?origin=real`)
    await expect(page.getByRole('button', { name: '编辑阶段', exact: true })).toHaveCount(0)
    await expect(page.getByRole('list', { name: '项目六阶段流程' })).toHaveCount(0)
    await expect(readonly.getByRole('textbox')).toHaveCount(0)
    expect(fixture.errors).toEqual([])
  })
}
