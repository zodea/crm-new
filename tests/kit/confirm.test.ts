import { describe, expect, it } from 'vitest'
import {
  beginHold,
  cancelHold,
  createHold,
  holdRemaining,
  isConfirmEnabled,
  matchesConfirmName,
  MIN_HOLD_MS,
  resolveHoldMs,
  tickHold,
} from '~/lib/kit/confirm'

describe('cascade 打字确认门控：matchesConfirmName', () => {
  it('两端 trim 后精确相等 → true', () => {
    expect(matchesConfirmName('华东建材', '华东建材')).toBe(true)
    expect(matchesConfirmName('  华东建材 ', '华东建材')).toBe(true)
  })

  it('不一致 → false', () => {
    expect(matchesConfirmName('华东', '华东建材')).toBe(false)
    expect(matchesConfirmName('华东建材公司', '华东建材')).toBe(false)
  })

  it('空目标不放行（防空输入误激活）', () => {
    expect(matchesConfirmName('', '')).toBe(false)
    expect(matchesConfirmName('   ', '  ')).toBe(false)
  })
})

describe('确认按钮门控：isConfirmEnabled', () => {
  it('无打字要求（simple/batch）恒可确认', () => {
    expect(isConfirmEnabled(undefined, '')).toBe(true)
    expect(isConfirmEnabled(null, 'whatever')).toBe(true)
    expect(isConfirmEnabled('', '')).toBe(true)
  })

  it('有打字要求（cascade）需名称匹配', () => {
    expect(isConfirmEnabled('华东建材', '华东')).toBe(false)
    expect(isConfirmEnabled('华东建材', '华东建材')).toBe(true)
  })
})

describe('挂起时长：resolveHoldMs', () => {
  it('永不少于 3 秒', () => {
    expect(resolveHoldMs()).toBe(MIN_HOLD_MS)
    expect(resolveHoldMs(1000)).toBe(MIN_HOLD_MS)
    expect(resolveHoldMs(0)).toBe(MIN_HOLD_MS)
  })

  it('显式更长则取显式值', () => {
    expect(resolveHoldMs(5000)).toBe(5000)
  })
})

describe('预提交挂起状态机（注入时钟）', () => {
  it('createHold → idle，时长已归一到 ≥3 秒', () => {
    expect(createHold()).toEqual({ phase: 'idle', startedAt: null, holdMs: 3000 })
    expect(createHold(6000).holdMs).toBe(6000)
    expect(createHold(500).holdMs).toBe(3000)
  })

  it('beginHold：idle → pending，记录起始时刻', () => {
    const s = beginHold(createHold(3000), 1000)
    expect(s.phase).toBe('pending')
    expect(s.startedAt).toBe(1000)
  })

  it('beginHold 幂等：非 idle 不改变', () => {
    const pending = beginHold(createHold(3000), 1000)
    expect(beginHold(pending, 9999)).toBe(pending)
  })

  it('tickHold：未到时仍 pending', () => {
    const s = beginHold(createHold(3000), 1000)
    expect(tickHold(s, 1000 + 2999).phase).toBe('pending')
  })

  it('tickHold：到时（≥holdMs）→ committed', () => {
    const s = beginHold(createHold(3000), 1000)
    expect(tickHold(s, 1000 + 3000).phase).toBe('committed')
    expect(tickHold(s, 1000 + 5000).phase).toBe('committed')
  })

  it('cancelHold：pending → cancelled，之后 tick 不再提交', () => {
    const s = cancelHold(beginHold(createHold(3000), 1000))
    expect(s.phase).toBe('cancelled')
    expect(tickHold(s, 1000 + 9999).phase).toBe('cancelled')
  })

  it('cancelHold 幂等：非 pending 不改变', () => {
    const idle = createHold(3000)
    expect(cancelHold(idle)).toBe(idle)
    const committed = tickHold(beginHold(createHold(3000), 0), 3000)
    expect(cancelHold(committed)).toBe(committed)
  })

  it('holdRemaining：pending 期间递减，非 pending 为 0', () => {
    const s = beginHold(createHold(3000), 1000)
    expect(holdRemaining(s, 1000)).toBe(3000)
    expect(holdRemaining(s, 2500)).toBe(1500)
    expect(holdRemaining(s, 5000)).toBe(0) // 已过时钳到 0
    expect(holdRemaining(createHold(3000), 1000)).toBe(0) // idle
    expect(holdRemaining(cancelHold(s), 1000)).toBe(0) // cancelled
  })
})
