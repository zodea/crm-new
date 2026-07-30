export interface WireMaterialIdentity {
  model: string
  cores: number
  sectionMm2: number
  key: string
  displayName: string
  displaySpec: string
}

export interface WireMaterialIdentityInput {
  name: string
  spec: string
}

function normalizeWireText(value: string): string {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[×✕]/g, 'X')
    .replace(/\s+/g, '')
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseWireSize(value: string, allowBareSection: boolean): {
  cores: number
  sectionMm2: number
} | null {
  const normalized = normalizeWireText(value)
  if (normalized.includes('+'))
    return null

  const multiCore = normalized.match(/(\d+)[X*](\d+(?:\.\d+)?)(?:MM2|平方毫米)?/)
  if (multiCore) {
    const cores = Number(multiCore[1])
    const sectionMm2 = parsePositiveNumber(multiCore[2]!)
    if (Number.isInteger(cores) && cores > 0 && sectionMm2 != null)
      return { cores, sectionMm2 }
  }

  const explicitSection = normalized.match(/(\d+(?:\.\d+)?)(?:MM2|平方毫米)/)
  if (explicitSection) {
    const sectionMm2 = parsePositiveNumber(explicitSection[1]!)
    if (sectionMm2 != null)
      return { cores: 1, sectionMm2 }
  }

  if (allowBareSection) {
    const bareSection = normalized.match(/^(\d+(?:\.\d+)?)$/)
    const sectionMm2 = bareSection ? parsePositiveNumber(bareSection[1]!) : null
    if (sectionMm2 != null)
      return { cores: 1, sectionMm2 }
  }

  return null
}

function parseBareSectionFromName(
  value: string,
  model: SupportedWireModel,
): { cores: number, sectionMm2: number } | null {
  const normalized = value
    .normalize('NFKC')
    .toUpperCase()
    .trim()
  const matched = normalized.match(
    new RegExp(`(?:^|[^A-Z0-9-])${model}\\s+(\\d+(?:\\.\\d+)?)$`),
  )
  const sectionMm2 = matched ? parsePositiveNumber(matched[1]!) : null
  return sectionMm2 == null ? null : { cores: 1, sectionMm2 }
}

function formatSection(value: number): string {
  return String(value)
}

type SupportedWireModel = 'BV' | 'BVR' | 'YJV'

function hasUnsupportedWireModelVariant(searchable: string): boolean {
  return /阻燃|耐火|铠装/.test(searchable)
    || /(?:^|[^A-Z0-9])(?:[A-Z0-9]+-)+(?:BV|BVR|YJV)(?=$|[^A-Z])/.test(searchable)
    || /(?:^|[^A-Z0-9-])YJV-?\d{2,}(?=$|[^0-9.])/.test(searchable)
}

function resolveWireModel(searchable: string): SupportedWireModel | null {
  if (hasUnsupportedWireModelVariant(searchable))
    return null

  if (
    /(?:^|[^A-Z0-9-])BVR(?:$|[^A-Z])/.test(searchable)
    || searchable.includes('铜芯聚氯乙烯绝缘软电线')
  ) {
    return 'BVR'
  }
  if (
    /(?:^|[^A-Z0-9-])YJV(?:$|[^A-Z])/.test(searchable)
    || searchable.includes('铜芯交联聚乙烯绝缘')
  ) {
    return 'YJV'
  }
  if (
    /(?:^|[^A-Z0-9-])BV(?:$|[^A-Z])/.test(searchable)
    || searchable.includes('铜芯聚氯乙烯绝缘电线')
  ) {
    return 'BV'
  }
  return null
}

export function parseWireMaterialIdentity(
  input: WireMaterialIdentityInput,
): WireMaterialIdentity | null {
  const searchable = normalizeWireText(`${input.name} ${input.spec}`)
  const model = resolveWireModel(searchable)
  if (!model)
    return null

  const size = parseWireSize(input.spec, true)
    ?? parseWireSize(input.name, false)
    ?? parseBareSectionFromName(input.name, model)
  if (!size)
    return null

  const section = formatSection(size.sectionMm2)
  return {
    model,
    cores: size.cores,
    sectionMm2: size.sectionMm2,
    key: `wire::${model}::${size.cores}x${section}mm2`,
    displayName: `${model} ${model === 'YJV' ? '电缆' : '电线'}`,
    displaySpec: `${size.cores}×${section} mm²`,
  }
}
