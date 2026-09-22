import { expect, it } from 'vitest'
import { calendarDays } from '~/lib/schedule/planning'

it('拒绝不存在的月日，不能将日期溢出静默滚到下月', () => {
  expect(() => calendarDays('2026-02-30', '2026-03-03')).toThrow()
})
