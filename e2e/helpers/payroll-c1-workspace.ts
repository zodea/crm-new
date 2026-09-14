import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'

export function payrollC1Repository(page: Page) {
  return createPayrollRepository(async (path, options) => {
    const response = await page.request.fetch(path, { method: options?.method || 'GET', params: options?.query ? Object.fromEntries(Object.entries(options.query).map(([key, value]) => [key, String(value)])) : undefined, data: options?.body })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  })
}

/** 沿主旅程已公开确认的真实迁入项目继续验收，不新建第二批或重置原发放。 */
export async function payrollC1Workspace(page: Page, month: string) {
  const repository = payrollC1Repository(page)
  const options = await repository.attendanceMatrix({ origin: 'real' }, { projectId: '', month, crewId: null })
  const matches = options.options.projects.filter(project => project.name.startsWith('C1 无工程量验收 '))
  expect(matches, '需要主旅程唯一真实迁入项目').toHaveLength(1)
  const project = matches[0]!
  const matrix = await repository.attendanceMatrix({ origin: 'real' }, { projectId: project.id, month, crewId: null })
  const leader = matrix.workers.find(worker => worker.name === '日薪481负责人')!
  expect(leader?.eligible).toBe(true)
  return { repository, project, leader, matrix }
}
