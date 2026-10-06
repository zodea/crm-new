/** Invalid or cleared input is unknown; only an actual typed zero is zero. */
export function financeInputNumber(event: Event): number {
  const input = event.target as HTMLInputElement
  return input.validity.badInput || input.value.trim() === '' ? Number.NaN : Number(input.value)
}
export function financeDraftMoney(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '待填写有效金额'
}
export function financeInputTextNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}
