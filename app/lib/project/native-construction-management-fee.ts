import type { TransactionDb } from '../db/coordinator'
import { readNativeConstructionManagementFee } from '../construction-contract/management-fee-storage'
import { selectVisibleSql } from '../db/soft-delete'
import { projectConstructionManagementFees } from './construction-management-fee'

/** 由 Native 自己的只读事务调用；授权与证明由同一 Native owner 提供，不借 HTTP 身份。 */
export async function readNativeProjectConstructionManagementFees(db: TransactionDb, projectId: string, asOf: string) {
  const rows = await db.select<{ id: string, no: string, name: string, project_id: string, status: string, updated_at: string }>(selectVisibleSql('contracts', 'AND project_id=? AND kind=? ORDER BY id'), [projectId, '施工'])
  const contracts = []
  for (const row of rows) {
    contracts.push({ id: row.id, no: row.no, name: row.name, projectId: row.project_id, kind: '施工', projectPermission: 'allowed' as const, dataOrigin: 'real' as const, status: row.status, updatedAt: row.updated_at, managementFee: await readNativeConstructionManagementFee(db, row.id) })
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(contracts)))
  const sourceVersion = `native-construction-configurations-${Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')}`
  return projectConstructionManagementFees({ projectId, dataOrigin: 'real', sourceVersion, asOf, contracts })
}
