import { describe, expect, it } from 'vitest'
import { toLocalDateInputValue } from '~/lib/util/local-date'

describe('toLocalDateInputValue', () => {
  it('使用本地日历年月日，不经过 UTC 截断', () => {
    const localMidnight = new Date(2026, 6, 21, 0, 30)

    expect(toLocalDateInputValue(localMidnight)).toBe('2026-07-21')
  })
})
