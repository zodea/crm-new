import { describe, expect, it } from 'vitest'
import { FORM_META } from '~/lib/master-data/page'

describe('master data route metadata', () => {
  it('only exposes detail actions for entities with a completed detail route', () => {
    expect(FORM_META.target_cost.detailPath).toBe('/project/target-cost')
    expect(FORM_META.customer.detailPath).toBeUndefined()
    expect(FORM_META.crew.detailPath).toBe('/base/crew')
    expect(FORM_META.worker.detailPath).toBeUndefined()
  })
})
