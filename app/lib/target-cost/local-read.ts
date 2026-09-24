import type { TargetCostContext, TargetCostDetailRead, TargetCostFormRead, TargetCostMetric } from './central-contract'
import { getDb } from '../db/connection'
import { listFormAttachments, loadTargetCostForm } from '../master-data/forms'
import { targetCostProblem } from './central-contract'
import { loadTargetCostDetail } from './detail'

/** 仅桌面旧库及显式授权演示库消费；正式浏览器不得使用此读取器。 */
export async function localTargetCostForm(context: TargetCostContext, id: string | null, draftKey?: string): Promise<TargetCostFormRead> {
  const draft = id ? await loadTargetCostForm(id) : {}
  if (!draft)
    throw targetCostProblem('not-found', '预算版本不存在')
  const files = id ? await listFormAttachments('target_cost', id) : []
  return { context, targetCostId: id, draftKey: id ? null : draftKey ?? null, draft, deletedAt: null, files: files.map(({ filePath: _path, ...file }) => ({ ...file, ownerType: 'target_cost', payloadState: 'missing' })), projects: [], projectOptionsStatus: 'available' }
}
export async function localTargetCostDetail(context: TargetCostContext, id: string): Promise<TargetCostDetailRead> {
  const detail = await loadTargetCostDetail(await getDb(), id)
  if (!detail)
    throw targetCostProblem('not-found', '预算版本不存在')
  const metric = (value: number): TargetCostMetric => ({ value, knownValue: value, status: 'complete', missingSources: [] })
  return { context, targetCostId: id, deletedAt: null, files: (await localTargetCostForm(context, id)).files, history: [], actualSourceVersion: context.sourceVersion, view: { ...detail, categories: detail.categories.map(row => ({ ...row, signedAmount: metric(row.signedAmount), settledAmount: metric(row.settledAmount), paidAmount: metric(row.paidAmount), remainingAmount: metric(row.remainingAmount), sources: { contract: null, settlement: null, payment: null, reimbursement: null } })), summary: { ...detail.summary, signedAmount: metric(detail.summary.signedAmount), settledAmount: metric(detail.summary.settledAmount), paidAmount: metric(detail.summary.paidAmount), remainingAmount: metric(detail.summary.remainingAmount) } } }
}
