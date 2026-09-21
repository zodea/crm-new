import { Buffer } from 'node:buffer'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollAFloorReview from '~/components/payroll/PayrollAFloorReview.vue'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

it('同层同分项第二户空鼓入口返回自己的原完成定位', async () => {
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
    for (const facts of [read.facts.filter(fact => fact.unitId !== second.id), [...read.facts, { ...secondFact, completionId: 'conflicting-completion' }]]) {
      await wrapper.setProps({ facts, returnTo: '/subcontract/payroll/new?origin=real&draftKey=review-second-unit&focus=previous-completion' })
      const candidate = wrapper.findAll('a').find(link => link.text().includes('102室'))!
      const next = new URL(candidate.attributes('href'), 'https://test.invalid')
      expect(decodeURIComponent(next.pathname)).toContain(`/${second.id}/hollow/`)
      expect(new URL(next.searchParams.get('payrollReturnTo')!, 'https://test.invalid').searchParams.get('focus')).toBeNull()
    }
  }
  finally {
    wrapper?.unmount()
    await f.close()
  }
}, 30_000)
