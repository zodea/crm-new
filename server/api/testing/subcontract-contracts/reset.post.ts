import type { SubcontractContractReadTestScenario } from '../../../utils/subcontract-contract-read-test-instance'
import process from 'node:process'
import { prepareConstructionContractChainIdentityFixtures } from '../../../utils/construction-contract-chain-test-fixture'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { subcontractContractCommandTestInstance } from '../../../utils/subcontract-contract-command-test-instance'
import { subcontractContractReadTestInstance } from '../../../utils/subcontract-contract-read-test-instance'

type Scenario = SubcontractContractReadTestScenario | 'demo-forbidden'
const scenarios = new Set<Scenario>(['ready', 'empty', 'forbidden', 'unavailable', 'demo-forbidden'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: Scenario }>(event)
  if (!body?.scenario || !scenarios.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown subcontract contract test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (body.scenario === 'ready')
    prepareConstructionContractChainIdentityFixtures(sessionId)
  subcontractContractCommandTestInstance.reset()
  if (body.scenario === 'demo-forbidden') {
    subcontractContractReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    subcontractContractReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
