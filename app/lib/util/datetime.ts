const SHANGHAI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function formatShanghaiDateTime(
  value: string | Date | null | undefined,
  fallback = '—',
): string {
  if (value == null || value === '')
    return fallback
  const normalizedValue = typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const date = normalizedValue instanceof Date
    ? normalizedValue
    : new Date(normalizedValue)
  if (Number.isNaN(date.getTime()))
    return fallback
  const parts = Object.fromEntries(
    SHANGHAI_DATE_TIME_FORMATTER
      .formatToParts(date)
      .map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}
