const CREW_WORKER_PATH = /^\/base\/(?:crew|worker)(?:\/[^/?#]+)?$/

export function validateCrewWorkerReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000 || !value.startsWith('/') || value.startsWith('//'))
    return null
  try {
    const url = new URL(value, 'https://ruihang.local')
    if (url.origin !== 'https://ruihang.local' || !CREW_WORKER_PATH.test(url.pathname))
      return null
    return `${url.pathname}${url.search}${url.hash}`
  }
  catch {
    return null
  }
}
