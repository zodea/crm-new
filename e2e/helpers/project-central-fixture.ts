import type { Page } from '@playwright/test'
import type { ProjectDetailReadDTO } from '../../app/lib/project/repository'
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'

export const PROJECT_INPUTS = [
  { label: '筹备工程', name: '中央验收筹备工程', code: 'P-READY-E2E', manager: '合成经办人甲', status: '筹备中', address: '合成工程地址甲' },
  { label: '施工工程', name: '中央验收施工工程', code: 'P-ACTIVE-E2E', manager: '合成经办人乙', status: '施工中', address: '合成工程地址乙' },
] as const

export interface ProjectCentralInput {
  label: string
  name: string
  code: string
  manager: string
  status: string
  address: string
}

/** 每例以独立中央会话创建自己的项目；不借用默认 demo 或本地 SQL 事实。 */
export async function installProjectCentralFixture(page: Page, input: ProjectCentralInput = PROJECT_INPUTS[0], options: { sessionId?: string } = {}) {
  const headers = { 'x-ruihang-test-session': options.sessionId ?? `project-detail-${randomUUID()}` }
  await page.context().setExtraHTTPHeaders(headers)
  await page.setExtraHTTPHeaders(headers)
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
  // 固定起点并自然推进，保留 Vue 冒泡事件时间戳及异步计时的先后关系。
  await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  const sessionResponse = await page.request.get('/api/read/business-session')
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const session = await sessionResponse.json()
  const created = await page.request.post('/api/commands/projects', {
    data: {
      ...session,
      requiredCapability: 'project:write',
      commandId: randomUUID(),
      baseVersion: null,
      action: 'draft',
      draft: { name: input.name, code: input.code, manager: input.manager, status: input.status, address: input.address },
      attachments: {},
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const { id }: { id: string } = await created.json()
  expect(id).toBeTruthy()
  const url = `/project/${encodeURIComponent(id)}?origin=real`
  const read = async (): Promise<ProjectDetailReadDTO> => {
    const response = await page.request.get(`/api/read/projects/${encodeURIComponent(id)}`, { params: { origin: 'real', includeDemo: false } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const open = async () => {
    await page.goto(url)
    // 首次访问项目详情需等待开发服务编译，避免把空白编译期误判为读取失败。
    await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('status', { name: '中央项目只读详情', exact: true })).toBeVisible()
  }
  return { id, input, url, read, open, errors }
}
