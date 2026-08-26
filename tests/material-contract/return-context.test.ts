import { describe, expect, it } from 'vitest'
import {
  createMaterialContractReturnOrigin,
  materialContractListNavigationStateFromQuery,
  resolveMaterialContractReturnContext,
  validateMaterialContractDetailJourneyReturnTo,
  validateMaterialContractReturnTo,
  validateProjectJourneyReturnTo,
} from '~/lib/material-contract/return-context'

describe('材料采购合同列表返回上下文', () => {
  it('保留来源、筛选、分页、行锚点与滚动位置', () => {
    const state = materialContractListNavigationStateFromQuery({
      search: '瓷砖',
      projectId: 'project/1',
      supplierId: 'supplier-1',
      status: '履约中',
      origin: 'demo',
      page: '2',
      pageSize: '20',
      returnTo: '/project/project%2F1?origin=demo',
    })
    const origin = createMaterialContractReturnOrigin({
      contextId: 'origin_319_contract',
      rowIdentity: 'demo:contract/1',
      scrollTop: 864,
      now: 1_000,
      state,
    })

    expect(origin).toMatchObject({
      id: 'origin_319_contract',
      anchorId: 'material-contract-row-demo:contract/1',
      scrollTop: 864,
    })
    expect(origin.returnTo).toContain('/contract/material?')
    expect(origin.returnTo).toContain('search=%E7%93%B7%E7%A0%96')
    expect(origin.returnTo).toContain('projectId=project%2F1')
    expect(origin.returnTo).toContain('page=2')
    expect(origin.returnTo).toContain('pageSize=20')
    expect(origin.returnTo).toContain('nav=origin_319_contract')
    expect(validateMaterialContractReturnTo(origin.returnTo)).toBe(origin.returnTo)
    expect(resolveMaterialContractReturnContext({
      returnTo: origin.returnTo,
      contextId: origin.id,
      now: 1_001,
      load: id => id === origin.id ? origin : null,
    })).toEqual({ to: origin.returnTo, origin })
  })

  it.each([
    'https://evil.example/contract/material',
    '//evil.example/contract/material',
    '/contract/con-1?origin=demo',
    '/contract/material?origin=forged#material-contract-row-demo%3Acontract-1',
    '/contract/material?nav=origin_319_contract#wrong-row',
  ])('拒绝未登记或畸形返回目标：%s', (value) => {
    expect(validateMaterialContractReturnTo(value)).toBeNull()
  })

  it('逐层拒绝项目、合同列表与分供方事实的跨来源返回链', () => {
    const projectReturnTo = '/project/project-1?origin=demo'
    expect(validateProjectJourneyReturnTo(projectReturnTo, 'real')).toBeNull()

    const listReturnTo = '/contract/material?origin=demo&nav=origin_319_contract#material-contract-row-demo%3Acontract-1'
    expect(validateMaterialContractReturnTo(listReturnTo, 'real')).toBeNull()

    const contractReturnTo = `/contract/contract-1?origin=demo&contractKind=material&returnTo=${encodeURIComponent(listReturnTo)}`
    expect(validateMaterialContractDetailJourneyReturnTo(contractReturnTo, 'real')).toBeNull()
  })

  it('把省略来源的既有项目详情地址规范化为正式来源，但不替演示来源猜测', () => {
    expect(validateProjectJourneyReturnTo('/project/project-1', 'real'))
      .toBe('/project/project-1?origin=real')
    expect(validateProjectJourneyReturnTo('/project/project-1', 'demo')).toBeNull()
  })

  it('保留项目甲方商务卡片的稳定返回锚点', () => {
    expect(validateProjectJourneyReturnTo(
      '/project/project-1?origin=real#project-owner-document-card-warranty',
      'real',
    )).toBe('/project/project-1?origin=real#project-owner-document-card-warranty')
    expect(validateProjectJourneyReturnTo(
      '/project/project-1?origin=real#project-owner-document-card-forged',
      'real',
    )).toBeNull()
  })
})
