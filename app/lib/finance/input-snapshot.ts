/** Capture the submitted data without turning invalid numeric input into valid NULL. */
export function captureFinanceInput<T>(value: T): T {
  if (Array.isArray(value))
    return value.map(item => captureFinanceInput(item)) as T
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, captureFinanceInput(item)])) as T
  return value
}
