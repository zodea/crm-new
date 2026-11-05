import type { BusinessSession } from '../../server/utils/business-session'
import process from 'node:process'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const [directory, actorJson] = process.argv.slice(2)
  if (!directory || !actorJson)
    throw new Error('冷恢复目录或身份缺失')
  const actor = JSON.parse(actorJson) as BusinessSession
  const storage = createProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  try {
    await validateFinanceJournal(storage, actor)
    const proof = await storage.select('SELECT * FROM finance_payment_verifications ORDER BY id')
    process.stdout.write(JSON.stringify(proof))
  }
  finally { await storage.close() }
}

void main().catch((error) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})
