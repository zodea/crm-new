import { describe, expect, it } from 'vitest'
import {
  createOwnerDocumentProjectReturnOrigin,
  createOwnerDocumentReturnOrigin,
  ownerDocumentListNavigationStateFromQuery,
  resolveOwnerDocumentProjectReturnOrigin,
  resolveOwnerDocumentReturnContext,
  validateOwnerDocumentDetailReturnTo,
  validateOwnerDocumentJourneyReturnTo,
  validateOwnerDocumentListReturnTo,
} from '~/lib/owner-document/return-context'

describe('甲方商务单据返回上下文', () => {
  it('多选与显式不限状态经返回地址归一后保持', () => {
    const state = { search: '', projectId: null, contractId: null, documentType: ['site_visa', 'change_negotiation'], status: ['approved', 'submitted'], origin: 'real' as const, page: 1, pageSize: 20 as const }
    const origin = createOwnerDocumentReturnOrigin({ kind: 'owner_change', contextId: 'origin_multi_test', rowIdentity: 'real:owner_change:test', scrollTop: 0, now: 0, state })
    expect(validateOwnerDocumentListReturnTo(origin.returnTo, 'owner_change', 'real')).toBe(origin.returnTo)
    expect(ownerDocumentListNavigationStateFromQuery({ status: 'all' }, 'owner_change').status).toBe('all')
  })
  it('项目罚扣拒绝同 ID 的跨来源班组返回', () => {
    expect(validateOwnerDocumentJourneyReturnTo('/base/crew/shared-id?origin=real', 'project_penalty', 'real')).toBe('/base/crew/shared-id?origin=real')
  })

  it.each([
    { case: '\'/base/crew/shared-id?origin=demo\' / \'project_penalty\' / \'real\'', input: '/base/crew/shared-id?origin=demo', argument2: 'project_penalty', argument3: 'real' },
    { case: '\'/base/crew/shared-id?origin=real\' / \'project_penalty\' / \'demo\'', input: '/base/crew/shared-id?origin=real', argument2: 'project_penalty', argument3: 'demo' },
  ])('项目罚扣拒绝同 ID 的跨来源班组返回 / validateOwnerDocumentJourneyReturnTo：$case', ({ input, argument2, argument3 }) => {
    expect(validateOwnerDocumentJourneyReturnTo(input, argument2, argument3)).toBeNull()
  })
  it.each([
    { case: '原卡片', requestedCard: 'final-settlement', restored: true },
    { case: '篡改卡片', requestedCard: 'penalty', restored: false },
  ])('项目商务卡片按受限上下文恢复精确滚动位置：$case', ({ requestedCard, restored }) => {
    const returnTo = '/project/project-283?origin=real&ownerJourney=origin_283_final#project-owner-document-card-final-settlement'
    const origin = createOwnerDocumentProjectReturnOrigin({
      contextId: 'origin_283_final',
      returnTo,
      anchorId: 'project-owner-document-card-final-settlement',
      scrollTop: 512,
      now: 1000,
    })

    expect(resolveOwnerDocumentProjectReturnOrigin({
      returnTo: returnTo.replace('final-settlement', requestedCard),
      contextId: 'origin_283_final',
      now: 1500,
      load: () => origin,
    })).toEqual(restored ? origin : null)
  })

  it('分包变洽签沿用受限列表、项目卡片与分包合同返回链', () => {
    const projectReturnTo = '/project/project-327?origin=real&ownerJourney=origin_327_sub#project-owner-document-card-sub-change'
    expect(createOwnerDocumentProjectReturnOrigin({
      contextId: 'origin_327_sub',
      returnTo: projectReturnTo,
      anchorId: 'project-owner-document-card-sub-change',
      scrollTop: 327,
      now: 1000,
    }).returnTo).toBe(projectReturnTo)

    const list = '/subcontract/change?origin=real&nav=origin_327_list#owner-document-row-real%3Asub_change%3Asub-change-327'
    const contract = '/contract/subcontract-327?origin=real&contractKind=subcontract&tab=changes&focus=sub-change-327'
    const detail = `/subcontract/change/sub-change-327?origin=real&returnTo=${encodeURIComponent(contract)}`
    expect(validateOwnerDocumentListReturnTo(list, 'sub_change', 'real')).toBe(list)
    expect(validateOwnerDocumentJourneyReturnTo(contract, 'sub_change', 'real')).toBe(contract)
    expect(validateOwnerDocumentJourneyReturnTo(projectReturnTo, 'sub_change', 'real')).toBe(projectReturnTo)
    expect(validateOwnerDocumentDetailReturnTo(detail, 'real')).toBe(detail)
    expect(validateOwnerDocumentJourneyReturnTo(contract.replace('origin=real', 'origin=demo'), 'sub_change', 'real')).toBeNull()
  })

  describe('按单据领域隔离合同来源，并允许分包变洽签返回匹配分供方详情', () => {
    const construction = '/contract/construction-327?origin=real&contractKind=construction&tab=changes'
    const subcontract = '/contract/subcontract-327?origin=real&contractKind=subcontract&tab=changes'
    const supplier = '/base/supplier/supplier-327?origin=real'
    it('关联事实保持原契约', () => {
      expect(validateOwnerDocumentJourneyReturnTo(supplier, 'sub_change', 'real')).toBe(supplier)
    })

    it.each([
      { case: '{ returnTo: subcontract } / \'owner_change\'', input: { returnTo: subcontract }, argument2: 'owner_change' },
      { case: '{ returnTo: construction } / \'sub_change\'', input: { returnTo: construction }, argument2: 'sub_change' },
    ])('关联事实保持原契约 / ownerDocumentListNavigationStateFromQuery：$case', ({ input, argument2 }) => {
      expect(ownerDocumentListNavigationStateFromQuery(input, argument2).returnTo).toBeNull()
    })

    it.each([
      { case: 'subcontract / \'owner_change\' / \'real\'', input: subcontract, argument2: 'owner_change', argument3: 'real' },
      { case: 'construction / \'sub_change\' / \'real\'', input: construction, argument2: 'sub_change', argument3: 'real' },
      { case: 'supplier / \'owner_change\' / \'real\'', input: supplier, argument2: 'owner_change', argument3: 'real' },
    ])('validateOwnerDocumentJourneyReturnTo：$case', ({ input, argument2, argument3 }) => {
      expect(validateOwnerDocumentJourneyReturnTo(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBeNull()
    })
  })

  it('白名单化列表筛选、分页、行锚点与滚动位置', () => {
    const origin = createOwnerDocumentReturnOrigin({
      kind: 'owner_change',
      contextId: 'origin_323',
      rowIdentity: 'real:owner_change:change-323',
      scrollTop: 640,
      now: 1000,
      state: {
        search: '桥架',
        projectId: 'project-323',
        contractId: 'contract-323',
        status: 'approved',
        documentType: 'change_negotiation',
        origin: 'real',
        page: 2,
        pageSize: 50,
      },
    })

    expect(origin.returnTo).toContain('/owner/change?search=%E6%A1%A5%E6%9E%B6')
    expect(origin.returnTo).toContain('projectId=project-323')
    expect(origin.returnTo).toContain('documentType=change_negotiation')
    expect(origin.returnTo).toContain('page=2&pageSize=50&nav=origin_323')
    expect(origin.returnTo).toContain('#owner-document-row-real%3Aowner_change%3Achange-323')
    expect(resolveOwnerDocumentReturnContext({
      kind: 'owner_change',
      returnTo: origin.returnTo,
      contextId: 'origin_323',
      origin: 'real',
      now: 1500,
      load: () => origin,
    })).toEqual({ to: origin.returnTo, origin })
  })

  describe('表单和关系下钻只接受同来源的稳定单据详情返回链', () => {
    const detail = '/owner/report/report-323?origin=real&returnTo=%2Fproject%2Fproject-323%3Forigin%3Dreal'
    it('关联事实保持原契约', () => {
      expect(validateOwnerDocumentDetailReturnTo(detail, 'real')).toBe(detail)
    })

    it.each([
      { case: 'detail / \'real\' / \'sub_change\'', input: detail, argument2: 'real', argument3: 'sub_change' },
      { case: 'detail / \'demo\'', input: detail, argument2: 'demo', argument3: undefined },
    ])('validateOwnerDocumentDetailReturnTo：$case', ({ input, argument2, argument3 }) => {
      expect(validateOwnerDocumentDetailReturnTo(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBeNull()
    })
  })

  it.each([
    { case: '\'/subcontract/change/sub-change-327?origin=real\' / \'real\' / \'owner_report\'', input: '/subcontract/change/sub-change-327?origin=real', argument2: 'real', argument3: 'owner_report' },
    { case: '\'/owner/report/%2F?origin=real\' / \'real\'', input: '/owner/report/%2F?origin=real', argument2: 'real', argument3: undefined },
  ])('表单和关系下钻只接受同来源的稳定单据详情返回链 / validateOwnerDocumentDetailReturnTo：$case', ({ input, argument2, argument3 }) => {
    expect(validateOwnerDocumentDetailReturnTo(input, argument2, argument3)).toBeNull()
  })

  describe('允许同来源施工合同详情或项目详情返回，拒绝外链与跨来源链', () => {
    const contract = '/contract/contract-323?origin=real&contractKind=construction&tab=changes'
    const project = '/project/project-323?origin=real'
    it('关联事实保持原契约', () => {
      expect(validateOwnerDocumentListReturnTo('/owner/report?nav=origin_323#owner-document-row-real%3Areport-1', 'owner_change', 'real')).toBeNull()
    })

    it.each([
      { case: 'contract / \'owner_change\' / \'real\'', input: contract, argument2: 'owner_change', argument3: 'real', expected: contract },
      { case: 'project / \'owner_report\' / \'real\'', input: project, argument2: 'owner_report', argument3: 'real', expected: project },
    ])('validateOwnerDocumentJourneyReturnTo：$case', ({ input, argument2, argument3, expected }) => {
      expect(validateOwnerDocumentJourneyReturnTo(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBe(expected)
    })

    it.each([
      { case: 'contract / \'owner_change\' / \'demo\'', input: contract, argument2: 'owner_change', argument3: 'demo' },
      { case: '\'https://evil.example/owner/change\' / \'owner_change\' / \'real\'', input: 'https://evil.example/owner/change', argument2: 'owner_change', argument3: 'real' },
    ])('validateOwnerDocumentJourneyReturnTo：$case', ({ input, argument2, argument3 }) => {
      expect(validateOwnerDocumentJourneyReturnTo(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBeNull()
    })
  })

  it('白名单化甲方罚扣列表与详情返回链', () => {
    const list = '/owner/penalty?origin=real&nav=origin_326#owner-document-row-real%3Aowner_penalty%3Aowner-penalty-326'
    const detail = `/owner/penalty/owner-penalty-326?origin=real&returnTo=${encodeURIComponent(list)}&returnContext=origin_326`
    expect(validateOwnerDocumentListReturnTo(list, 'owner_penalty', 'real')).toBe(list)
    expect(validateOwnerDocumentDetailReturnTo(detail, 'real')).toBe(detail)
    expect(validateOwnerDocumentDetailReturnTo(detail.replace('/owner/penalty/', '/project/penalty/'), 'real')).toBeNull()
  })

  it('缺失、过期或篡改的会话上下文安全回退 canonical 列表', () => {
    expect(resolveOwnerDocumentReturnContext({
      kind: 'owner_report',
      returnTo: '//evil.example',
      contextId: 'bad',
      origin: 'real',
      now: 2000,
      load: () => null,
    })).toEqual({ to: '/owner/report', origin: null })
  })
})
