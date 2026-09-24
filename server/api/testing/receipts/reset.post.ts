import type { ReceiptReadTestScenario } from '../../../utils/receipt-read-test-instance'
import process from 'node:process'
import { prepareConstructionContractChainIdentityFixtures } from '../../../utils/construction-contract-chain-test-fixture'
import { CONSTRUCTION_CONTRACT_EXISTING_RECORD, constructionContractCommandTestInstance } from '../../../utils/construction-contract-command-test-instance'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from '../../../utils/owner-commercial-document-fixtures'
import { receiptCommandTestInstance } from '../../../utils/receipt-command-service'
import { receiptReadTestInstance } from '../../../utils/receipt-read-test-instance'

const scenarios = new Set<ReceiptReadTestScenario>(['ready', 'forbidden', 'unavailable', 'customer-forbidden', 'project-contract-forbidden'])
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const body = await readBody<{ scenario?: ReceiptReadTestScenario, seed?: boolean }>(event)
  if (!body?.scenario || !scenarios.has(body.scenario))
    throw createError({ statusCode: 400, statusMessage: 'Unknown receipt scenario' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (body.seed) {
    prepareConstructionContractChainIdentityFixtures(sessionId)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], sessionId)
    ownerCommercialDocumentCommandTestInstance.importExisting(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.filter(row => row.kind === 'final_settlement'), sessionId)
    receiptCommandTestInstance.reset(sessionId)
    demoWorkspaceTestInstance.reset('allowed', sessionId)
  }
  receiptReadTestInstance.reset(body.scenario, sessionId)
  return { scenario: body.scenario }
})
