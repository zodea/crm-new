import type { SupplierReadTestScenario } from '../../../utils/supplier-read-test-instance'
import process from 'node:process'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { projectSupplierCommandTestInstance } from '../../../utils/project-supplier-command-test-instance'
import { supplierCommandTestInstance } from '../../../utils/supplier-command-test-instance'
import { supplierReadTestInstance } from '../../../utils/supplier-read-test-instance'

type Scenario = SupplierReadTestScenario | 'demo-forbidden'
const scenarios = new Set<Scenario>(['ready', 'empty', 'forbidden', 'unavailable', 'demo-forbidden'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: Scenario, sensitiveRead?: boolean }>(event)
  if (!body?.scenario || !scenarios.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown supplier test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (body.sensitiveRead !== undefined && typeof body.sensitiveRead !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: 'Invalid sensitive read state' })
  if (body.sensitiveRead && (!sessionId || sessionId === 'default'))
    throw createError({ statusCode: 403, statusMessage: 'Named test session required' })
  if (sessionId)
    demoWorkspaceTestInstance.setSupplierPrivateRead(sessionId, body.sensitiveRead === true)
  supplierCommandTestInstance.reset(sessionId)
  projectSupplierCommandTestInstance.reset(sessionId)
  if (body.scenario === 'demo-forbidden') {
    supplierReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    supplierReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
