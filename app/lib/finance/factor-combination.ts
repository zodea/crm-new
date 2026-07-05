// 开票因子组合搜索（纯函数，DFS + 时间/数量上限）。
// 从 app/pages/finance/invoice/factor.vue 抽出，便于单测；时钟可注入（对齐 lib/kit/confirm 范式）。

export interface Factor {
  id: number
  name: string
  unit: string
  unitPrice: number
  upperLimit: number
}

export interface CombinationItem {
  factor: Factor
  qty: number
  subtotal: number
}

export interface Combination {
  items: CombinationItem[]
  total: number
  diff: number
}

export interface ComputeCombinationsOptions {
  /** 金额四舍五入小数位，缺省 2 */
  decimalPlaces?: number
  /** DFS 命中上限（防爆栈/超时），缺省 200 */
  maxResults?: number
  /** 时间上限（ms），缺省 2000 */
  timeLimitMs?: number
  /** 排序后保留返回数，缺省 50 */
  keep?: number
  /** 注入时钟便于测试，缺省 performance.now */
  now?: () => number
}

export interface CombinationResult {
  /** 按 diff 升序、截取 keep 条后的方案 */
  combinations: Combination[]
  /** 计算耗时（ms） */
  elapsedMs: number
  /** DFS 找到的总方案数（截断前），0 表示无匹配 */
  found: number
}

/**
 * 在给定因子（含单价与数量上限）里 DFS 搜索总额接近 target 的组合。
 * 剪枝：任一分支总额超过 target 的 101% 即停；命中数或耗时到上限即返回。
 */
export function computeCombinations(
  factors: Factor[],
  target: number,
  options: ComputeCombinationsOptions = {},
): CombinationResult {
  const {
    decimalPlaces = 2,
    maxResults = 200,
    timeLimitMs = 2000,
    keep = 50,
    now = () => performance.now(),
  } = options

  const start = now()
  const results: Combination[] = []
  const round = (n: number) => +n.toFixed(decimalPlaces)

  function dfs(idx: number, items: CombinationItem[], currentTotal: number) {
    if (now() - start > timeLimitMs) return
    if (results.length >= maxResults) return

    if (idx === factors.length) {
      if (currentTotal > 0) {
        results.push({
          items: [...items],
          total: currentTotal,
          diff: Math.abs(currentTotal - target),
        })
      }
      return
    }

    const f = factors[idx]
    for (let qty = 0; qty <= f.upperLimit; qty++) {
      const subtotal = round(qty * f.unitPrice)
      const newTotal = round(currentTotal + subtotal)
      if (newTotal > target * 1.01) break

      if (qty > 0) items.push({ factor: f, qty, subtotal })
      dfs(idx + 1, items, newTotal)
      if (qty > 0) items.pop()
    }
  }

  dfs(0, [], 0)
  results.sort((a, b) => a.diff - b.diff)

  return {
    combinations: results.slice(0, keep),
    elapsedMs: Math.round(now() - start),
    found: results.length,
  }
}
