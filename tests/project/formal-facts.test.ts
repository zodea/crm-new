import { describe, expect, it } from 'vitest'
import {
  effectiveAmount,
  effectiveChildAmount,
  isDraftStatus,
  isFormalOwnerChange,
} from '~/lib/project/formal-facts'

describe('project formal fact boundaries', () => {
  it('keeps visible drafts out of formal amount summaries', () => {
    expect(isDraftStatus('draft')).toBe(true)
    expect(isDraftStatus('草稿')).toBe(true)
    expect(isDraftStatus('approved')).toBe(false)
    expect(effectiveAmount(120, 'draft')).toBe(0)
    expect(effectiveAmount(120, 'approved')).toBe(120)
    expect(effectiveChildAmount(120, '有效', 'draft')).toBe(0)
    expect(effectiveChildAmount(120, '有效', '履约中')).toBe(120)
  })

  it('only treats approved or locked owner changes as adjudicated facts', () => {
    expect(isFormalOwnerChange({ status: 'submitted' })).toBe(false)
    expect(isFormalOwnerChange({ status: 'approved' })).toBe(true)
    expect(isFormalOwnerChange({ status: 'draft', approvalDate: '2026-07-27' })).toBe(true)
    expect(isFormalOwnerChange({ status: 'submitted', sourceLocked: 1 })).toBe(true)
  })
})
