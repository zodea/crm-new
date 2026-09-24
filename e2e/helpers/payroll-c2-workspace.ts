import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'

export function payrollC2Repository(page: Page) {
  return createPayrollRepository(async (path, options) => {
    const response = await page.request.fetch(path, { method: options?.method || 'GET', params: options?.query ? Object.fromEntries(Object.entries(options.query).map(([key, value]) => [key, String(value)])) : undefined, data: options?.body })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  })
}
/** 沿主旅程真实迁入项目继续验证，不重置工资或另迁第二批。 */
export async function payrollC2Workspace(page: Page, month: string) {
  const repository = payrollC2Repository(page)
  const empty = await repository.dayworkList({ origin: 'real' }, { projectId: '', month, crewId: null, dayworkStatuses: [] })
  const matches = empty.options.projects.filter(project => project.name.startsWith('C2 无工程量验收 '))
  expect(matches).toHaveLength(1)
  const project = matches[0]!
  const ledger = await repository.dayworkList({ origin: 'real' }, { projectId: project.id, month, crewId: null, dayworkStatuses: [] })
  const leader = ledger.options.workers.find(worker => worker.name === '签工负责人')!
  expect(leader?.eligible).toBe(true)
  return { repository, project, leader, ledger }
}
