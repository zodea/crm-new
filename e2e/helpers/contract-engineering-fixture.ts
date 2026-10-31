import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** 界面测试专用合成候选；不代表正式来源可读取或关系已持久化。 */
export async function installContractEngineeringFixture(page: Page, kind: 'material' | 'subcontract', projectName: string) {
  await page.route(`**/api/read/${kind}-contracts/form-context`, async (route) => {
    const response = await route.fetch()
    expect(response.ok(), await response.text()).toBe(true)
    const context = await response.json()
    const project = context.projects.find((row: { label: string }) => row.label === projectName)
    expect(project, '合成候选必须对应本测试的项目身份').toBeDefined()
    await route.fulfill({ response, json: { ...context, constructionMains: [{ id: 'synthetic-ui-construction-main', projectId: project.id, basis: '0'.repeat(64), projectName: project.label, no: 'SYNTHETIC-UI', name: '测试施工主合同' }] } })
  })
}

export async function selectContractEngineeringFixture(page: Page) {
  await page.getByRole('combobox', { name: '搜索工程及施工主合同' }).fill('测试施工主合同')
  await page.getByRole('option', { name: /测试施工主合同/ }).click()
}
