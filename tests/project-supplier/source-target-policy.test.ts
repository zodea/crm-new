import { describe, expect, it } from 'vitest'
import { isVerifiedProjectSupplierSourceTarget } from '~/lib/project-supplier/source-target-policy'

describe('项目分供方源单目标策略', () => {
  it.each([
    ['demo', 'contract', 'detail', true],
    ['demo', 'payment-application', 'detail', false],
    ['real', 'contract', 'detail', false],
    ['demo', 'invoice', 'detail', false],
    ['demo', 'payment-record', 'detail', false],
    ['demo', 'settlement', 'material-settlement', false],
  ] as const)('%s/%s/%s => %s', (dataOrigin, entity, variant, expected) => {
    expect(isVerifiedProjectSupplierSourceTarget({ dataOrigin, entity, variant })).toBe(expected)
  })
})
