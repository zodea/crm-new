import { describe, expect, it } from 'vitest'
import {
  createOwnerDocumentProjectReturnOrigin,
  createOwnerDocumentReturnOrigin,
  resolveOwnerDocumentProjectReturnOrigin,
  resolveOwnerDocumentReturnContext,
  validateOwnerDocumentDetailReturnTo,
  validateOwnerDocumentJourneyReturnTo,
  validateOwnerDocumentListReturnTo,
} from '~/lib/owner-document/return-context'

describe('甲方商务单据返回上下文', () => {
  it('项目六类卡片来源按受限上下文恢复精确滚动位置', () => {
    const returnTo = '/project/project-283?origin=real&ownerJourney=origin_283_final#project-owner-document-card-final-settlement'
    const origin = createOwnerDocumentProjectReturnOrigin({
      contextId: 'origin_283_final',
      returnTo,
      anchorId: 'project-owner-document-card-final-settlement',
      scrollTop: 512,
      now: 1000,
    })

    expect(resolveOwnerDocumentProjectReturnOrigin({
      returnTo,
      contextId: 'origin_283_final',
      now: 1500,
      load: () => origin,
    })).toEqual(origin)
    expect(resolveOwnerDocumentProjectReturnOrigin({
      returnTo: returnTo.replace('final-settlement', 'penalty'),
      contextId: 'origin_283_final',
      now: 1500,
      load: () => origin,
    })).toBeNull()
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

  it('表单和关系下钻只接受同来源的稳定单据详情返回链', () => {
    const detail = '/owner/report/report-323?origin=real&returnTo=%2Fproject%2Fproject-323%3Forigin%3Dreal'
    expect(validateOwnerDocumentDetailReturnTo(detail, 'real')).toBe(detail)
    expect(validateOwnerDocumentDetailReturnTo(detail, 'demo')).toBeNull()
    expect(validateOwnerDocumentDetailReturnTo('/owner/report/%2F?origin=real', 'real')).toBeNull()
  })

  it('允许同来源施工合同详情或项目详情返回，拒绝外链与跨来源链', () => {
    const contract = '/contract/contract-323?origin=real&contractKind=construction&tab=changes'
    const project = '/project/project-323?origin=real'
    expect(validateOwnerDocumentJourneyReturnTo(contract, 'owner_change', 'real')).toBe(contract)
    expect(validateOwnerDocumentJourneyReturnTo(project, 'owner_report', 'real')).toBe(project)
    expect(validateOwnerDocumentJourneyReturnTo(contract, 'owner_change', 'demo')).toBeNull()
    expect(validateOwnerDocumentJourneyReturnTo('https://evil.example/owner/change', 'owner_change', 'real')).toBeNull()
    expect(validateOwnerDocumentListReturnTo('/owner/report?nav=origin_323#owner-document-row-real%3Areport-1', 'owner_change', 'real')).toBeNull()
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
