import type { CustomerReadTestScenario } from '../../../utils/customer-read-test-instance'
import process from 'node:process'
import { customerCommandTestInstance } from '../../../utils/customer-command-test-instance'
import { customerReadTestInstance } from '../../../utils/customer-read-test-instance'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'

type Scenario = CustomerReadTestScenario | 'demo-forbidden'
const scenarios = new Set<Scenario>(['ready', 'empty', 'forbidden', 'unavailable', 'demo-forbidden'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: Scenario }>(event)
  if (!body?.scenario || !scenarios.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown customer test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  customerCommandTestInstance.reset(sessionId)
  if (body.scenario === 'demo-forbidden') {
    customerReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    customerReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
