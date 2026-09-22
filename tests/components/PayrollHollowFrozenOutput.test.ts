import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import PayrollHollowFrozenSection from '~/components/payroll/PayrollHollowFrozenSection.vue'
import { createPayrollAWorkbook } from '~/lib/payroll/a-export'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

it('真实发放后打印与xlsx保存1000/450/550及原19减4，后来全整改不回填', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const initial = await f.form()
    const saved = await f.service.execute(f.command(initial, { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand(read.hollow!))
    read = await f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(read, { kind: 'check-a' }))
    read = await f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(read, { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const output = await f.service.aOutput({ origin: 'real' }, statementId)
    if (output.state !== 'available' || !output.document.hollow)
      throw new Error('真实发放原件不可用')
    const document = output.document
    const workbook = XLSX.read(createPayrollAWorkbook(document).data, { type: 'array' })
    const summary = XLSX.utils.sheet_to_json(workbook.Sheets.空鼓扣款汇总!)
    const sources = XLSX.utils.sheet_to_json(workbook.Sheets.空鼓采用来源!)
    expect(summary).toEqual([expect.objectContaining({ 本次请款合计: 1000, 本单空鼓扣款: 450, 扣款后核算应发: 550 })])
    expect(sources).toEqual([expect.objectContaining({ 原记录身份: f.recordId, 检查总处数: 19, 已整改处数: 4, 当时未整改处数: 15, 本单采用: '已采用', 本单采用处数: 15, 采用单处金额: 30, 本单扣款金额: 450 })])
    const wrapper = mount(PayrollHollowFrozenSection, { props: { snapshot: document.hollow } })
    expect(wrapper.text()).toContain('19 / 4 / 15 处')
    expect(wrapper.text()).toContain('本次请款合计 ¥1,000.00')
    expect(wrapper.text()).toContain('扣款后核算应发 ¥550.00')
    wrapper.unmount()
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 15, note: '后来已全部修复' }))
    const later = await f.reloadPayroll().aOutput({ origin: 'real' }, statementId)
    if (later.state !== 'available')
      throw new Error('后来读取原件不可用')
    const after = XLSX.read(createPayrollAWorkbook(later.document).data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(after.Sheets.空鼓采用来源!)).toEqual(sources)
    expect(XLSX.utils.sheet_to_json(after.Sheets.空鼓扣款汇总!)).toEqual(summary)
  }
  finally { await f.close() }
}, 30_000)
