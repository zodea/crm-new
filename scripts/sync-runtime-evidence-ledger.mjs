import { readFile, writeFile } from 'node:fs/promises'
import {
  buildRuntimeEvidenceLedger,
  IMPLEMENTATION_STATUS_PATH,
  replaceImplementationFrontier,
  replaceRuntimeEvidenceSummary,
  RUNTIME_AUDIT_PATH,
  RUNTIME_EVIDENCE_LEDGER_PATH,
} from './runtime-evidence-ledger.mjs'

const ledger = buildRuntimeEvidenceLedger()
await writeFile(RUNTIME_EVIDENCE_LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

const audit = await readFile(RUNTIME_AUDIT_PATH, 'utf8')
await writeFile(RUNTIME_AUDIT_PATH, replaceRuntimeEvidenceSummary(audit, ledger), 'utf8')

const status = await readFile(IMPLEMENTATION_STATUS_PATH, 'utf8')
await writeFile(IMPLEMENTATION_STATUS_PATH, replaceImplementationFrontier(status, ledger), 'utf8')

console.log(
  `证据账本 ${ledger.counts.productionRoutes} 条生产路由 / ${ledger.counts.pageDomains} 个页面域 | `
  + `历史 ${ledger.counts.historicalEvidenceRoutes} · 未验证目标 ${ledger.counts.unverifiedTargetRoutes}`,
)
