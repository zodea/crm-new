import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import QuantityHollowHistory from '~/components/quantity/QuantityHollowHistory.vue'
import QuantityHollowRecordSummary from '~/components/quantity/QuantityHollowRecordSummary.vue'
import { hollowIdentity, hollowInput, hollowRecord, hollowTarget } from '../helpers/quantity-hollow-ui-fixture'

function record() {
  return hollowRecord({ workspaceId: hollowIdentity.workspaceId, actorId: hollowIdentity.actorId, origin: 'real', requiredCapability: 'quantity:write', commandId: 'command', projectId: 'project', baseVersion: 'quantity-v1', action: { kind: 'create-hollow-inspection', target: hollowTarget, input: hollowInput } })
}
it('当前19减4显示15，原检查与整改的日期处数分别可读', () => {
  const value = record()
  value.rectifications = [{ id: 'rectify', revisionId: 'revision', rectifiedOn: '2026-09-02', count: 4, note: '厨房西墙已复验', commandId: 'rectify-command', logId: 'rectify-log', actorId: 'inspector', createdAt: '2026-09-02T12:00:00Z' }]
  value.rectifiedCount = 4
  value.remainingCount = 15
  const summary = mount(QuantityHollowRecordSummary, { props: { record: value } })
  expect(summary.text()).toContain('当前检查19 处')
  expect(summary.text()).toContain('已整改4 处')
  expect(summary.text()).toContain('未整改15 处')
  const history = mount(QuantityHollowHistory, { props: { record: value, revisionId: 'revision' }, global: { stubs: { SectionHeader: true } } })
  expect(history.text()).toContain('原检查 · 2026-09-01 · 发现 19 处')
  expect(history.text()).toContain('2026-09-02 · 本次整改 4 处')
  expect(history.text()).toContain('厨房西墙已复验')
  expect(history.find('[data-hollow-revision="revision"]').attributes('tabindex')).toBe('-1')
})
it('明确检查0与19全部整改到0保持不同文字', () => {
  const zero = record()
  zero.inspection.input = { ...hollowInput, count: 0 }
  zero.remainingCount = 0
  const first = mount(QuantityHollowRecordSummary, { props: { record: zero } })
  expect(first.text()).toContain('已明确检查为零处')
  const repaired = record()
  repaired.rectifiedCount = 19
  repaired.remainingCount = 0
  const second = mount(QuantityHollowRecordSummary, { props: { record: repaired } })
  expect(second.text()).toContain('全部整改')
  expect(second.text()).not.toContain('已明确检查为零处')
})
