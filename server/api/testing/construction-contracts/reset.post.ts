import type { ConstructionContractReadTestScenario } from '../../../utils/construction-contract-read-test-instance'
import process from 'node:process'
import { prepareConstructionContractChainIdentityFixtures } from '../../../utils/construction-contract-chain-test-fixture'
import {
  CONSTRUCTION_CONTRACT_EXISTING_RECORD,
  constructionContractCommandTestInstance,
} from '../../../utils/construction-contract-command-test-instance'
import { constructionContractReadTestInstance } from '../../../utils/construction-contract-read-test-instance'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'

type Scenario = ConstructionContractReadTestScenario | 'demo-forbidden'
const scenarios = new Set<Scenario>(['ready', 'empty', 'forbidden', 'unavailable', 'demo-forbidden'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: Scenario }>(event)
  if (!body?.scenario || !scenarios.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown construction contract test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (body.scenario === 'ready')
    prepareConstructionContractChainIdentityFixtures(sessionId)
  constructionContractCommandTestInstance.reset(sessionId)
  if (body.scenario === 'ready')
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], sessionId)
  if (body.scenario === 'demo-forbidden') {
    constructionContractReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    constructionContractReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
