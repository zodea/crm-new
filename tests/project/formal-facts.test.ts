import { describe, expect, it } from 'vitest'
import {
  isDraftStatus,
} from '~/lib/project/formal-facts'

describe('project formal fact boundaries', () => {
  it.each([
    { case: '\'draft\'', input: 'draft', expected: true },
    { case: '\'草稿\'', input: '草稿', expected: true },
    { case: '\'approved\'', input: 'approved', expected: false },
  ])('keeps visible drafts out of formal amount summaries / isDraftStatus：$case', ({ input, expected }) => {
    expect(isDraftStatus(input)).toBe(expected)
  })
})
