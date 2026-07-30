function normalized(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

export function maskMiddle(
  value: string | null | undefined,
  prefixLength = 4,
  suffixLength = 4,
): string {
  const text = normalized(value)
  if (!text)
    return ''
  if (text.length <= 2)
    return '*'.repeat(text.length)
  const visiblePrefix = Math.min(prefixLength, text.length - 2)
  const visibleSuffix = Math.min(suffixLength, text.length - visiblePrefix - 1)
  return `${text.slice(0, visiblePrefix)} **** ${text.slice(-visibleSuffix)}`
}

export function maskPhone(value: string | null | undefined): string {
  return maskMiddle(value, 3, 4)
}

export function maskIdentifier(value: string | null | undefined): string {
  return maskMiddle(value, 4, 4)
}

export function maskBankAccount(value: string | null | undefined): string {
  return maskMiddle(value, 4, 4)
}
