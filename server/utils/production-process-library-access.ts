import { PROCESS_LIBRARY_READ_CAPABILITY, PROCESS_LIBRARY_WRITE_CAPABILITY } from '../../app/lib/schedule/process-library-contract'

export const PRODUCTION_PROCESS_LIBRARY_CAPABILITIES = [PROCESS_LIBRARY_READ_CAPABILITY, PROCESS_LIBRARY_WRITE_CAPABILITY] as const
export function isProductionProcessLibraryRequest(method: string, path: string) {
  return (method === 'GET' && /^\/api\/read\/process-libraries(?:\/[a-z0-9][\w-]{2,79})?$/i.test(path))
    || (method === 'POST' && path === '/api/commands/process-libraries')
}
