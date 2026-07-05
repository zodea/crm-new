// KitUI confirm —— 三档确认弹窗（simple/batch/cascade）的类型与纯逻辑。
// 决策见 ADR 0003 + 组件规格 §01。纯逻辑抽到此处，便于 node 环境 vitest
// 直接断言（不依赖 DOM）：打字名称匹配门控 + 级联「预提交挂起」状态机（注入时钟）。

export type ConfirmVariant = 'simple' | 'batch' | 'cascade'

/** cascade 杀伤清单的一项：如 { label: '合同', n: 3 } → 「将影响 3 份合同」 */
export interface ConfirmImpact {
  label: string
  n: number
}

/** 级联预提交挂起最短时长：永不少于 3 秒（ADR 0003）。 */
export const MIN_HOLD_MS = 3000

/**
 * type-to-confirm 门控：输入需与目标记录名精确匹配（两端 trim 后相等）。
 * 空目标不放行（防止空输入误激活）。
 */
export function matchesConfirmName(input: string, target: string): boolean {
  const t = target.trim()
  return t !== '' && input.trim() === t
}

/**
 * 确认按钮是否可点：无打字要求（simple/batch）恒真；
 * 有打字要求（cascade）则需名称精确匹配。
 */
export function isConfirmEnabled(requireTyping: string | null | undefined, input: string): boolean {
  if (!requireTyping) return true
  return matchesConfirmName(input, requireTyping)
}

/**
 * 有效挂起时长：永不少于 3 秒；显式传入更长则取显式值。
 * 「关联多则更久」由调用方按杀伤规模自行传更大的 holdMs（不在此写死曲线）。
 */
export function resolveHoldMs(explicit?: number): number {
  return Math.max(MIN_HOLD_MS, explicit ?? MIN_HOLD_MS)
}

// ── 预提交挂起状态机（注入时钟便于测）──
// idle → beginHold → pending → (cancelHold → cancelled) | (tickHold 到时 → committed)
// pending 期间「尚未写库」，UI 显示 spinner + 显眼「撤销」；committed 才真正提交。

export type HoldPhase = 'idle' | 'pending' | 'committed' | 'cancelled'

export interface HoldState {
  phase: HoldPhase
  /** 挂起开始时刻（ms，由调用方注入的 now） */
  startedAt: number | null
  /** 有效挂起时长（ms） */
  holdMs: number
}

/** 新建一个挂起状态机（idle 态，时长已按 resolveHoldMs 归一）。 */
export function createHold(holdMs?: number): HoldState {
  return { phase: 'idle', startedAt: null, holdMs: resolveHoldMs(holdMs) }
}

/** idle → pending：记录起始时刻。非 idle 幂等返回原态。 */
export function beginHold(state: HoldState, now: number): HoldState {
  if (state.phase !== 'idle') return state
  return { ...state, phase: 'pending', startedAt: now }
}

/** pending → cancelled（撤销，彻底中止，不提交）。非 pending 幂等。 */
export function cancelHold(state: HoldState): HoldState {
  if (state.phase !== 'pending') return state
  return { ...state, phase: 'cancelled' }
}

/** 到时推进：pending 且 now-startedAt ≥ holdMs → committed，否则原样返回。 */
export function tickHold(state: HoldState, now: number): HoldState {
  if (state.phase !== 'pending' || state.startedAt == null) return state
  if (now - state.startedAt >= state.holdMs) return { ...state, phase: 'committed' }
  return state
}

/** 剩余毫秒（用于倒计时显示）；非 pending 返回 0。 */
export function holdRemaining(state: HoldState, now: number): number {
  if (state.phase !== 'pending' || state.startedAt == null) return 0
  return Math.max(0, state.holdMs - (now - state.startedAt))
}
