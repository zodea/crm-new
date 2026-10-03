import type { OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { describe, expect, it } from 'vitest'
import {
  filterOwnerDocumentRows,
  OWNER_DOCUMENT_LIST_CONFIG,
  ownerDocumentStatusClass,
  ownerDocumentStatusLabelForList,
  ownerDocumentStatusViewKey,
  ownerDocumentTypeLabel,
} from '~/lib/owner-document/list'

const rows: OwnerDocumentListRecord[] = [
  {
    id: 'change-1',
    no: 'BQ-001',
    name: '地下室签证',
    projectId: 'project-1',
    projectName: '合和新城',
    contractId: 'contract-1',
    contractName: '合和新城施工合同',
    supplierId: null,
    supplierName: '',
    crewId: null,
    crewName: '',
    type: 'site_visa',
    period: '',
    amount: 120,
    secondaryAmount: 110,
    tertiaryAmount: 108,
    quantity: null,
    date: '2026-07-30',
    status: 'approved',
  },
  {
    id: 'change-2',
    no: 'BQ-002',
    name: '门窗变更',
    projectId: 'project-2',
    projectName: '科学城公寓',
    contractId: 'contract-2',
    contractName: '科学城施工合同',
    supplierId: null,
    supplierName: '',
    crewId: null,
    crewName: '',
    type: 'change_negotiation',
    period: '',
    amount: 80,
    secondaryAmount: 75,
    tertiaryAmount: 70,
    quantity: null,
    date: '2026-07-29',
    status: 'submitted',
  },
]

describe('owner document list configuration', () => {
  describe('类型和状态多选遵循同字段并集、跨字段交集', () => {
    const query = { search: '', project: 'all', type: ['site_visa', 'change_negotiation'], statusView: ['approved', 'submitted'] }
    it('关联事实保持原契约', () => {
      expect(filterOwnerDocumentRows('owner_change', rows, { ...query, type: ['site_visa'] }).map(row => row.id)).toEqual(['change-1'])
    })

    it.each([
      { case: '\'owner_change\' / rows / query', input: 'owner_change', argument2: rows, argument3: query, expected: 2 },
      { case: '\'owner_change\' / rows / { ...query, type: [], statusView: [] }', input: 'owner_change', argument2: rows, argument3: { ...query, type: [], statusView: [] }, expected: 2 },
    ])('filterOwnerDocumentRows：$case', ({ input, argument2, argument3, expected }) => {
      expect(filterOwnerDocumentRows(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toHaveLength(expected)
    })
  })
  it('分包付款余额只出现在分包结算列表，甲方最终结算保持原业务列', () => {
    const paymentFields = ['deductions', 'netSettlement', 'cumulativeApplied', 'remainingApplicable', 'cumulativePaid', 'remainingUnpaid']
    expect(OWNER_DOCUMENT_LIST_CONFIG.sub_settlement.columns.map(column => column.field))
      .toEqual(expect.arrayContaining(paymentFields))
    expect(OWNER_DOCUMENT_LIST_CONFIG.final_settlement.columns.filter(column => paymentFields.includes(column.field ?? '')))
      .toEqual([])
    expect(OWNER_DOCUMENT_LIST_CONFIG.final_settlement.columns.find(column => column.field === 'amount')?.title)
      .toBe('结算金额')
  })

  it('八类列表保留各自真实业务列与金额汇总口径', () => {
    expect(Object.keys(OWNER_DOCUMENT_LIST_CONFIG)).toHaveLength(8)
    expect(OWNER_DOCUMENT_LIST_CONFIG.owner_change.columns.map(column => column.title))
      .toEqual(expect.arrayContaining([
        '含税审定金额',
        '无税审定金额',
        '无税申报金额',
      ]))
    expect(OWNER_DOCUMENT_LIST_CONFIG.owner_report.columns.map(column => column.title))
      .toEqual(expect.arrayContaining(['申报产值', '审定金额', '审定差额']))
    expect(OWNER_DOCUMENT_LIST_CONFIG.sub_change.columns.map(column => column.title))
      .toEqual(expect.arrayContaining(['乙方（分供方）', '变更面积', '实际审定价']))
    expect(OWNER_DOCUMENT_LIST_CONFIG.sub_settlement.columns.map(column => column.title))
      .toContain('结算类型')
    expect(OWNER_DOCUMENT_LIST_CONFIG.acceptance.amountSummaries)
      .toEqual([{ field: 'amount', label: '合同估算金额总和' }])
    expect(OWNER_DOCUMENT_LIST_CONFIG.acceptance.columns.map(column => column.title))
      .toEqual(expect.arrayContaining(['合同估算', '验收结论', '附件']))
  })

  it.each([
    { case: '\'owner_change\' / rows / { search: \'地下室\', project: \'project-1\', type: \'site_visa\', statusView: \'approved\', routeProject: \'proj', input: 'owner_change', argument2: rows, argument3: {
      search: '地下室',
      project: 'project-1',
      type: 'site_visa',
      statusView: 'approved',
      routeProject: 'project-1',
      routeContract: 'contract-1',
    }, expected: [rows[0]] },
    { case: '\'owner_change\' / rows / { search: \'施工合同\', project: \'all\', type: \'all\', statusView: \'submitted\', routeProject: \'project-1\', }', input: 'owner_change', argument2: rows, argument3: {
      search: '施工合同',
      project: 'all',
      type: 'all',
      statusView: 'submitted',
      routeProject: 'project-1',
    }, expected: [] },
  ])('按搜索、项目、类型、状态与来源 query 共同收窄真实 ID / filterOwnerDocumentRows：$case', ({ input, argument2, argument3, expected }) => {
    expect(filterOwnerDocumentRows(input, argument2, argument3)).toEqual(expected)
  })

  it('按单据类型解释本地状态与类型，而不把英文存储值暴露给用户', () => {
    expect(OWNER_DOCUMENT_LIST_CONFIG.owner_penalty.views).toEqual([
      { key: 'all', label: '全部' },
      { key: 'draft', label: '草稿' },
      { key: 'submitted', label: '已提交' },
    ])
    expect(ownerDocumentStatusClass('sub_change', 'rejected')).toBe('chip-danger')
    expect(ownerDocumentTypeLabel('owner_change', 'site_visa')).toBe('现场签证')
  })

  it.each([
    { case: '\'owner_report\' / \'adjusted\'', input: 'owner_report', argument2: 'adjusted', expected: 'reported' },
    { case: '\'owner_penalty\' / \'submitted\'', input: 'owner_penalty', argument2: 'submitted', expected: 'submitted' },
    { case: '\'project_penalty\' / \'draft\'', input: 'project_penalty', argument2: 'draft', expected: 'draft' },
  ])('按单据类型解释本地状态与类型，而不把英文存储值暴露给用户 / ownerDocumentStatusViewKey：$case', ({ input, argument2, expected }) => {
    expect(ownerDocumentStatusViewKey(input, argument2)).toBe(expected)
  })

  it.each([
    { case: '\'owner_change\' / \'submitted\'', input: 'owner_change', argument2: 'submitted', expected: '已上报' },
    { case: '\'owner_penalty\' / \'submitted\'', input: 'owner_penalty', argument2: 'submitted', expected: '已提交' },
    { case: '\'acceptance\' / \'expired\'', input: 'acceptance', argument2: 'expired', expected: '已到期' },
    { case: '\'project_penalty\' / \'draft\'', input: 'project_penalty', argument2: 'draft', expected: '草稿' },
    { case: '\'project_penalty\' / \'repairing\'', input: 'project_penalty', argument2: 'repairing', expected: '整改中' },
    { case: '\'project_penalty\' / \'repaired_self\'', input: 'project_penalty', argument2: 'repaired_self', expected: '自行整改' },
  ])('按单据类型解释本地状态与类型，而不把英文存储值暴露给用户 / ownerDocumentStatusLabelForList：$case', ({ input, argument2, expected }) => {
    expect(ownerDocumentStatusLabelForList(input, argument2)).toBe(expected)
  })

  describe('验收列表按 canonical 状态区分已验收与已到期', () => {
    const accepted = { ...rows[0], id: 'acceptance-accepted', status: 'accepted' }
    const expired = { ...rows[0], id: 'acceptance-expired', status: 'expired' }
    it.each([
      { case: '\'acceptance\' / accepted.status', input: 'acceptance', argument2: accepted.status, expected: 'accepted' },
      { case: '\'acceptance\' / expired.status', input: 'acceptance', argument2: expired.status, expected: 'expired' },
    ])('ownerDocumentStatusViewKey：$case', ({ input, argument2, expected }) => {
      expect(ownerDocumentStatusViewKey(structuredClone(input), structuredClone(argument2))).toBe(expected)
    })

    it.each([
      { case: '\'acceptance\' / [accepted, expired] / { search: \'\', project: \'all\', type: \'all\', statusView: \'accepted\', }', input: 'acceptance', argument2: [accepted, expired], argument3: {
        search: '',
        project: 'all',
        type: 'all',
        statusView: 'accepted',
      }, expected: [accepted] },
      { case: '\'acceptance\' / [accepted, expired] / { search: \'\', project: \'all\', type: \'all\', statusView: \'expired\', }', input: 'acceptance', argument2: [accepted, expired], argument3: {
        search: '',
        project: 'all',
        type: 'all',
        statusView: 'expired',
      }, expected: [expired] },
    ])('filterOwnerDocumentRows：$case', ({ input, argument2, argument3, expected }) => {
      expect(filterOwnerDocumentRows(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toEqual(expected)
    })
  })

  it('甲方罚扣可按联系单编号搜索', () => {
    const penalty = {
      ...rows[0],
      id: 'penalty-1',
      noticeNo: 'LX-2026-001',
      status: 'submitted',
    }
    expect(filterOwnerDocumentRows('owner_penalty', [penalty], {
      search: 'LX-2026-001',
      project: 'all',
      type: 'all',
      statusView: 'all',
    })).toEqual([penalty])
  })
})
