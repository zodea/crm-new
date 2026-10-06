export interface OriginalPrice {
  unit: string
  unitPrice: number | null
  quantity: number | null
}
export interface PriceConversion {
  unit: string
  factor: number
  basis: string
}
/** One original unit equals factor comparison units. Original values never change. */
export function convertOriginalPrice(price: OriginalPrice, conversion?: PriceConversion, invalidMessage = '单位换算须有明确比较单位、正倍数和依据') {
  if (conversion && (!conversion.unit.trim() || !Number.isFinite(conversion.factor) || conversion.factor <= 0 || !conversion.basis.trim()))
    throw new Error(invalidMessage)
  const quantity = price.quantity === null ? null : price.quantity * (conversion?.factor ?? 1)
  const unitPrice = price.unitPrice === null ? null : price.unitPrice / (conversion?.factor ?? 1)
  if ((quantity !== null && !Number.isFinite(quantity)) || (unitPrice !== null && !Number.isFinite(unitPrice)))
    throw new Error('换算结果超出有效数值范围，按原单位查看')
  return { unit: conversion?.unit ?? price.unit, quantity, unitPrice, basis: conversion?.basis ?? null }
}
export interface PriceConditions extends OriginalPrice {
  taxIncluded: boolean | null
  taxRate: number | null
  freight: string | null
  quantityCondition: string | null
  paymentCondition: string | null
  validity: string | null
}
/** A difference requires independently recorded comparable conditions, never inferred tax or freight. */
export function comparablePriceDifference(base: PriceConditions, candidate: PriceConditions, input: PriceConversion & {
  materialBasis: string
}) {
  if (!input.materialBasis.trim())
    return { difference: null, reason: '请先明确核对两行材料规格与等级的依据' }
  const price = convertOriginalPrice(candidate, input)
  if (base.unit !== input.unit || base.unitPrice === null || price.unitPrice === null)
    return { difference: null, reason: '单位未统一或原单价未知' }
  if ([base.taxIncluded, candidate.taxIncluded, base.taxRate, candidate.taxRate].includes(null))
    return { difference: null, reason: '税口径或本行适用税率未知，不能计算价差' }
  if (base.taxIncluded !== candidate.taxIncluded || base.taxRate !== candidate.taxRate)
    return { difference: null, reason: '税口径或本行适用税率不同，不能直接计算价差' }
  for (const field of ['freight', 'quantityCondition', 'paymentCondition', 'validity'] as const) {
    if (!base[field]?.trim() || !candidate[field]?.trim())
      return { difference: null, reason: '运费、数量、付款或有效条件未知，不能计算价差' }
    if (base[field] !== candidate[field])
      return { difference: null, reason: '运费、数量、付款或有效条件不同，不能直接计算价差' }
  }
  const difference = price.unitPrice - base.unitPrice
  if (!Number.isFinite(difference))
    return { difference: null, reason: '价差超出有效范围' }
  return { difference, reason: '已核对材料、单位、税和价格条件；结果仅用于本次原价比较' }
}
