// 穿透件·金额穿透纯逻辑（specs §07）：¥#,##0.00 完整两位小数；
// 0/空/未给目标一律退化普通文本——不做死链。负数（红字冲销）可穿透。
import { formatMoney } from '~/lib/util/money'

export function resolveMoneyLink(input: {
  value?: number | null
  hasTarget: boolean
}): { linkable: boolean, text: string } {
  const text = formatMoney(input.value, { currency: true })
  const linkable = input.hasTarget && input.value != null && Number(input.value) !== 0
  return { linkable, text }
}
