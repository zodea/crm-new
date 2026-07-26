import { describe, expect, it } from 'vitest'
import {
  OWNER_DOCUMENT_META,
  ownerDocumentDefaults,
  ownerDocumentFormPath,
  ownerDocumentKindFromRoute,
} from '~/lib/owner-document/page'

describe('f5 单据页面模型', () => {
  it('八类单据拥有唯一列表路径和可反解路由', () => {
    const paths = Object.values(OWNER_DOCUMENT_META).map(meta => meta.listPath)
    expect(new Set(paths).size).toBe(8)

    for (const [kind, meta] of Object.entries(OWNER_DOCUMENT_META)) {
      expect(ownerDocumentKindFromRoute(meta.routeScope, meta.routeKind)).toBe(kind)
      expect(ownerDocumentFormPath(kind as keyof typeof OWNER_DOCUMENT_META)).toBe(`${meta.listPath}/new`)
      expect(ownerDocumentFormPath(kind as keyof typeof OWNER_DOCUMENT_META, 'f5_1')).toBe(`${meta.listPath}/f5_1`)
    }
  })

  it('默认值按单据类型隔离，行式单据只初始化自己的明细', () => {
    expect(ownerDocumentDefaults('owner_change')).toMatchObject({
      status: 'draft',
      documentType: 'change_negotiation',
      lines: [],
    })
    expect(ownerDocumentDefaults('owner_report')).toMatchObject({
      status: 'draft',
      periodNo: expect.stringMatching(/^\d{4}-\d{2}$/),
      lines: [],
    })
    expect(ownerDocumentDefaults('project_penalty')).toMatchObject({
      status: 'draft',
      deductionMethod: '结算抵扣',
    })
    expect(ownerDocumentDefaults('acceptance')).not.toHaveProperty('lines')
  })
})
