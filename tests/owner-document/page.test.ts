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
  it.each(Object.entries(OWNER_DOCUMENT_META))('八类单据拥有唯一列表路径和可反解路由：输入案例 %#', (kind, meta) => {
    const paths = Object.values(OWNER_DOCUMENT_META).map(meta => meta.listPath)
    expect(new Set(paths).size).toBe(8)
    expect(ownerDocumentKindFromRoute(meta.routeScope, meta.routeKind)).toBe(kind)
    expect(ownerDocumentFormPath(kind as keyof typeof OWNER_DOCUMENT_META)).toBe(`${meta.listPath}/new`)
    expect(ownerDocumentFormPath(kind as keyof typeof OWNER_DOCUMENT_META, 'f5_1')).toBe(
      ['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty', 'sub_change', 'sub_settlement', 'project_penalty'].includes(kind)
        ? `${meta.listPath}/form/f5_1`
        : `${meta.listPath}/f5_1`,
    )
  })

  it.each([
    { case: '\'owner_change\' / \'change/323\' / \'real\'', input: 'owner_change', argument2: 'change/323', argument3: 'real', argument4: undefined, expected: '/owner/change/change%2F323?origin=real' },
    { case: '\'owner_report\' / \'report-323\' / \'demo\'', input: 'owner_report', argument2: 'report-323', argument3: 'demo', argument4: undefined, expected: '/owner/report/report-323?origin=demo' },
    { case: '\'acceptance\' / \'acceptance-324\' / \'real\' / \'warranty\'', input: 'acceptance', argument2: 'acceptance-324', argument3: 'real', argument4: 'warranty', expected: '/owner/acceptance/acceptance-324?origin=real&variant=warranty' },
    { case: '\'final_settlement\' / \'final-settlement/325\' / \'real\'', input: 'final_settlement', argument2: 'final-settlement/325', argument3: 'real', argument4: undefined, expected: '/owner/final-settlement/final-settlement%2F325?origin=real' },
    { case: '\'owner_penalty\' / \'owner-penalty/326\' / \'real\'', input: 'owner_penalty', argument2: 'owner-penalty/326', argument3: 'real', argument4: undefined, expected: '/owner/penalty/owner-penalty%2F326?origin=real' },
    { case: '\'sub_change\' / \'sub-change/327\' / \'real\'', input: 'sub_change', argument2: 'sub-change/327', argument3: 'real', argument4: undefined, expected: '/subcontract/change/sub-change%2F327?origin=real' },
  ])('五类甲方单据与分包变洽签用独立只读详情地址，并显式保留来源和验收视图 / ownerDocumentDetailPath：$case', ({ input, argument2, argument3, argument4, expected }) => {
    expect(ownerDocumentDetailPath(input, argument2, argument3, argument4)).toBe(expected)
  })

  it.each([
    { kind: 'owner_change', expectedPath: '/contract/construction', expectedLabel: '施工合同列表' },
    { kind: 'owner_report', expectedPath: '/contract/construction', expectedLabel: '施工合同列表' },
    { kind: 'acceptance', expectedPath: '/contract/construction', expectedLabel: '施工合同列表' },
    { kind: 'final_settlement', expectedPath: '/contract/construction', expectedLabel: '施工合同列表' },
    { kind: 'owner_penalty', expectedPath: '/contract/construction', expectedLabel: '施工合同列表' },
    { kind: 'sub_change', expectedPath: '/contract/subcontract', expectedLabel: '分包合同列表' },
    { kind: 'sub_settlement', expectedPath: '/contract/subcontract', expectedLabel: '分包合同列表' },
    { kind: 'project_penalty', expectedPath: '/contract/subcontract', expectedLabel: '分包合同列表' },
  ] as const)('$kind 表单使用 $expectedLabel', ({ kind, expectedPath, expectedLabel }) => {
    expect(OWNER_DOCUMENT_META[kind].contractListPath).toBe(expectedPath)
    expect(OWNER_DOCUMENT_META[kind].contractListLabel).toBe(expectedLabel)

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
    expect(ownerDocumentDefaults('acceptance')).not.toHaveProperty('lines')
  })

  it.each([
    { case: '\'owner_change\'', input: 'owner_change', expected: {
      status: 'draft',
      documentType: 'change_negotiation',
      lines: [],
    } },
    { case: '\'owner_report\'', input: 'owner_report', expected: {
      status: 'draft',
      periodNo: expect.stringMatching(/^\d{4}-\d{2}$/),
      lines: [],
    } },
    { case: '\'project_penalty\'', input: 'project_penalty', expected: {
      status: 'draft',
      deductionMethod: '结算抵扣',
    } },
  ])('默认值按单据类型隔离，行式单据只初始化自己的明细 / ownerDocumentDefaults：$case', ({ input, expected }) => {
    expect(ownerDocumentDefaults(input)).toMatchObject(expected)
  })

  it.each([
    { case: '\'owner_change\' / { name: \'纯金额现场签证\', projectId: \'project-1\', contractId: \'contract-1\', applicationDate: \'2026-07-26\', reason: ', input: 'owner_change', argument2: {
      name: '纯金额现场签证',
      projectId: 'project-1',
      contractId: 'contract-1',
      applicationDate: '2026-07-26',
      reason: '仅确认金额',
      approvedTaxInclusiveAmount: 88,
      lines: [],
    }, expected: {} },
    { case: '\'owner_change\' / { name: \'缺少金额与明细\', projectId: \'project-1\', contractId: \'contract-1\', applicationDate: \'2026-07-26\', reason: ', input: 'owner_change', argument2: {
      name: '缺少金额与明细',
      projectId: 'project-1',
      contractId: 'contract-1',
      applicationDate: '2026-07-26',
      reason: '待补明细',
      lines: [],
    }, expected: {
      lines: '至少填写一条量价变更，或填写纯金额签证金额',
    } },
  ])('提交校验覆盖八类单据，并允许纯金额签证不填写 BOQ 明细 / validateOwnerDocumentForm：$case', ({ input, argument2, expected }) => {
    expect(validateOwnerDocumentForm(input, argument2)).toEqual(expected)
  })

  it.each([
    { case: '\'final_settlement\' / { name: \'最终结算\', projectId: \'project-1\', settlementAmount: 100, submissionDate: \'2026-08-25\', }', input: 'final_settlement', argument2: {
      name: '最终结算',
      projectId: 'project-1',
      settlementAmount: 100,
      submissionDate: '2026-08-25',
    }, expected: { contractId: '施工合同为必填项' } },
    { case: '\'owner_penalty\' / { projectId: \'project-1\', amount: 36000, penaltyDate: \'2026-08-26\', reason: \'施工进度延误\', }', input: 'owner_penalty', argument2: {
      projectId: 'project-1',
      amount: 36000,
      penaltyDate: '2026-08-26',
      reason: '施工进度延误',
    }, expected: { contractId: '施工合同为必填项' } },
  ])('提交校验覆盖八类单据，并允许纯金额签证不填写 BOQ 明细 / validateOwnerDocumentForm：$case', ({ input, argument2, expected }) => {
    expect(validateOwnerDocumentForm(input, argument2)).toMatchObject(expected)
  })

  it.each(Array.from(Object.keys(OWNER_DOCUMENT_META) as Array<keyof typeof OWNER_DOCUMENT_META>).map(input => ({ input })))('提交校验覆盖八类单据，并允许纯金额签证不填写 BOQ 明细：输入组合 1 案例 %#', ({ input: kind }) => {
    expect(Object.keys(validateOwnerDocumentForm(kind, {})).length).toBeGreaterThan(0)
  })

  describe('在页面命令前拦截空变更行、越界调量和无效报量行', () => {
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
    it.each([
      { case: '\'owner_change\' / { ...base, lines: [{ operation: \'qty\', boqLineId: \'\', deltaQty: null }], } / boqLines', input: 'owner_change', argument2: {
        ...base,
        lines: [{ operation: 'qty', boqLineId: '', deltaQty: null }],
      }, argument3: boqLines, expected: { lines: expect.stringContaining('BOQ') } },
      { case: '\'owner_change\' / { ...base, lines: [{ operation: \'qty\', boqLineId: \'boq-1\', deltaQty: -101 }], } / boqLines', input: 'owner_change', argument2: {
        ...base,
        lines: [{ operation: 'qty', boqLineId: 'boq-1', deltaQty: -101 }],
      }, argument3: boqLines, expected: { lines: expect.stringContaining('调整后合同工程量不能为负数') } },
      { case: '\'owner_report\' / { projectId: \'project-1\', contractId: \'contract-1\', periodNo: \'2026-08\', applicationDate: \'2026-08-25\', line', input: 'owner_report', argument2: {
        projectId: 'project-1',
        contractId: 'contract-1',
        periodNo: '2026-08',
        applicationDate: '2026-08-25',
        lines: [{ boqLineId: 'boq-1', reportedQty: -1 }],
      }, argument3: boqLines, expected: { lines: expect.stringContaining('申报量不能为负数') } },
    ])('validateOwnerDocumentForm：$case', ({ input, argument2, argument3, expected }) => {
      expect(validateOwnerDocumentForm(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toMatchObject(expected)
    })
  })
})
