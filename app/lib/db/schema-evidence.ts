export function assertIdentifier(name: string): void {
  if (!/^[A-Z_]\w*$/i.test(name)) {
    throw new Error(`[db] 非法标识符: ${name}`)
  }
}

/** Preserve quoted values: changing 'confirmed' to 'CONFIRMED' changes a guard's meaning. */
export function normalizeSqlDefinition(sql: string): string {
  return sql.replace(/;$/, '')
    .split(/('(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\])/g)
    .map((part, index) => index % 2
      ? part
      : part.replace(/\bIF NOT EXISTS\s+/gi, '').replace(/\s+/g, ' ').toLowerCase())
    .join('')
    .trim()
}
