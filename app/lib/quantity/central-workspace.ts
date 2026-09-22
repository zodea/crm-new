import type { SoftDb } from '../db/soft-delete'
import { loadQuantityConstructionRecords, loadQuantityMonthlyOutput, loadQuantityStageProgress } from './derived'
import { loadQuantityProjectSnapshot } from './read-model'

/** 矩阵、详情与导出在同一读取事务内取得一份当前工程量事实。 */
export async function loadQuantityCentralWorkspace(db: SoftDb, projectId: string) {
  const snapshot = await loadQuantityProjectSnapshot(db, projectId)
  const stageProgress = await loadQuantityStageProgress(db, projectId)
  const records = await loadQuantityConstructionRecords(db, projectId)
  const monthly = await loadQuantityMonthlyOutput(db, projectId)
  return { projectId, snapshot, stageProgress, records, monthly }
}

export type QuantityCentralWorkspace = Awaited<ReturnType<typeof loadQuantityCentralWorkspace>>
