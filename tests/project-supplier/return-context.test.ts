import { describe, expect, it } from 'vitest'
import {
  appendProjectSupplierReturnContext,
  resolveProjectSupplierReturnContext,
  validateProjectSupplierIdentityReturnTo,
  validateProjectSupplierReturnTo,
} from '~/lib/project-supplier/return-context'

describe('项目×分供方受限来源上下文', () => {
  const returnTo = '/project/project%2F1/supplier/supplier%2F1?origin=demo&tab=payment'

  it('只接受登记工作台、双父 ID、来源和六个页签', () => {
    expect(validateProjectSupplierReturnTo(returnTo)).toEqual({
      to: returnTo,
      projectId: 'project/1',
      supplierId: 'supplier/1',
      origin: 'demo',
      tab: 'payment',
    })
    expect(validateProjectSupplierReturnTo('/project/project-1/supplier/supplier-1?tab=overview')).toMatchObject({
      projectId: 'project-1',
      supplierId: 'supplier-1',
      origin: 'real',
      tab: 'overview',
    })
    expect(validateProjectSupplierReturnTo('/project/project-1/supplier/supplier-1?tab=unknown')).toBeNull()
    expect(validateProjectSupplierReturnTo('/project/project-1/supplier/supplier-1?tab=payment&redirect=https://evil.example')).toBeNull()
    expect(validateProjectSupplierReturnTo('//evil.example/project/project-1/supplier/supplier-1?tab=payment')).toBeNull()
  })

  it('给已登记来源目标附加双父 ID 与编码后的 returnTo', () => {
    expect(appendProjectSupplierReturnContext('/contract/contract-1', returnTo)).toBe(
      `/contract/contract-1?projectId=project%2F1&supplierId=supplier%2F1&origin=demo&returnTo=${encodeURIComponent(returnTo)}`,
    )
    expect(appendProjectSupplierReturnContext('/finance/invoice/invoice-1?mode=readonly', returnTo)).toBe(
      `/finance/invoice/invoice-1?mode=readonly&projectId=project%2F1&supplierId=supplier%2F1&origin=demo&returnTo=${encodeURIComponent(returnTo)}`,
    )
    expect(appendProjectSupplierReturnContext('/contract/contract-1', 'https://evil.example')).toBe('/contract/contract-1')
  })

  it('目标页只在 query、returnTo 与真实源单关系三方一致时恢复原页签', () => {
    expect(resolveProjectSupplierReturnContext({
      returnTo,
      projectId: 'project/1',
      supplierId: 'supplier/1',
      actualProjectId: 'project/1',
      actualSupplierId: 'supplier/1',
    })).toMatchObject({ to: returnTo, tab: 'payment' })

    expect(resolveProjectSupplierReturnContext({
      returnTo,
      projectId: 'project/1',
      supplierId: 'supplier/1',
      actualProjectId: 'project/other',
      actualSupplierId: 'supplier/1',
    })).toBeNull()
    expect(resolveProjectSupplierReturnContext({
      returnTo,
      projectId: 'project/1',
      supplierId: 'supplier/other',
      actualProjectId: 'project/1',
      actualSupplierId: 'supplier/1',
    })).toBeNull()
  })

  it('身份目标只恢复与双父 ID、来源一致的工作台', () => {
    expect(validateProjectSupplierIdentityReturnTo(returnTo, {
      entity: 'project',
      id: 'project/1',
      origin: 'demo',
    })).toBe(returnTo)
    expect(validateProjectSupplierIdentityReturnTo(returnTo, {
      entity: 'supplier',
      id: 'supplier/1',
      origin: 'demo',
    })).toBe(returnTo)
    expect(validateProjectSupplierIdentityReturnTo(returnTo, {
      entity: 'project',
      id: 'project/other',
      origin: 'demo',
    })).toBeNull()
    expect(validateProjectSupplierIdentityReturnTo(returnTo, {
      entity: 'supplier',
      id: 'supplier/1',
      origin: 'real',
    })).toBeNull()
  })
})
