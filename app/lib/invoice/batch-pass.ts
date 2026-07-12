// 批量通过放行闭环(issue #63)——纯逻辑,vitest 直接断言,store/页面复用。
// 蓝本口径(finance-invoice.md 反馈轮 7):全绿只标「建议通过」不自动归档,人工点「批量通过」放行;
// 黄/红字段经确认/修正变绿后同样进入范围;归属两类出口 = 项目(须命中项目主数据规范名) 或 个人开支,
// 缺归属的票排除并列出清单。置信度仅作参考,判决权在人。
import { confidenceTier } from '~/lib/invoice/recognize'

/** 全绿判定:有置信度数据且所有字段都落 ok 档(人工确认/修正置满的 1 同样满足);无数据不算全绿。 */
export function isAllGreen(fieldConfidence: Record<string, number>): boolean {
  const values = Object.values(fieldConfidence)
  if (!values.length)
    return false
  return values.every(v => confidenceTier(v) === 'ok')
}

export interface AttributionProject {
  id: string
  name: string
}

export interface AttributionInput {
  ownerKind: 'project' | 'personal' | null
  projectName: string
}

export type ResolvedAttribution
  = | { ownerKind: 'project', projectId: string, projectName: string }
    | { ownerKind: 'personal' }

/**
 * 归属解析:个人开支直通;否则对应项目必须命中项目主数据(写入规范名,避免 project_id 与
 * project_name 各指不同项目);解析不出 → null,即「字段标红 + 归档按钮禁用」的判定依据。
 */
export function resolveAttribution(
  inv: AttributionInput,
  findProject: (name: string) => AttributionProject | undefined,
): ResolvedAttribution | null {
  if (inv.ownerKind === 'personal')
    return { ownerKind: 'personal' }
  if (inv.projectName) {
    const p = findProject(inv.projectName)
    if (p)
      return { ownerKind: 'project', projectId: p.id, projectName: p.name }
  }
  return null
}

export interface BatchPassCandidate extends AttributionInput {
  id: string
  source: string
  ocrStatus: string
  reviewStatus: string
  accountStatus: string
  dupStatus: string
  fieldConfidence: Record<string, number>
}

/**
 * 放行范围:工作台内(未归档)识别完成、非重复的扫描件中——
 * 全绿的(建议通过,黄/红经人工确认/修正变绿后进入)或已校对的(人工整票确认过,比全绿更强,只差归档)。
 */
export function selectBatchCandidates<T extends BatchPassCandidate>(list: T[]): T[] {
  return list.filter(inv =>
    inv.source === 'scan'
    && inv.accountStatus === 'none'
    && inv.ocrStatus === 'done'
    && inv.dupStatus === 'normal'
    && (inv.reviewStatus === 'reviewed' || isAllGreen(inv.fieldConfidence)),
  )
}

export interface BatchPassPartition<T> {
  pass: { inv: T, attribution: ResolvedAttribution }[]
  excluded: { inv: T, reason: string }[]
}

/** 批量通过分拣:有归属的放行,缺归属的排除并给出可读原因(排除清单)。 */
export function partitionBatchPass<T extends BatchPassCandidate>(
  candidates: T[],
  findProject: (name: string) => AttributionProject | undefined,
): BatchPassPartition<T> {
  const pass: BatchPassPartition<T>['pass'] = []
  const excluded: BatchPassPartition<T>['excluded'] = []
  for (const inv of candidates) {
    const attribution = resolveAttribution(inv, findProject)
    if (attribution) {
      pass.push({ inv, attribution })
    }
    else {
      excluded.push({
        inv,
        reason: inv.projectName
          ? `对应项目「${inv.projectName}」未命中项目主数据`
          : '缺归属（未填对应项目，也未选个人开支）',
      })
    }
  }
  return { pass, excluded }
}
