import { formatDate } from '@vueuse/core'

/** HTML date input 使用用户本地日历日，避免 toISOString() 的 UTC 跨日偏移。 */
export function toLocalDateInputValue(date = new Date()): string {
  return formatDate(date, 'YYYY-MM-DD')
}
