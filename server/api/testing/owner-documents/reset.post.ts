import type { OwnerCommercialDocumentReadTestScenario } from '../../../utils/owner-commercial-document-read-test-instance'
import process from 'node:process'
import { prepareConstructionContractChainIdentityFixtures } from '../../../utils/construction-contract-chain-test-fixture'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from '../../../utils/owner-commercial-document-fixtures'
import { ownerCommercialDocumentReadTestInstance } from '../../../utils/owner-commercial-document-read-test-instance'

type Scenario = OwnerCommercialDocumentReadTestScenario | 'demo-forbidden'
const scenarios = new Set<Scenario>(['ready', 'empty', 'forbidden', 'unavailable', 'demo-forbidden'])

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: Scenario }>(event)
  if (!body?.scenario || !scenarios.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown owner document test scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (body.scenario === 'ready')
    prepareConstructionContractChainIdentityFixtures(sessionId)
  ownerCommercialDocumentCommandTestInstance.reset(sessionId)
  if (body.scenario === 'ready')
    ownerCommercialDocumentCommandTestInstance.importExisting(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS, sessionId)
  if (body.scenario === 'demo-forbidden') {
    ownerCommercialDocumentReadTestInstance.reset('ready', sessionId)
    demoWorkspaceTestInstance.reset('forbidden', sessionId)
  }
  else {
    ownerCommercialDocumentReadTestInstance.reset(body.scenario, sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  return { scenario: body.scenario }
})
