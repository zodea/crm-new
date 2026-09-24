import { describe, expect, it } from 'vitest'
import { validateAuxiliaryReturnTo } from '../../app/lib/auxiliary-contract/navigation'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'

describe('辅助合同只读导航', () => {
  it('两类主链接落到各自只读路由，返回保留筛选页码和锚点', () => {
    const origin = '/contract/other-expense?search=检测&page=2&pageSize=10&supplierId=s-1#aux-row-c-1'
    expect(validateAuxiliaryReturnTo(origin, 'real')).toBe(origin)
    for (const kind of ['other_expense', 'company_expense']) {
      const target = resolveNavigationTarget({ kind: 'entity-detail', subject: { entity: 'contract', state: 'resolved', id: 'c-1', label: '合同', no: null }, variant: kind, view: null, filters: { dataOrigin: 'real', contractKind: kind } })
      expect(target).toMatchObject({ state: 'resolved', to: `/contract/${kind.replace('_', '-')}/c-1?origin=real` })
    }
  })
  it('返回严格校验内部路由、层数和来源，不接受任意 URL 或跨来源上下文', () => {
    for (const value of ['https://example.com', '//example.com', '/contract/other-expense/c-1?origin=demo', '/settings/ocr', '/contract/company-expense?projectId=p-1', '/contract/other-expense/../construction'])
      expect(validateAuxiliaryReturnTo(value, 'real')).toBeNull()
    expect(validateAuxiliaryReturnTo('/project/p-1?origin=real&tab=contract#contracts', 'real')).not.toBeNull()
    expect(validateAuxiliaryReturnTo('/base/supplier/s-1?origin=real&tab=contracts', 'real')).not.toBeNull()
  })
  it('项目和分供方的列表来源可以嵌套在真实详情返回链中', () => {
    for (const [detail, list] of [
      ['/project/p-1?origin=real', '/project?search=检测&page=2&pageSize=10&nav=return330#project-row-real.p-1'],
      ['/base/supplier/s-1?origin=real', '/base/supplier?search=检测&page=2&pageSize=10#supplier-row-real%3As-1'],
    ]) {
      const source = `${detail}&returnTo=${encodeURIComponent(list!)}#auxiliary-contract-journey`
      expect(validateAuxiliaryReturnTo(source)).not.toBeNull()
    }
    expect(validateAuxiliaryReturnTo(`/project/p-1?origin=real&returnTo=${encodeURIComponent('/project?returnTo=https://example.com')}`)).toBeNull()
  })
})
