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
  })

  it.each([
    { case: '\'/project/project-1/supplier/supplier-1?tab=unknown\'', input: '/project/project-1/supplier/supplier-1?tab=unknown' },
    { case: '\'/project/project-1/supplier/supplier-1?tab=payment&redirect=https://evil.example\'', input: '/project/project-1/supplier/supplier-1?tab=payment&redirect=https://evil.example' },
    { case: '\'//evil.example/project/project-1/supplier/supplier-1?tab=payment\'', input: '//evil.example/project/project-1/supplier/supplier-1?tab=payment' },
  ])('只接受登记工作台、双父 ID、来源和六个页签 / validateProjectSupplierReturnTo：$case', ({ input }) => {
    expect(validateProjectSupplierReturnTo(input)).toBeNull()
  })

  it.each([
    { case: '\'/contract/contract-1\' / returnTo', input: '/contract/contract-1', argument2: returnTo, expected: `/contract/contract-1?projectId=project%2F1&supplierId=supplier%2F1&origin=demo&returnTo=${encodeURIComponent(returnTo)}` },
    { case: '\'/finance/invoice/invoice-1?mode=readonly\' / returnTo', input: '/finance/invoice/invoice-1?mode=readonly', argument2: returnTo, expected: `/finance/invoice/invoice-1?mode=readonly&projectId=project%2F1&supplierId=supplier%2F1&origin=demo&returnTo=${encodeURIComponent(returnTo)}` },
    { case: '\'/contract/contract-1\' / \'https://evil.example\'', input: '/contract/contract-1', argument2: 'https://evil.example', expected: '/contract/contract-1' },
  ])('给已登记来源目标附加双父 ID 与编码后的 returnTo / appendProjectSupplierReturnContext：$case', ({ input, argument2, expected }) => {
    expect(appendProjectSupplierReturnContext(input, argument2)).toBe(expected)
  })

  it('目标页只在 query、returnTo 与真实源单关系三方一致时恢复原页签', () => {
    expect(resolveProjectSupplierReturnContext({
      returnTo,
      projectId: 'project/1',
      supplierId: 'supplier/1',
      actualProjectId: 'project/1',
      actualSupplierId: 'supplier/1',
    })).toMatchObject({ to: returnTo, tab: 'payment' })
  })

  it.each([
    { case: '{ returnTo, projectId: \'project/1\', supplierId: \'supplier/1\', actualProjectId: \'project/other\', actualSupplierId: \'supplier/1', input: {
      returnTo,
      projectId: 'project/1',
      supplierId: 'supplier/1',
      actualProjectId: 'project/other',
      actualSupplierId: 'supplier/1',
    } },
    { case: '{ returnTo, projectId: \'project/1\', supplierId: \'supplier/other\', actualProjectId: \'project/1\', actualSupplierId: \'supplier/1', input: {
      returnTo,
      projectId: 'project/1',
      supplierId: 'supplier/other',
      actualProjectId: 'project/1',
      actualSupplierId: 'supplier/1',
    } },
  ])('目标页只在 query、returnTo 与真实源单关系三方一致时恢复原页签 / resolveProjectSupplierReturnContext：$case', ({ input }) => {
    expect(resolveProjectSupplierReturnContext(input)).toBeNull()
  })

  it.each([
    { case: 'returnTo / { entity: \'project\', id: \'project/1\', origin: \'demo\', }', input: returnTo, argument2: {
      entity: 'project',
      id: 'project/1',
      origin: 'demo',
    }, expected: returnTo },
    { case: 'returnTo / { entity: \'supplier\', id: \'supplier/1\', origin: \'demo\', }', input: returnTo, argument2: {
      entity: 'supplier',
      id: 'supplier/1',
      origin: 'demo',
    }, expected: returnTo },
  ])('身份目标只恢复与双父 ID、来源一致的工作台 / validateProjectSupplierIdentityReturnTo：$case', ({ input, argument2, expected }) => {
    expect(validateProjectSupplierIdentityReturnTo(input, argument2)).toBe(expected)
  })

  it.each([
    { case: 'returnTo / { entity: \'project\', id: \'project/other\', origin: \'demo\', }', input: returnTo, argument2: {
      entity: 'project',
      id: 'project/other',
      origin: 'demo',
    } },
    { case: 'returnTo / { entity: \'supplier\', id: \'supplier/1\', origin: \'real\', }', input: returnTo, argument2: {
      entity: 'supplier',
      id: 'supplier/1',
      origin: 'real',
    } },
  ])('身份目标只恢复与双父 ID、来源一致的工作台 / validateProjectSupplierIdentityReturnTo：$case', ({ input, argument2 }) => {
    expect(validateProjectSupplierIdentityReturnTo(input, argument2)).toBeNull()
  })
})
