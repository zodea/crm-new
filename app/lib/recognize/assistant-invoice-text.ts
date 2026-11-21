import { isISODateDTO } from '~/types/read-model'

// Adapted from zodea/invoice-recognition-app b97a2e61, src/lib/invoice-parse.js.
export function normalizeInvoiceLabels(text: string): string {
  return text
    .replace(/价[ \t]*税[ \t]*合[ \t]*计/g, '价税合计')
    .replace(/小[ \t]*写/g, '小写')
    .replace(/大[ \t]*写/g, '大写')
    .replace(/开[ \t]*票[ \t]*日[ \t]*期/g, '开票日期')
}

const INVOICE_NUMBER = /发\s*票\s*号\s*码[ \t]*(?:[:：][ \t]*|\n[ \t]*)?(\d(?:[ \t]*\d)*)/g
const RECEIPT_NUMBER = /票\s*据\s*号\s*码[ \t]*(?:[:：][ \t]*|\n[ \t]*)?(\d(?:[ \t]*\d)*)/g

export function extractInvoiceNumber(text: string): string {
  for (const label of [INVOICE_NUMBER, RECEIPT_NUMBER]) {
    const candidates = [...text.matchAll(label)].map(match => match[1]!.replace(/[ \t]/g, ''))
    const valid = new Set(candidates.filter(number => number.length >= 8 && number.length <= 25))
    if (valid.size)
      return valid.size === 1 ? [...valid][0]! : ''
  }
  // CRM also sees PDFs with displaced labels. Only a unique 20-digit fallback is usable.
  const candidates = new Set(text.split('\n').flatMap(line =>
    [...line.replace(/[ \t]/g, '').matchAll(/(?<!\d)\d{20}(?!\d)/g)].map(match => match[0]),
  ))
  return candidates.size === 1 ? [...candidates][0]! : ''
}

const CHINESE_DATE = /(\d(?:[ \t]*\d){3})[ \t]*年[ \t]*(\d(?:[ \t]*\d)?)[ \t]*月[ \t]*(\d(?:[ \t]*\d)?)[ \t]*[日号]/
const NUMERIC_DATE = /(20\d{2})[ \t]*[-/.][ \t]*(\d{1,2})[ \t]*[-/.][ \t]*(\d{1,2})(?!\d)/

export function extractInvoiceDate(text: string): string {
  const labelled = text.match(/开票日期[ \t]*[:：]?[ \t]*([^\n]+)/)?.[1]
  const afterLabel = labelled && (labelled.match(CHINESE_DATE) || labelled.match(NUMERIC_DATE))
  const match = afterLabel || text.match(CHINESE_DATE) || text.match(NUMERIC_DATE)
  if (!match)
    return ''
  const year = Number(match[1]!.replace(/[ \t]/g, ''))
  const month = Number(match[2]!.replace(/[ \t]/g, ''))
  const day = Number(match[3]!.replace(/[ \t]/g, ''))
  const date = [year, month, day].map(value => String(value).padStart(2, '0')).join('-')
  return year >= 2000 && year <= 2100 && isISODateDTO(date) ? date : ''
}
