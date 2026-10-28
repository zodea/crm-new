import { expect, it } from 'vitest'
import { payrollNeedsRecheckMessage } from '~/lib/payroll/release-recheck-message'

it.each([
  { label: '随后已发放', current: { status: 'released', needsRecheck: false }, tail: '当前记录随后已发放，本页保持只读。' },
  { label: '仍需重核', current: { status: 'checked', needsRecheck: true }, tail: '当前记录仍需重核，请先重新核对。' },
  { label: '随后已在其他窗口重核', current: { status: 'checked', needsRecheck: false }, tail: '当前记录随后已重新核对，请核对当前状态后再决定发放。' },
  { label: '随后退回草稿等其他更新', current: { status: 'draft', needsRecheck: false }, tail: '当前记录随后已有更新，请核对当前状态后再继续。' },
])('原发放提交需重核、当前记录$label 时分别说明', ({ current, tail }) => {
  expect(payrollNeedsRecheckMessage('考勤或个人标准', current)).toBe(`原发放提交因考勤或个人标准变化未执行，原实发输入仍保留。${tail}`)
})
