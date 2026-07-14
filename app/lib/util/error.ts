/** 统一异常→用户可读文案：Error 取 message，其余 String 化。 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
