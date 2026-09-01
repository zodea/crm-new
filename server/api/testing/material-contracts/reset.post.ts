import type { MaterialContractReadTestScenario } from '../../../utils/material-contract-read-test-instance'
import process from 'node:process'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { prepareMaterialContractChainIdentityFixtures } from '../../../utils/material-contract-chain-test-fixture'
import {
  MATERIAL_CONTRACT_EXISTING_RECORD,
  materialContractCommandTestInstance,
} from '../../../utils/material-contract-command-test-instance'
import { materialContractReadTestInstance } from '../../../utils/material-contract-read-test-instance'

type Scenario = MaterialContractReadTestScenario | 'demo-forbidden'
const scenarios = new Set<Scenario>(['ready', 'empty', 'forbidden', 'unavailable', 'demo-forbidden'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: Scenario }>(event)
  if (!body?.scenario || !scenarios.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown material contract test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  materialContractCommandTestInstance.reset(sessionId)
  if (body.scenario === 'ready') {
    prepareMaterialContractChainIdentityFixtures(sessionId)
    materialContractCommandTestInstance.importExisting([MATERIAL_CONTRACT_EXISTING_RECORD], sessionId)
  }
  if (body.scenario === 'demo-forbidden') {
    materialContractReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    materialContractReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
