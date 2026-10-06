import type { TransactionDb } from '../db/coordinator'
import { hasConsistentReadMeta } from '../read-model/meta'
import { isObject, quotationProblem } from './contract'
import { exportQuotationGraph, quotationGraphHash } from './graph'
import { validateMaterialQuotationSchema } from './schema-upgrade'

export async function assertQuotationCoreMigrationGate(schemaVersion: number, select: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>, verify: (hash: string) => Promise<boolean> = verifyQuotationImport) {
  if (schemaVersion < 58)
    return
  const tx: TransactionDb = { select: <T>(sql: string, params?: unknown[]) => select<Record<string, unknown>>(sql, params) as Promise<T[]>, execute: async () => {
    throw new Error('报价源图核验只读')
  } }
  await validateMaterialQuotationSchema(tx)
  const graph = await exportQuotationGraph(tx, 'native')
  const nonempty = Object.values(graph.tables).some(rows => rows.length > 0) || graph.originals.length > 0 || graph.revision !== 0
  if (!nonempty)
    return
  const hash = await quotationGraphHash(graph)
  if (!await verify(hash))
    return quotationProblem('conflict', '本地独立报价图尚未完整迁入并核验；请先迁入报价原件、冻结历史和原命令，再切换平台。原库与备份保持可恢复')
}
async function verifyQuotationImport(hash: string) {
  const response: unknown = await $fetch('/api/read/material-quotations/imports', { retry: 0 })
  if (!isObject(response) || !hasConsistentReadMeta(response, 'material-quotation-import-read-v1', 'real') || !Array.isArray(response.records))
    return quotationProblem('unavailable', '报价迁入核验缺少当前可信读取证明')
  return response.records.some(record => isObject(record) && record.graphHash === hash)
}
