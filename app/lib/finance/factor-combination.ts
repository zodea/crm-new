export const FACTOR_SOLVER_MAX_RESULTS = 5_000
export const FACTOR_SOLVER_TIME_LIMIT_MS = 10_000

export interface FactorInput {
  id: number
  /** 因子金额，单位：元。 */
  value: number
  /** 最大可用数量；null 表示不设上限。 */
  maxQuantity: number | null
  /** 是否允许数量使用可精确落到“分”的小数步长。 */
  allowDecimal: boolean
}

export interface FactorSolutionItem {
  factorId: number
  factorValue: number
  /** 实际数量。小数项的步长由因子分值和 100 的最大公约数决定。 */
  quantity: number
  /** 因子 × 数量的精确金额，单位：分。 */
  amount: number
  allowDecimal: boolean
  inputIndex: number
}

export type FactorSolution = FactorSolutionItem[]
export type FactorSolverMode = 'u8' | 'bit' | 'light'

export interface SolveFactorCombinationsOptions {
  maxResults?: number
  includeFactor?: number | null
  excludeFactor?: number | null
  timeLimitMs?: number
  now?: () => number
}

export interface FactorSolverResult {
  solutions: FactorSolution[]
  /** 可完整统计时为精确总数；规模过大或超时时为 null。 */
  totalCount: number | null
  truncated: boolean
  timeUp: boolean
  note: string
  mode?: FactorSolverMode
  elapsedMs: number
}

interface NormalizedFactor {
  id: number
  fen: number
  effectiveFen: number
  divisor: number
  allowDecimal: boolean
  inputIndex: number
  maxCount: number
}

interface SearchFactor extends NormalizedFactor {
  reducedValue: number
  effectiveMaxCount: number
}

type ReachabilityLayer = Uint8Array | Uint32Array

export function yuanToFen(value: number): number | null {
  if (!Number.isFinite(value))
    return null
  return Math.round(value * 100)
}

function gcd(a: number, b: number): number {
  let left = Math.abs(Math.trunc(a))
  let right = Math.abs(Math.trunc(b))
  while (right) {
    const next = left % right
    left = right
    right = next
  }
  return left
}

function normalizeFactors(factors: FactorInput[], excludeFen: number | null): NormalizedFactor[] {
  const byFen = new Map<number, NormalizedFactor>()

  factors.forEach((factor, index) => {
    const fen = yuanToFen(factor.value)
    if (fen == null || fen <= 0 || fen === excludeFen)
      return

    const divisor = factor.allowDecimal ? gcd(fen, 100) : 1
    const maxQuantity = factor.maxQuantity == null || !Number.isFinite(factor.maxQuantity)
      ? Infinity
      : Math.max(0, factor.maxQuantity)
    const maxCount = maxQuantity === Infinity
      ? Infinity
      : Math.floor((factor.allowDecimal ? maxQuantity * divisor : maxQuantity) + 1e-9)
    const previous = byFen.get(fen)

    byFen.set(fen, {
      id: factor.id,
      fen,
      effectiveFen: fen / divisor,
      divisor,
      allowDecimal: factor.allowDecimal,
      inputIndex: previous?.inputIndex ?? index,
      maxCount,
    })
  })

  return [...byFen.values()]
}

/**
 * 精确加法组合求解器。
 *
 * 金额先统一转成“分”，再通过 GCD 缩减、逐层可达性 DP 和 DFS 枚举。
 * 小数数量仅使用能让“因子 × 数量”保持整分的步长，因此不会引入浮点近似解。
 */
export function solveFactorCombinations(
  factors: FactorInput[],
  target: number,
  options: SolveFactorCombinationsOptions = {},
): FactorSolverResult {
  const now = options.now ?? (() => performance.now())
  const startedAt = now()
  const timeLimitMs = options.timeLimitMs ?? FACTOR_SOLVER_TIME_LIMIT_MS
  const deadline = startedAt + timeLimitMs
  const maxResults = Math.min(
    FACTOR_SOLVER_MAX_RESULTS,
    Math.max(1, Math.floor(options.maxResults ?? 100)),
  )

  const baseResult = (): Omit<FactorSolverResult, 'elapsedMs'> => ({
    solutions: [],
    totalCount: 0,
    truncated: false,
    timeUp: false,
    note: '',
  })
  const finish = (result: Omit<FactorSolverResult, 'elapsedMs'>): FactorSolverResult => ({
    ...result,
    elapsedMs: Math.round(now() - startedAt),
  })

  const targetFen = yuanToFen(target)
  if (targetFen == null || targetFen <= 0)
    return finish(baseResult())

  const includeFen = options.includeFactor == null ? null : yuanToFen(options.includeFactor)
  const excludeFen = options.excludeFactor == null ? null : yuanToFen(options.excludeFactor)
  const normalized = normalizeFactors(factors, excludeFen)

  let remainingTarget = targetFen
  let includedFactor: NormalizedFactor | null = null
  if (includeFen != null) {
    includedFactor = normalized.find(factor => factor.fen === includeFen) ?? null
    if (!includedFactor) {
      return finish({
        ...baseResult(),
        note: '“必须包含”的因子不在因子列表中',
      })
    }
    if (includedFactor.maxCount < 1 || remainingTarget < includedFactor.effectiveFen)
      return finish(baseResult())

    remainingTarget -= includedFactor.effectiveFen
    includedFactor.maxCount -= 1
  }

  function toSolutionItem(factor: NormalizedFactor, count: number): FactorSolutionItem {
    return {
      factorId: factor.id,
      factorValue: factor.fen / 100,
      quantity: count / factor.divisor,
      amount: count * factor.effectiveFen,
      allowDecimal: factor.allowDecimal,
      inputIndex: factor.inputIndex,
    }
  }

  if (remainingTarget === 0) {
    return finish({
      ...baseResult(),
      solutions: includedFactor ? [[toSolutionItem(includedFactor, 1)]] : [[]],
      totalCount: 1,
    })
  }
  if (normalized.length === 0)
    return finish(baseResult())

  let commonDivisor = 0
  for (const factor of normalized)
    commonDivisor = gcd(commonDivisor, factor.effectiveFen)

  if (commonDivisor === 0 || remainingTarget % commonDivisor !== 0)
    return finish(baseResult())

  const reducedTarget = remainingTarget / commonDivisor
  const searchFactors: SearchFactor[] = normalized
    .map(factor => ({
      ...factor,
      reducedValue: factor.effectiveFen / commonDivisor,
      effectiveMaxCount: 0,
    }))
    .sort((a, b) => b.reducedValue - a.reducedValue)

  for (const factor of searchFactors) {
    factor.effectiveMaxCount = Math.min(
      factor.maxCount,
      Math.floor(reducedTarget / factor.reducedValue),
    )
  }

  const factorCount = searchFactors.length
  const includedSearchIndex = includedFactor
    ? searchFactors.findIndex(factor => factor.inputIndex === includedFactor.inputIndex)
    : -1

  const suffixMaximum = new Float64Array(factorCount + 1)
  for (let index = factorCount - 1; index >= 0; index--) {
    const factor = searchFactors[index]
    if (factor) {
      suffixMaximum[index] = (suffixMaximum[index + 1] ?? 0)
        + factor.reducedValue * factor.effectiveMaxCount
    }
  }
  if ((suffixMaximum[0] ?? 0) < reducedTarget)
    return finish(baseResult())

  let deadlineHit = false
  const isOverTime = () => {
    if (!deadlineHit && now() > deadline)
      deadlineHit = true
    return deadlineHit
  }

  const cells = (factorCount + 1) * (reducedTarget + 1)
  let mode: FactorSolverMode = cells <= 64e6 ? 'u8' : cells <= 2.4e9 ? 'bit' : 'light'
  const words = (reducedTarget + 32) >>> 5
  const allocateLayer = (): ReachabilityLayer => mode === 'u8'
    ? new Uint8Array(reducedTarget + 1)
    : new Uint32Array(words)

  function fillReachabilityWindow(
    source: ReachabilityLayer,
    value: number,
    width: number,
    destination: ReachabilityLayer,
  ) {
    destination.fill(0)
    if (width < 0)
      return

    if (mode === 'u8') {
      for (let remainder = 0; remainder < value; remainder++) {
        if ((remainder & 16_383) === 0 && isOverTime())
          return
        let lastReachable = -1
        for (let step = 0, sum = remainder; sum <= reducedTarget; step++, sum += value) {
          if ((step & 65_535) === 0 && step > 0 && isOverTime())
            return
          if (source[sum])
            lastReachable = step
          if (lastReachable >= 0 && step - lastReachable <= width)
            destination[sum] = 1
        }
      }
      return
    }

    for (let remainder = 0; remainder < value; remainder++) {
      if ((remainder & 16_383) === 0 && isOverTime())
        return
      let lastReachable = -1
      for (let step = 0, sum = remainder; sum <= reducedTarget; step++, sum += value) {
        if ((step & 65_535) === 0 && step > 0 && isOverTime())
          return
        const word = source[sum >>> 5] ?? 0
        if ((word >>> (sum & 31)) & 1)
          lastReachable = step
        if (lastReachable >= 0 && step - lastReachable <= width) {
          const wordIndex = sum >>> 5
          destination[wordIndex] = (destination[wordIndex] ?? 0) | (1 << (sum & 31))
        }
      }
    }
  }

  let reachabilityLayers: ReachabilityLayer[] | null = null
  if (mode !== 'light') {
    try {
      reachabilityLayers = Array.from({ length: factorCount + 1 }, allocateLayer)
      const terminalLayer = reachabilityLayers[factorCount]
      if (terminalLayer)
        terminalLayer[0] = 1

      for (let index = factorCount - 1; index >= 0; index--) {
        if (isOverTime())
          break
        const source = reachabilityLayers[index + 1]
        const destination = reachabilityLayers[index]
        const factor = searchFactors[index]
        if (source && destination && factor) {
          fillReachabilityWindow(
            source,
            factor.reducedValue,
            factor.effectiveMaxCount,
            destination,
          )
        }
      }
    }
    catch {
      mode = 'light'
      reachabilityLayers = null
    }
  }

  if (deadlineHit) {
    mode = 'light'
    reachabilityLayers = null
  }

  function isReachable(index: number, sum: number): boolean {
    if (mode === 'light')
      return sum <= (suffixMaximum[index] ?? 0)

    const layer = reachabilityLayers?.[index]
    if (!layer)
      return false
    if (mode === 'u8')
      return Boolean(layer[sum])
    return Boolean(((layer[sum >>> 5] ?? 0) >>> (sum & 31)) & 1)
  }

  if (mode !== 'light' && !isReachable(0, reducedTarget))
    return finish({ ...baseResult(), mode })

  let totalCount: number | null = null
  if (reducedTarget <= 8e6 && !deadlineHit) {
    try {
      let previous = new Float64Array(reducedTarget + 1)
      previous[0] = 1
      let complete = true

      for (let index = factorCount - 1; index >= 0 && complete; index--) {
        const factor = searchFactors[index]
        if (!factor)
          continue
        const current = new Float64Array(reducedTarget + 1)
        for (let remainder = 0; remainder < factor.reducedValue && complete; remainder++) {
          if ((remainder & 16_383) === 0 && isOverTime()) {
            complete = false
            break
          }
          let count = 0
          for (let step = 0, sum = remainder; sum <= reducedTarget; step++, sum += factor.reducedValue) {
            count += previous[sum] ?? 0
            const drop = step - factor.effectiveMaxCount - 1
            if (drop >= 0)
              count -= previous[remainder + drop * factor.reducedValue] ?? 0
            current[sum] = count
          }
        }
        previous = current
      }

      if (complete)
        totalCount = Math.round(previous[reducedTarget] ?? 0)
    }
    catch {
      totalCount = null
    }
  }

  if (totalCount === 0)
    return finish({ ...baseResult(), totalCount: 0, mode })

  const enumerationStartedAfterDeadline = deadlineHit
  const solutions: FactorSolution[] = []
  const counts = new Float64Array(factorCount)
  let timeUp = false
  let operations = 0

  function makeSolution(): FactorSolution {
    const solution: FactorSolution = []
    for (let index = 0; index < factorCount; index++) {
      const factor = searchFactors[index]
      if (!factor)
        continue
      let count = counts[index] ?? 0
      if (index === includedSearchIndex)
        count += 1
      if (count > 0)
        solution.push(toSolutionItem(factor, count))
    }
    return solution.sort((a, b) => a.inputIndex - b.inputIndex)
  }

  function enumerate(index: number, remaining: number) {
    operations++
    if ((operations & 1_023) === 0 && isOverTime()) {
      timeUp = true
      return
    }
    if (remaining === 0) {
      solutions.push(makeSolution())
      return
    }
    if (index >= factorCount || solutions.length >= maxResults)
      return

    const factor = searchFactors[index]
    if (!factor)
      return
    const maximumUse = Math.min(
      factor.effectiveMaxCount,
      Math.floor(remaining / factor.reducedValue),
    )

    for (let count = maximumUse; count >= 0; count--) {
      const nextRemaining = remaining - count * factor.reducedValue
      if (!isReachable(index + 1, nextRemaining))
        continue
      counts[index] = count
      enumerate(index + 1, nextRemaining)
      if (solutions.length >= maxResults || timeUp)
        break
    }
    counts[index] = 0
  }

  enumerate(0, reducedTarget)

  return finish({
    solutions,
    totalCount,
    truncated: totalCount == null
      ? solutions.length >= maxResults
      : totalCount > solutions.length,
    timeUp: timeUp || enumerationStartedAfterDeadline,
    note: '',
    mode,
  })
}
