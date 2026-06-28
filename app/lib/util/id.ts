let seq = 0

export function generateId(prefix: string): string {
  const ts = Date.now().toString(36)
  const s = (seq++).toString(36)
  return `${prefix}_${ts}_${s}`
}
