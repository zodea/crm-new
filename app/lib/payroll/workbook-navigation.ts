import { rosterId } from '../worker-roster/validation'

/** Only public selection and saved-directory identities may travel between owner pages. */
export function payrollWorkbookReturn(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/subcontract/payroll/workbooks?') || value.includes('\\') || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return null
  try {
    const url = new URL(value, 'https://payroll.invalid')
    if (url.pathname !== '/subcontract/payroll/workbooks' || url.hash || url.searchParams.get('origin') !== 'real')
      return null
    const allowed = ['origin', 'project', 'mode', 'subject', 'roster', 'archive']
    if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1))
      return null
    for (const key of ['project', 'roster', 'archive']) {
      if (url.searchParams.has(key) && !rosterId(url.searchParams.get(key)))
        return null
    }
    if (url.searchParams.has('archive') && !url.searchParams.has('project'))
      return null
    if (url.searchParams.has('mode') && !['leader-cycle', 'project-month'].includes(url.searchParams.get('mode')!))
      return null
    const subject = url.searchParams.get('subject')
    if (subject !== null && (!subject || !/^[\w.~:%/-]{1,4096}$/.test(subject)))
      return null
    return `${url.pathname}${url.search}`
  }
  catch { return null }
}
