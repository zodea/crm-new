import type { PayrollAdjustmentBasisDraft } from '~/lib/payroll/central-adjustment-contract'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PayrollAdjustmentBasisFields from '~/components/payroll/PayrollAdjustmentBasisFields.vue'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

it('真实 V3 原工资保费用编辑与可读原责任价格，不显示内部身份或猜测缺失来源', async () => {
  const f = await createPayrollHollowFixture()
  let wrapper: ReturnType<typeof mount> | undefined
  try {
    const scope = { projectId: f.draft.projectId, crewId: null, leaderWorkerId: f.draft.leaderWorkerId, month: f.draft.month, book: f.draft.book! }
    const config = await f.service.aFeeConfig({ origin: 'real' }, scope)
    await f.service.executeFees({ commandId: 'v3-fee-before-release', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId: scope.projectId, statementId: null, draftKey: null, configScope: scope, book: scope.book, action: { kind: 'save-a-fees', baseVersion: config.baseVersion, fees: [{ feeId: null, baseRevisionId: null, kind: 'subsidy', bookPurpose: 'ordinary', managementBookId: null, name: '原墙面补贴', enabled: true, unitPrice: 1.5, unit: '㎡', effectiveMonth: scope.month, basis: { kind: 'completed-field-quantity', itemIds: [f.target.itemId], scope: { kind: 'project' } }, adoptedDefault: null }], remove: [] } })
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const form = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await form()).hollow!))
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    await f.service.execute(f.command(await form(), { kind: 'release-a', release: { actualAmount: 556, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 556 }] } }))
    const target = { adjustmentId: null, draftKey: 'v3-fee-correction', originalStatementId: statementId }
    const read = await f.service.adjustmentForm({ origin: 'real' }, { target })
    const basis = read.draft.basis!
    if (basis.formatFamily !== 'A')
      throw new Error('应为原 A 格式')
    expect(basis.source).toMatchObject({ schemaVersion: 4, ratioPlan: f.draft.ratioPlan, hollow: expect.any(Object) })
    const originalSource = JSON.stringify(basis.source)
    wrapper = mount(PayrollAdjustmentBasisFields, { props: { basis, original: read.original, disabled: false }, global: { stubs: { SectionHeader: true } } })
    expect(wrapper.find('[aria-label="第1项费用更正单价"]').exists()).toBe(true)
    const ratioInput = wrapper.findAll('input[type="number"]').find(input => input.element.closest('label')?.textContent?.includes('墙砖更正比例'))
    expect(ratioInput).toBeDefined()
    await ratioInput!.setValue('50')
    expect((wrapper.emitted('change')!.at(-1)![0] as typeof basis).ratioPlan?.itemRatios[0]?.ratio).toBe(0.5)
    const rows = wrapper.get('[aria-label="A 原责任量价更正表"]')
    expect(rows.text()).toContain('一栋 / 一层 / 101室')
    expect(rows.text()).toContain('墙砖 · ㎡')
    expect(rows.text()).toContain('基准单价')
    expect(rows.text()).toContain('¥250.00')
    expect(rows.text()).not.toContain(basis.components[0]!.ownershipKey)
    expect(rows.text()).not.toContain(basis.components[0]!.priceRevisionId)
    await wrapper.get('[aria-label="第1项费用更正单价"]').setValue('2')
    const changed = wrapper.emitted('change')!.at(-1)![0] as PayrollAdjustmentBasisDraft
    const preview = await f.service.adjustmentForm({ origin: 'real' }, JSON.parse(JSON.stringify({ target, draft: { ...read.draft, basis: changed, reason: '核对原补贴单价', evidenceNote: '原墙面补贴应按每平方米2元' } })))
    expect(preview.preview.delta.value).toBe(2)
    expect(JSON.stringify(basis.source)).toBe(originalSource)
    await wrapper.setProps({ disabled: true })
    const changes = wrapper.emitted('change')!.length
    await wrapper.get('[aria-label="第1项费用更正单价"]').setValue('3')
    expect(wrapper.get('[aria-label="第1项费用更正单价"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('change')).toHaveLength(changes)
    await wrapper.setProps({ disabled: false })
    await wrapper.setProps({ basis: { ...basis, source: { ...basis.source, facts: [] } } })
    expect(rows.text()).toContain('原责任位置依据缺失')
    expect(wrapper.get('[aria-label="第1项更正现场量"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ basis: { ...basis, source: { ...basis.source, facts: [basis.source.facts[0]!, basis.source.facts[0]!] } } })
    expect(rows.text()).toContain('原责任位置依据不唯一')
    await wrapper.setProps({ basis: { ...basis, source: { ...basis.source, priceRevisions: [] } } })
    expect(rows.text()).toContain('原价格依据缺失')
    expect(wrapper.get('[aria-label="第1项更正单价"]').attributes('disabled')).toBeDefined()
  }
  finally {
    wrapper?.unmount()
    await f.close()
  }
}, 30_000)

it('真实原采用在整页更正只编辑处数和单价，保留原位置、原15处和冻结来源', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const form = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await form()).hollow!))
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    await f.service.execute(f.command(await form(), { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const target = { adjustmentId: null, draftKey: 'hollow-component-correction', originalStatementId: statementId }
    const read = await f.service.adjustmentForm({ origin: 'real' }, { target })
    const basis = read.draft.basis!
    const wrapper = mount(PayrollAdjustmentBasisFields, { props: { basis, original: read.original, disabled: false }, global: { stubs: { SectionHeader: true } } })
    expect(wrapper.find('[aria-label="第1条空鼓更正处数"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="原空鼓采用更正"]').text()).toContain(basis.hollow!.source.facts[0]!.location.locationLabel)
    expect(wrapper.get('[aria-label="原空鼓采用更正"]').text()).toContain('原采用 15 处')
    expect(wrapper.get('[aria-label="原空鼓采用更正"]').text()).toContain('原单处金额 ¥30.00')
    await wrapper.get('[aria-label="第1条空鼓更正处数"]').setValue('10')
    const changed = wrapper.emitted('change')!.at(-1)![0] as PayrollAdjustmentBasisDraft
    expect(changed.hollow).toEqual({ ...basis.hollow, components: [{ ...basis.hollow!.components[0], count: 10 }] })
    expect(basis.hollow!.components[0]!.count).toBe(15)
    const preview = await f.service.adjustmentForm({ origin: 'real' }, JSON.parse(JSON.stringify({ target, draft: { ...read.draft, basis: changed, reason: '核实原处数重复记录', evidenceNote: '原15处中5处重复，经核对本次采用10处' } })))
    expect(preview.preview.delta.value).toBe(150)
    await wrapper.setProps({ basis: changed })
    await wrapper.get('[aria-label="第1条空鼓更正单处金额"]').setValue('')
    expect((wrapper.emitted('change')!.at(-1)![0] as PayrollAdjustmentBasisDraft).hollow!.components[0]!.unitAmount).toBeNull()
    await wrapper.setProps({ disabled: true })
    const count = wrapper.emitted('change')!.length
    await wrapper.get('[aria-label="第1条空鼓更正处数"]').trigger('input')
    expect(wrapper.emitted('change')).toHaveLength(count)
    expect(wrapper.get('[aria-label="第1条空鼓更正处数"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  }
  finally { await f.close() }
}, 30_000)
