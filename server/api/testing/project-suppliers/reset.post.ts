import type { ProjectSupplierReadTestScenario } from '../../../utils/project-supplier-read-test-instance'
import process from 'node:process'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { projectSupplierCommandTestInstance } from '../../../utils/project-supplier-command-test-instance'
import { projectSupplierReadTestInstance } from '../../../utils/project-supplier-read-test-instance'

type Scenario = ProjectSupplierReadTestScenario | 'demo-forbidden'
const SCENARIOS = new Set<Scenario>(['ready', 'formal-ready', 'zero', 'empty', 'forbidden', 'unavailable', 'demo-forbidden'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: Scenario }>(event)
  if (!body?.scenario || !SCENARIOS.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown project-supplier test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  projectSupplierCommandTestInstance.reset(sessionId)
  if (body.scenario === 'demo-forbidden') {
    projectSupplierReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    projectSupplierReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
