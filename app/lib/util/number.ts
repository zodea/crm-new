// 数值字段归一：空串 / NaN / nullish → null（避免 v-model.number 清空后把 '' 写进数值列）。
// 各 store 的写路径共用同一实现，避免像 registered_capital 归一逻辑那样多处各抄一份而漂移。

export function toNum(v: unknown): number | null {
  if (v === '' || v == null)
    return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * 金额两位小数舍入——「amount + tax = total 两位小数铁律」的统一舍入实现。
 * 此前 recognize.ts / contract/status.ts / 校对表单各内联一份 Math.round(n*100)/100,
 * 舍入口径一旦某处单改必与铁律漂移,统一收敛到这里。
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Complete monetary inputs sum to a value; missing or invalid facts remain unknown. */
export function sumKnownMoney(values: readonly (number | null)[]): number | null {
  if (values.some(value => value === null || !Number.isFinite(value)))
    return null
  return round2(values.reduce<number>((sum, value) => sum + value!, 0))
}

export function subtractKnownMoney(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : sumKnownMoney([left, -right])
}
