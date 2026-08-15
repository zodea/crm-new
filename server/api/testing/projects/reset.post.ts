import type { ProjectReadTestScenario } from '../../../utils/project-read-test-instance'
import process from 'node:process'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { projectReadTestInstance } from '../../../utils/project-read-test-instance'

type ProjectReadResetScenario = ProjectReadTestScenario | 'demo-forbidden'

const SCENARIOS = new Set<ProjectReadResetScenario>([
  'ready',
  'empty',
  'forbidden',
  'demo-forbidden',
  'unavailable',
])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: ProjectReadResetScenario }>(event)
  if (!body?.scenario || !SCENARIOS.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown project test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (body.scenario === 'demo-forbidden') {
    projectReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    projectReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
