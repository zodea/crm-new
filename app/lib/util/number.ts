// 数值字段归一：空串 / NaN / nullish → null（避免 v-model.number 清空后把 '' 写进数值列）。
// 各 store 的写路径共用同一实现，避免像 registered_capital 归一逻辑那样多处各抄一份而漂移。

export function toNum(v: unknown): number | null {
  if (v === '' || v == null)
    return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}
