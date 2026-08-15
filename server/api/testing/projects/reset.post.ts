import type { ProjectReadTestScenario } from '../../../utils/project-read-test-instance'
import process from 'node:process'
import { projectReadTestInstance } from '../../../utils/project-read-test-instance'

const SCENARIOS = new Set<ProjectReadTestScenario>(['ready', 'empty', 'forbidden', 'unavailable'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: ProjectReadTestScenario }>(event)
  if (!body?.scenario || !SCENARIOS.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown project test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  projectReadTestInstance.reset(body.scenario, sessionId)
  return { scenario: projectReadTestInstance.currentScenario(sessionId) }
})
