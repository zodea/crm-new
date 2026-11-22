import type { BusinessSession } from '../../server/utils/business-session'
import process from 'node:process'
import { createProductionInvoiceCorrectionService } from '../../server/utils/production-invoice-correction-service'
import { createProductionInvoiceService } from '../../server/utils/production-invoice-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const [directory, correctionId, actorJson] = process.argv.slice(2)
  if (!directory || !correctionId || !actorJson)
    throw new Error('冷恢复目录、更正单或身份缺失')
  const actor = JSON.parse(actorJson) as BusinessSession
  const storage = createProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  try {
    const invoices = createProductionInvoiceService(storage)
    const service = createProductionInvoiceCorrectionService(storage, { invoice: invoices.correctionPort })
    const correction = await service.get(correctionId, () => actor)
    const invoice = await invoices.get(correction.invoiceId, () => actor)
    process.stdout.write(JSON.stringify({ correction, invoice }))
  }
  finally { await storage.close() }
}

void main().catch((error) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})
