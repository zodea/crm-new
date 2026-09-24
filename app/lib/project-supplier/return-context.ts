import type { DataOriginDTO } from '../../types/read-model'
import type { ProjectSupplierWorkbenchTab } from './workbench'
import { isDataOriginDTO } from '../../types/read-model'
import { PROJECT_SUPPLIER_WORKBENCH_TABS } from './workbench'

export interface ProjectSupplierReturnContext {
  to: string
  projectId: string
  supplierId: string
  origin: DataOriginDTO
  tab: ProjectSupplierWorkbenchTab
}

const PATH = /^\/project\/([^/]+)\/supplier\/([^/]+)$/
const ALLOWED_QUERY = new Set(['origin', 'tab'])

function control(value: string): boolean {
  return [...value].some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)
}

function decodeSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return decoded.trim() && !control(decoded) ? decoded : null
  }
  catch {
    return null
  }
}

function value(input: unknown): string | null {
  if (typeof input === 'string')
    return input
  if (Array.isArray(input) && input.length === 1 && typeof input[0] === 'string')
    return input[0]
  return null
}

export function validateProjectSupplierReturnTo(input: unknown): ProjectSupplierReturnContext | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 4096
    || !input.startsWith('/') || input.startsWith('//') || input.includes('\\') || control(input)) {
    return null
  }
  let url: URL
  try {
    url = new URL(input, 'https://ruihang.invalid')
  }
  catch {
    return null
  }
  if (url.origin !== 'https://ruihang.invalid' || url.hash
    || [...url.searchParams.keys()].some(key => !ALLOWED_QUERY.has(key))) {
    return null
  }
  const match = PATH.exec(url.pathname)
  const projectId = match ? decodeSegment(match[1] ?? '') : null
  const supplierId = match ? decodeSegment(match[2] ?? '') : null
  const origin = url.searchParams.get('origin') ?? 'real'
  const tab = url.searchParams.get('tab')
  if (!projectId || !supplierId || !isDataOriginDTO(origin)
    || !tab || !PROJECT_SUPPLIER_WORKBENCH_TABS.includes(tab as ProjectSupplierWorkbenchTab)) {
    return null
  }
  const query = new URLSearchParams()
  if (origin !== 'real')
    query.set('origin', origin)
  query.set('tab', tab)
  return {
    to: `/project/${encodeURIComponent(projectId)}/supplier/${encodeURIComponent(supplierId)}?${query.toString()}`,
    projectId,
    supplierId,
    origin,
    tab: tab as ProjectSupplierWorkbenchTab,
  }
}

export function validateProjectSupplierIdentityReturnTo(
  input: unknown,
  target: { entity: 'project' | 'supplier', id: string, origin: DataOriginDTO },
): string | null {
  const context = validateProjectSupplierReturnTo(input)
  if (!context || context.origin !== target.origin)
    return null
  const expectedId = target.entity === 'project' ? context.projectId : context.supplierId
  return expectedId === target.id ? context.to : null
}

export function appendProjectSupplierReturnContext(path: string, returnTo: unknown): string {
  const context = validateProjectSupplierReturnTo(returnTo)
  if (!context)
    return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}projectId=${encodeURIComponent(context.projectId)}&supplierId=${encodeURIComponent(context.supplierId)}&origin=${context.origin}&returnTo=${encodeURIComponent(context.to)}`
}

export function resolveProjectSupplierReturnContext(input: {
  returnTo: unknown
  projectId: unknown
  supplierId: unknown
  actualProjectId: unknown
  actualSupplierId: unknown
}): ProjectSupplierReturnContext | null {
  const context = validateProjectSupplierReturnTo(value(input.returnTo))
  const projectId = value(input.projectId)
  const supplierId = value(input.supplierId)
  const actualProjectId = value(input.actualProjectId)
  const actualSupplierId = value(input.actualSupplierId)
  if (!context || !projectId || !supplierId || !actualProjectId || !actualSupplierId
    || context.projectId !== projectId || context.supplierId !== supplierId
    || context.projectId !== actualProjectId || context.supplierId !== actualSupplierId) {
    return null
  }
  return context
}
