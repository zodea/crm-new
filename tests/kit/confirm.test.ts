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
  it.each([
    { case: '\'华东建材\' / \'华东建材\'', input: '华东建材', argument2: '华东建材', expected: true },
    { case: '\' 华东建材 \' / \'华东建材\'', input: '  华东建材 ', argument2: '华东建材', expected: true },
  ])('两端 trim 后精确相等 → true / matchesConfirmName：$case', ({ input, argument2, expected }) => {
    expect(matchesConfirmName(input, argument2)).toBe(expected)
  })

  it.each([
    { case: '\'华东\' / \'华东建材\'', input: '华东', argument2: '华东建材', expected: false },
    { case: '\'华东建材公司\' / \'华东建材\'', input: '华东建材公司', argument2: '华东建材', expected: false },
  ])('不一致 → false / matchesConfirmName：$case', ({ input, argument2, expected }) => {
    expect(matchesConfirmName(input, argument2)).toBe(expected)
  })

  it.each([
    { case: '\'\' / \'\'', input: '', argument2: '', expected: false },
    { case: '\' \' / \' \'', input: '   ', argument2: '  ', expected: false },
  ])('空目标不放行（防空输入误激活） / matchesConfirmName：$case', ({ input, argument2, expected }) => {
    expect(matchesConfirmName(input, argument2)).toBe(expected)
  })
})

describe('确认按钮门控：isConfirmEnabled', () => {
  it.each([
    { case: 'undefined / \'\'', input: undefined, argument2: '', expected: true },
    { case: 'null / \'whatever\'', input: null, argument2: 'whatever', expected: true },
    { case: '\'\' / \'\'', input: '', argument2: '', expected: true },
  ])('无打字要求（simple/batch）恒可确认 / isConfirmEnabled：$case', ({ input, argument2, expected }) => {
    expect(isConfirmEnabled(input, argument2)).toBe(expected)
  })

  it.each([
    { case: '\'华东建材\' / \'华东\'', input: '华东建材', argument2: '华东', expected: false },
    { case: '\'华东建材\' / \'华东建材\'', input: '华东建材', argument2: '华东建材', expected: true },
  ])('有打字要求（cascade）需名称匹配 / isConfirmEnabled：$case', ({ input, argument2, expected }) => {
    expect(isConfirmEnabled(input, argument2)).toBe(expected)
  })
})

describe('挂起时长：resolveHoldMs', () => {
  it('永不少于 3 秒', () => {
    expect(MIN_HOLD_MS).toBe(3000)
    expect(resolveHoldMs()).toBe(3000)
  })

  it.each([
    { case: '1000', input: 1000, expected: 3000 },
    { case: '0', input: 0, expected: 3000 },
    { case: '2999', input: 2999, expected: 3000 },
    { case: '3000', input: 3000, expected: 3000 },
    { case: '3001', input: 3001, expected: 3001 },
  ])('永不少于 3 秒 / resolveHoldMs：$case', ({ input, expected }) => {
    expect(resolveHoldMs(input)).toBe(expected)
  })

  it('显式更长则取显式值', () => {
    expect(resolveHoldMs(5000)).toBe(5000)
  })
})

describe('预提交挂起状态机（注入时钟）', () => {
  it('createHold → idle，时长已归一到 ≥3 秒', () => {
    expect(createHold()).toEqual({ phase: 'idle', startedAt: null, holdMs: 3000 })
  })

  it.each([
    { case: '6000', input: 6000, expected: 6000 },
    { case: '500', input: 500, expected: 3000 },
  ])('createHold → idle，时长已归一到 ≥3 秒 / createHold：$case', ({ input, expected }) => {
    expect(createHold(input).holdMs).toBe(expected)
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

  describe('tickHold：到时（≥holdMs）→ committed', () => {
    const s = beginHold(createHold(3000), 1000)
    it.each([
      { case: 's / 1000 + 3000', input: s, argument2: 1000 + 3000, expected: 'committed' },
      { case: 's / 1000 + 5000', input: s, argument2: 1000 + 5000, expected: 'committed' },
    ])('tickHold：$case', ({ input, argument2, expected }) => {
      expect(tickHold(structuredClone(input), structuredClone(argument2)).phase).toBe(expected)
    })
  })

  it('cancelHold：pending → cancelled，之后 tick 不再提交', () => {
    const s = cancelHold(beginHold(createHold(3000), 1000))
    expect(s.phase).toBe('cancelled')
    expect(tickHold(s, 1000 + 9999).phase).toBe('cancelled')
  })

  it.each([
    { phase: 'idle', create: () => createHold(3000) },
    { phase: 'committed', create: () => tickHold(beginHold(createHold(3000), 0), 3000) },
  ])('cancelHold 幂等：$phase 不改变原状态引用', ({ phase, create }) => {
    const state = create()
    expect(state.phase).toBe(phase)
    expect(cancelHold(state)).toBe(state)
  })

  describe('holdRemaining：pending 期间递减，非 pending 为 0', () => {
    const s = beginHold(createHold(3000), 1000)
    it.each([
      { case: 's / 1000', input: s, argument2: 1000, expected: 3000 },
      { case: 's / 2500', input: s, argument2: 2500, expected: 1500 },
      { case: 's / 5000', input: s, argument2: 5000, expected: 0 },
      { case: 'createHold(3000) / 1000', input: createHold(3000), argument2: 1000, expected: 0 },
      { case: 'cancelHold(s) / 1000', input: cancelHold(s), argument2: 1000, expected: 0 },
    ])('holdRemaining：$case', ({ input, argument2, expected }) => {
      expect(holdRemaining(structuredClone(input), structuredClone(argument2))).toBe(expected)
    })
  })
})
