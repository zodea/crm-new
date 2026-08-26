import { describe, expect, it } from 'vitest'
import {
  OWNER_DOCUMENT_META,
  ownerDocumentDefaults,
  ownerDocumentDetailPath,
  ownerDocumentFormPath,
  ownerDocumentKindFromRoute,
  validateOwnerDocumentForm,
} from '~/lib/owner-document/page'

describe('f5 单据页面模型', () => {
  it('八类单据拥有唯一列表路径和可反解路由', () => {
    const paths = Object.values(OWNER_DOCUMENT_META).map(meta => meta.listPath)
    expect(new Set(paths).size).toBe(8)

    for (const [kind, meta] of Object.entries(OWNER_DOCUMENT_META)) {
      expect(ownerDocumentKindFromRoute(meta.routeScope, meta.routeKind)).toBe(kind)
      expect(ownerDocumentFormPath(kind as keyof typeof OWNER_DOCUMENT_META)).toBe(`${meta.listPath}/new`)
      expect(ownerDocumentFormPath(kind as keyof typeof OWNER_DOCUMENT_META, 'f5_1')).toBe(
        kind === 'owner_change' || kind === 'owner_report' || kind === 'acceptance'
          ? `${meta.listPath}/form/f5_1`
          : `${meta.listPath}/f5_1`,
      )
    }
  })

  it('dOC01/DOC02 三类单据用独立只读详情地址，并显式保留来源和验收视图', () => {
    expect(ownerDocumentDetailPath('owner_change', 'change/323', 'real'))
      .toBe('/owner/change/change%2F323?origin=real')
    expect(ownerDocumentDetailPath('owner_report', 'report-323', 'demo'))
      .toBe('/owner/report/report-323?origin=demo')
    expect(ownerDocumentDetailPath('acceptance', 'acceptance-324', 'real', 'warranty'))
      .toBe('/owner/acceptance/acceptance-324?origin=real&variant=warranty')
  })

  it('八类表单提供准确分区和对应合同入口', () => {
    const ownerKinds = [
      'owner_change',
      'owner_report',
      'acceptance',
      'final_settlement',
      'owner_penalty',
    ] as const
    const expenditureKinds = [
      'sub_change',
      'sub_settlement',
      'project_penalty',
    ] as const

    for (const kind of ownerKinds) {
      expect(OWNER_DOCUMENT_META[kind].contractListPath).toBe('/contract/construction')
      expect(OWNER_DOCUMENT_META[kind].contractListLabel).toBe('施工合同列表')
    }
    for (const kind of expenditureKinds) {
      expect(OWNER_DOCUMENT_META[kind].contractListPath).toBe('/contract/subcontract')
      expect(OWNER_DOCUMENT_META[kind].contractListLabel).toBe('分包合同列表')
    }

    expect(OWNER_DOCUMENT_META.owner_change.sections.map(section => section.label))
      .toEqual(['基本信息', '变更明细', '附件与备注'])
    expect(OWNER_DOCUMENT_META.acceptance.sections.map(section => section.label))
      .toEqual(['验收信息', '附件与备注'])
    expect(OWNER_DOCUMENT_META.final_settlement.sections.map(section => section.label))
      .toEqual(['结算信息', '附件与备注'])
    expect(OWNER_DOCUMENT_META.project_penalty.sections.map(section => section.label))
      .toEqual(['罚扣信息', '附件与备注'])
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

  it('提交校验覆盖八类单据，并允许纯金额签证不填写 BOQ 明细', () => {
    for (const kind of Object.keys(OWNER_DOCUMENT_META) as Array<keyof typeof OWNER_DOCUMENT_META>)
      expect(Object.keys(validateOwnerDocumentForm(kind, {})).length).toBeGreaterThan(0)

    expect(validateOwnerDocumentForm('owner_change', {
      name: '纯金额现场签证',
      projectId: 'project-1',
      contractId: 'contract-1',
      applicationDate: '2026-07-26',
      reason: '仅确认金额',
      approvedTaxInclusiveAmount: 88,
      lines: [],
    })).toEqual({})

    expect(validateOwnerDocumentForm('owner_change', {
      name: '缺少金额与明细',
      projectId: 'project-1',
      contractId: 'contract-1',
      applicationDate: '2026-07-26',
      reason: '待补明细',
      lines: [],
    })).toEqual({
      lines: '至少填写一条量价变更，或填写纯金额签证金额',
    })
  })

  it('在页面命令前拦截空变更行、越界调量和无效报量行', () => {
    const base = {
      name: '负二层桥架变更',
      projectId: 'project-1',
      contractId: 'contract-1',
      applicationDate: '2026-08-25',
      reason: '现场调整',
    }
    const boqLines = [{
      id: 'boq-1',
      itemName: '桥架安装',
      unit: 'm',
      qty: 100,
      unitPrice: 52,
      autoQty: 80,
      missingQtyCount: 0,
    }]

    expect(validateOwnerDocumentForm('owner_change', {
      ...base,
      lines: [{ operation: 'qty', boqLineId: '', deltaQty: null }],
    }, boqLines)).toMatchObject({ lines: expect.stringContaining('BOQ') })
    expect(validateOwnerDocumentForm('owner_change', {
      ...base,
      lines: [{ operation: 'qty', boqLineId: 'boq-1', deltaQty: -101 }],
    }, boqLines)).toMatchObject({ lines: expect.stringContaining('调整后合同工程量不能为负数') })
    expect(validateOwnerDocumentForm('owner_report', {
      projectId: 'project-1',
      contractId: 'contract-1',
      periodNo: '2026-08',
      applicationDate: '2026-08-25',
      lines: [{ boqLineId: 'boq-1', reportedQty: -1 }],
    }, boqLines)).toMatchObject({ lines: expect.stringContaining('申报量不能为负数') })
  })
})
