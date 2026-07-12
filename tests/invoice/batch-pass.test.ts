// 批量通过放行闭环(issue #63)纯逻辑:全绿判定 / 归属解析 / 放行范围 / 分拣(缺归属排除并列清单)。
// 蓝本口径:全绿只标「建议通过」不自动归档;批量通过只放行有归属的票;
// 归属两类出口 = 项目(须命中项目主数据规范名) 或 个人开支。
import { describe, expect, it } from 'vitest'
import {
  isAllGreen,
  partitionBatchPass,
  resolveAttribution,
  selectBatchCandidates,
} from '~/lib/invoice/batch-pass'

const GREEN = { invoiceNumber: 0.99, seller: 1, totalAmount: 0.96 }
const HAS_WARN = { invoiceNumber: 0.99, seller: 0.9, totalAmount: 0.96 }

const PROJECTS = [
  { id: 'p1', name: '合和新城' },
  { id: 'p2', name: '锦绣华庭' },
]
const findProject = (name: string) => PROJECTS.find(p => p.name === name)

function inv(patch: Record<string, unknown> = {}) {
  return {
    id: 'inv1',
    invoiceNumber: '094400001',
    fileName: 'a.pdf',
    source: 'scan',
    ocrStatus: 'done',
    reviewStatus: 'unreviewed',
    accountStatus: 'none',
    dupStatus: 'normal',
    ownerKind: null as 'project' | 'personal' | null,
    projectName: '',
    fieldConfidence: GREEN as Record<string, number>,
    ...patch,
  }
}

describe('isAllGreen:全绿判定(建议通过标记与批量通过入围条件)', () => {
  it('全部 ok 档(≥0.95,含人工置满的 1)为真', () => {
    expect(isAllGreen(GREEN)).toBe(true)
  })

  it('存在黄/红字段为假;经人工确认置满后变真(确认/修正变绿即进入范围)', () => {
    expect(isAllGreen(HAS_WARN)).toBe(false)
    expect(isAllGreen({ ...HAS_WARN, seller: 1 })).toBe(true)
  })

  it('无置信度数据(人工录入/未识别)不标建议通过', () => {
    expect(isAllGreen({})).toBe(false)
  })
})

describe('resolveAttribution:归属解析(项目须命中主数据规范名 / 个人开支直通)', () => {
  it('个人开支直通,不看项目字段', () => {
    expect(resolveAttribution(inv({ ownerKind: 'personal', projectName: '随便写的' }), findProject))
      .toEqual({ ownerKind: 'personal' })
  })

  it('对应项目命中主数据 → 项目归属(带 projectId+规范名)', () => {
    expect(resolveAttribution(inv({ projectName: '合和新城' }), findProject))
      .toEqual({ ownerKind: 'project', projectId: 'p1', projectName: '合和新城' })
  })

  it('未填项目 / 项目名未命中主数据 → null(字段标红+归档禁用的依据)', () => {
    expect(resolveAttribution(inv(), findProject)).toBeNull()
    expect(resolveAttribution(inv({ projectName: '不存在的项目' }), findProject)).toBeNull()
  })
})

describe('selectBatchCandidates:放行范围 = 全绿票 ∪ 已校对票(工作台内、非重复)', () => {
  it('未校对须全绿才入围;已校对(人工整票确认,比全绿更强)不看置信度直接入围', () => {
    const list = [
      inv({ id: 'ok1' }),
      inv({ id: 'ok2', reviewStatus: 'reviewed' }),
      // 已校对但置信度非全绿/为空(种子票/人工录入路径):人工整票确认过,入围
      inv({ id: 'reviewed-warn', reviewStatus: 'reviewed', fieldConfidence: HAS_WARN }),
      inv({ id: 'reviewed-empty', reviewStatus: 'reviewed', fieldConfidence: {} }),
      inv({ id: 'warn', fieldConfidence: HAS_WARN }),
      inv({ id: 'dup', dupStatus: 'duplicate' }),
      inv({ id: 'archived', accountStatus: 'archived' }),
      inv({ id: 'pending', ocrStatus: 'pending', fieldConfidence: {} }),
      inv({ id: 'manual', source: 'excel' }),
    ]
    expect(selectBatchCandidates(list).map(i => i.id)).toEqual(['ok1', 'ok2', 'reviewed-warn', 'reviewed-empty'])
  })
})

describe('partitionBatchPass:有归属放行,缺归属排除并给出清单原因', () => {
  it('项目命中/个人开支进 pass;缺归属与项目名未命中进 excluded 且原因可读', () => {
    const candidates = [
      inv({ id: 'a', projectName: '合和新城' }),
      inv({ id: 'b', ownerKind: 'personal' }),
      inv({ id: 'c' }),
      inv({ id: 'd', projectName: '不存在的项目' }),
    ]
    const { pass, excluded } = partitionBatchPass(candidates, findProject)
    expect(pass.map(p => p.inv.id)).toEqual(['a', 'b'])
    expect(pass[0]!.attribution).toEqual({ ownerKind: 'project', projectId: 'p1', projectName: '合和新城' })
    expect(pass[1]!.attribution).toEqual({ ownerKind: 'personal' })
    expect(excluded.map(e => e.inv.id)).toEqual(['c', 'd'])
    for (const e of excluded)
      expect(e.reason).toBeTruthy()
  })
})
