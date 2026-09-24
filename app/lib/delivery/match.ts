export interface SupplierMatchCandidate {
  id: string
  name: string
  aliases?: readonly string[]
}

export interface SupplierMatch {
  id: string
  name: string
  kind: 'exact' | 'fuzzy'
  score: number
}

export interface ProjectMatchCandidate {
  id: string
  name: string
  aliases?: readonly string[]
}

const DOCUMENT_TAIL_RE = /(?:送货单|销货清单|销售清单|出货单|送货清单|发货单|销售单|对账单|清单|送货)$/
const LEGAL_TAIL_RE = /(?:有限责任公司|股份有限公司|有限公司|分公司|个体工商户|经营部|商行|商店|门市部|合作社|工作室|厂)$/

function normalize(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(DOCUMENT_TAIL_RE, '')
}

function normalizeCompany(value: string): string {
  return normalize(value).replace(LEGAL_TAIL_RE, '')
}

function bigrams(value: string): string[] {
  if (value.length < 2)
    return value ? [value] : []
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2))
}

function dice(left: string, right: string): number {
  if (left === right)
    return 1
  const leftPairs = bigrams(left)
  const rightPairs = bigrams(right)
  if (!leftPairs.length || !rightPairs.length)
    return 0
  const remaining = [...rightPairs]
  let overlap = 0
  for (const pair of leftPairs) {
    const index = remaining.indexOf(pair)
    if (index < 0)
      continue
    overlap += 1
    remaining.splice(index, 1)
  }
  return 2 * overlap / (leftPairs.length + rightPairs.length)
}

function similarity(left: string, right: string): number {
  if (!left || !right)
    return 0
  if (left === right)
    return 1
  if (left.includes(right) || right.includes(left)) {
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length)
    return 0.82 + ratio * 0.18
  }
  return dice(left, right)
}

/** 供应商 OCR 原文 → 唯一高可信主数据候选；低分或歧义一律返回 null。 */
export function matchSupplierName(
  ocrName: string,
  suppliers: readonly SupplierMatchCandidate[],
): SupplierMatch | null {
  const source = normalizeCompany(ocrName)
  if (!source)
    return null

  const ranked = suppliers
    .map((supplier) => {
      const variants = [supplier.name, ...(supplier.aliases ?? [])]
        .map(normalizeCompany)
        .filter(Boolean)
      const score = Math.max(0, ...variants.map(variant => similarity(source, variant)))
      return { id: supplier.id, name: supplier.name, score }
    })
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  const second = ranked[1]
  if (!best || best.score < 0.68)
    return null
  if (second && best.score - second.score < 0.08)
    return null
  return {
    id: best.id,
    name: best.name,
    kind: best.score === 1 ? 'exact' : 'fuzzy',
    score: Math.round(best.score * 1000) / 1000,
  }
}

/** 从 OCR 工地原文与文件名中预选项目；只做明确包含匹配，不做低可信模糊绑定。 */
export function matchProjectText(
  sourceTexts: readonly string[],
  projects: readonly ProjectMatchCandidate[],
): ProjectMatchCandidate | null {
  const source = normalize(sourceTexts.join(' '))
  if (!source)
    return null
  const matches = projects
    .flatMap(project => [project.name, ...(project.aliases ?? [])]
      .map(variant => ({ project, variant: normalize(variant) }))
      .filter(entry => entry.variant && source.includes(entry.variant)))
    .sort((left, right) => right.variant.length - left.variant.length)
  const best = matches[0]
  if (!best || matches.some(match => match.variant.length === best.variant.length && match.project.id !== best.project.id))
    return null
  return best.project
}
