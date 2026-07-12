// JSON 文本列的共享安全解析:脏数据一律回退缺省值、不抛。
// 覆盖两类脏数据——语法非法('not-json')与「合法 JSON 但类型错」('null'/'0'/'"x"'):
// 后者裸 JSON.parse 会成功放行,items=null 之类的值进内存后模板 .length 直接崩,必须按
// fallback 的形状做类型守卫。invoices.items/field_confidence 与 suppliers.aliases 共用。
export function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse((raw as string) || '')
    if (Array.isArray(fallback))
      return (Array.isArray(parsed) ? parsed : fallback) as T
    if (typeof fallback === 'object' && fallback !== null)
      return (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : fallback) as T
    return typeof parsed === typeof fallback ? parsed as T : fallback
  }
  catch {
    return fallback
  }
}
