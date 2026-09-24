import { describe, expect, it } from 'vitest'
import { createQuantityHollowFixture } from '../helpers/quantity-hollow-fixture'

describe('户级空鼓公开来源服务', () => {
  it('原户记录19处再整改4处，重建服务冷读仍保原责任与余15处', async () => {
    const f = await createQuantityHollowFixture()
    try {
      const initial = await f.service.hollow(f.scope)
      expect(initial.data.records).toEqual([])
      expect(initial.data.targets).toHaveLength(1)
      const created = await f.service.executeHollow(f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 19, note: '厨房墙砖检查' } }))
      const checked = await f.reload().hollow(f.scope)
      expect(checked.data.records).toEqual([expect.objectContaining({ recordId: created.hollow.recordId, originalParty: { kind: 'worker', workerId: 'hollow-worker' }, remainingCount: 19, rectifiedCount: 0 })])
      const rectified = await f.service.executeHollow(f.command(checked, { kind: 'rectify-hollow-inspection', recordId: created.hollow.recordId, expectedRevisionId: created.hollow.revisionId, rectifiedOn: '2026-09-15', count: 4, note: '已复核4处修复' }))
      const current = await f.reload().hollow(f.scope)
      expect(current.data.records).toEqual([expect.objectContaining({ recordId: created.hollow.recordId, remainingCount: 15, rectifiedCount: 4, inspection: expect.objectContaining({ input: expect.objectContaining({ count: 19 }) }), rectifications: [expect.objectContaining({ id: rectified.hollow.rectificationId, count: 4 })] })])
    }
    finally { await f.close() }
  })
})
