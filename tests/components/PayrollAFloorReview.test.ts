import { Buffer } from 'node:buffer'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollAFloorReview from '~/components/payroll/PayrollAFloorReview.vue'
import { payrollUiFact } from '../helpers/payroll-a-ui-fixture'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

it('楼层轴只取本簿截至本月真实完成，格内区分往月、本月和未涉及', () => {
  const first = { ...payrollUiFact('one'), completedAt: '2026-08-12' }
  const sameFloorThisMonth = { ...first, completionId: 'done-new', completedAt: '2026-09-02' }
  const secondItem = { ...payrollUiFact('two'), itemId: 'floor-item', itemName: '地砖', completedAt: '2026-09-10' }
  const future = { ...payrollUiFact('future'), completedAt: '2026-10-01' }
  const wrapper = mount(PayrollAFloorReview, { props: { facts: [first, sameFloorThisMonth, secondItem, future], month: '2026-09', selectedItemId: 'floor-item', returnTo: '/subcontract/payroll/form/wage?origin=real' } })
  expect(wrapper.text()).not.toContain('future层')
  const wall = wrapper.get('[data-floor-item="item"]')
  expect(wall.findAll('td')[0]!.text()).toContain('往月已完成')
  expect(wall.findAll('td')[0]!.text()).toContain('本月新增')
  expect(wall.findAll('td')[1]!.text()).toContain('未涉及')
  const floor = wrapper.get('[data-floor-item="floor-item"]')
  expect(floor.attributes('data-selected')).toBe('true')
  expect(floor.findAll('td')[0]!.text()).toContain('未涉及')
  expect(floor.findAll('td')[1]!.text()).toContain('本月新增')
  wrapper.unmount()
})

it('没有已证明完成事实不补全项目楼层，也不把未排查写成零', () => {
  const wrapper = mount(PayrollAFloorReview, { props: { facts: [], month: '2026-09', selectedItemId: '', returnTo: '/subcontract/payroll/form/wage?origin=real' } })
  expect(wrapper.text()).toContain('尚无已证明的施工楼层')
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('空鼓 0')
  wrapper.unmount()
})

it.each(['完成事实缺失', '完成事实歧义'] as const)('同层同分项第二户空鼓入口返回自己的原完成定位，%s 时撤掉失效定位', async (condition) => {
  const f = await createPayrollHollowFixture()
  let wrapper: ReturnType<typeof mount> | undefined
  try {
    const first = (await f.form()).facts[0]!
    const second = await f.executeQuantity({ kind: 'create-unit', floorId: first.floorId, draft: { code: '102', name: '102室', templateId: first.templateId } })
    await f.executeQuantity({ kind: 'save-assignments', draft: { projectId: f.scope.projectId, trade: '泥水工', assigneeKind: 'worker', assigneeId: f.people[0]!.id, unitIds: [second.id], expectedAssignments: [{ unitId: second.id, assignmentId: null, fingerprint: null }], scopes: [{ unitId: second.id, roomId: first.roomId, itemId: first.itemId }], note: '', allowReplacement: false } })
    const scope = { ...f.scope, unitId: second.id }
    const completion = (await f.quantity.completion(scope, f.session())).data.stages.find(stage => stage.id === first.stageId)!
    const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA9sAAAAASUVORK5CYII='
    await f.executeQuantity({ kind: 'save-completion', draft: { projectId: f.scope.projectId, unitId: second.id, stageId: first.stageId, status: 'completed', completedAt: '2026-08-03', note: '第二户真实完成', expectedCompletionId: completion.completion?.id ?? null, expectedCompletionFingerprint: completion.completion?.fingerprint ?? null, expectedAssignmentId: completion.currentAssignment?.id ?? null, photos: [{ fileName: '完成.png', mimeType: 'image/png', fileSize: Buffer.from(contentBase64, 'base64').length, contentBase64 }] } })
    const before = await f.quantityService.hollow(scope)
    await f.quantityService.executeHollow(f.hollowCommand(before, { kind: 'create-hollow-inspection', target: before.data.targets[0]!.target, input: { inspectedOn: '2026-08-04', count: 2, note: '第二户真实检查' } }))
    const read = await f.form()
    const secondFact = read.facts.find(fact => fact.unitId === second.id)!
    expect(read.hollow!.rows).toHaveLength(2)
    wrapper = mount(PayrollAFloorReview, { props: { facts: read.facts, month: f.draft.month, selectedItemId: first.itemId, hollow: read.hollow, returnTo: '/subcontract/payroll/new?origin=real&draftKey=review-second-unit' }, global: { components: { NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } } })
    const link = wrapper.findAll('a').find(link => link.text().includes('102室'))!
    const target = new URL(link.attributes('href'), 'https://test.invalid')
    expect(decodeURIComponent(target.pathname)).toContain(`/${second.id}/hollow/`)
    const back = new URL(target.searchParams.get('payrollReturnTo')!, 'https://test.invalid')
    expect(back.searchParams.get('focus')).toBe(secondFact.completionId)
    const facts = condition === '完成事实缺失'
      ? read.facts.filter(fact => fact.unitId !== second.id)
      : [...read.facts, { ...secondFact, completionId: 'conflicting-completion' }]
    await wrapper.setProps({ facts, returnTo: '/subcontract/payroll/new?origin=real&draftKey=review-second-unit&focus=previous-completion' })
    const candidate = wrapper.findAll('a').find(link => link.text().includes('102室'))!
    const next = new URL(candidate.attributes('href'), 'https://test.invalid')
    expect(decodeURIComponent(next.pathname)).toContain(`/${second.id}/hollow/`)
    expect(new URL(next.searchParams.get('payrollReturnTo')!, 'https://test.invalid').searchParams.get('focus')).toBeNull()
  }
  finally {
    wrapper?.unmount()
    await f.close()
  }
}, 30_000)
