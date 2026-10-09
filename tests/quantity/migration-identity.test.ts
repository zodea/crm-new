import { expect, it } from 'vitest'
import { quantityHollowPath, quantityHollowQuery } from '../../app/lib/quantity/hollow-navigation'
import { isQuantitySourceIdentity } from '../../app/lib/quantity/migration-identity'

it('同一严格身份入口保旧开发映射并接受完整SHA正式映射，错表/坏编码/空身份拒绝', () => {
  const identity = `qty-${'a'.repeat(64)}-${encodeURIComponent('原项目:一')}:units:${encodeURIComponent('原户:101')}`
  expect(isQuantitySourceIdentity(identity, 'units')).toBe(true)
  expect(isQuantitySourceIdentity(identity, 'rooms')).toBe(false)
  expect(isQuantitySourceIdentity(`core-quantity_projects-${'b'.repeat(24)}:units:legacy-unit`, 'units')).toBe(true)
  expect(isQuantitySourceIdentity('ordinary-unit', 'units')).toBe(true)
  for (const invalid of [`qty-${'a'.repeat(63)}-project:units:legacy`, `qty-${'a'.repeat(64)}-project:units:%zz`, `qty-${'a'.repeat(64)}-%20:units:legacy`, `qty-${'a'.repeat(64)}-project:units:%6cegacy`, `qty-${'a'.repeat(64)}-project:units:legacy:extra`]) expect(isQuantitySourceIdentity(invalid, 'units')).toBe(false)
  expect(quantityHollowQuery('formal-project', identity, 'real')).toEqual({ projectId: 'formal-project', unitId: identity, origin: 'real', includeDemo: false })
  expect(quantityHollowPath({ projectId: 'formal-project', unitId: identity, origin: 'real' }, 'unit')).toBe(`/subcontract/quantity/formal-project/${encodeURIComponent(identity)}`)
})
