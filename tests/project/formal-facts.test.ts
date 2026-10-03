import { describe, expect, it } from 'vitest'
import {
  effectiveAmount,
  effectiveChildAmount,
  isDraftStatus,
  isFormalOwnerChange,
} from '~/lib/project/formal-facts'

describe('project formal fact boundaries', () => {
  it.each([
    { case: '\'draft\'', input: 'draft', expected: true },
    { case: '\'草稿\'', input: '草稿', expected: true },
    { case: '\'approved\'', input: 'approved', expected: false },
  ])('keeps visible drafts out of formal amount summaries / isDraftStatus：$case', ({ input, expected }) => {
    expect(isDraftStatus(input)).toBe(expected)
  })

  it.each([
    { case: '120 / \'draft\'', input: 120, argument2: 'draft', expected: 0 },
    { case: '120 / \'approved\'', input: 120, argument2: 'approved', expected: 120 },
  ])('keeps visible drafts out of formal amount summaries / effectiveAmount：$case', ({ input, argument2, expected }) => {
    expect(effectiveAmount(input, argument2)).toBe(expected)
  })

  it.each([
    { case: '120 / \'有效\' / \'draft\'', input: 120, argument2: '有效', argument3: 'draft', expected: 0 },
    { case: '120 / \'有效\' / \'履约中\'', input: 120, argument2: '有效', argument3: '履约中', expected: 120 },
  ])('keeps visible drafts out of formal amount summaries / effectiveChildAmount：$case', ({ input, argument2, argument3, expected }) => {
    expect(effectiveChildAmount(input, argument2, argument3)).toBe(expected)
  })

  it.each([
    { case: '{ status: \'submitted\' }', input: { status: 'submitted' }, expected: false },
    { case: '{ status: \'approved\' }', input: { status: 'approved' }, expected: true },
    { case: '{ status: \'draft\', approvalDate: \'2026-07-27\' }', input: { status: 'draft', approvalDate: '2026-07-27' }, expected: true },
    { case: '{ status: \'submitted\', sourceLocked: 1 }', input: { status: 'submitted', sourceLocked: 1 }, expected: true },
  ])('only treats approved or locked owner changes as adjudicated facts / isFormalOwnerChange：$case', ({ input, expected }) => {
    expect(isFormalOwnerChange(input)).toBe(expected)
  })
})
