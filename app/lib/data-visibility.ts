export const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'
export const DATA_VISIBILITY_PENDING_KEY = 'ruihang:workspace-default:pending-include-demo'

export function stageDataVisibilitySwitch(
  storage: Pick<Storage, 'setItem'>,
  includeDemo: boolean,
): void {
  storage.setItem(DATA_VISIBILITY_PENDING_KEY, String(includeDemo))
}

export function consumeDataVisibilitySwitch(
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null,
): boolean | null {
  if (!storage)
    return null
  const pending = storage.getItem(DATA_VISIBILITY_PENDING_KEY)
  if (pending !== 'true' && pending !== 'false')
    return null
  storage.removeItem(DATA_VISIBILITY_PENDING_KEY)
  return pending === 'true'
}

export async function requestDemoWorkspaceAuthorization(
  fetcher: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  try {
    const response = await fetcher('/api/read/demo-workspace', {
      headers: { accept: 'application/json' },
    })
    if (!response.ok)
      return false
    const payload: unknown = await response.json()
    return typeof payload === 'object'
      && payload !== null
      && (payload as { allowed?: unknown }).allowed === true
  }
  catch {
    return false
  }
}
