export type ProductionAccessStatus = { mode: 'development', authenticated: false } | { mode: 'production', authenticated: boolean, purpose: 'production' | 'verification', ownerId?: string, expiresAt?: string }
export function createProductionAccessRepository(fetcher: (url: string, options?: { method: 'POST', body?: Record<string, string> }) => Promise<unknown>) {
  function decode(value: unknown): ProductionAccessStatus {
    if (!value || typeof value !== 'object')
      throw new Error('本机访问状态无效，请重新核对。')
    const data = value as Record<string, unknown>
    if (data.mode === 'development' && data.authenticated === false)
      return { mode: 'development', authenticated: false }
    if (data.mode !== 'production' || typeof data.authenticated !== 'boolean' || !['verification', 'production'].includes(String(data.purpose))
      || (data.authenticated && (typeof data.ownerId !== 'string' || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt))))) {
      throw new Error('本机访问状态无效，请重新核对。')
    }
    return data as ProductionAccessStatus
  }
  return {
    status: async () => decode(await fetcher('/api/auth/status')),
    login: async (accessCode: string) => {
      const status = decode(await fetcher('/api/auth/login', { method: 'POST', body: { accessCode } }))
      if (status.mode !== 'production' || !status.authenticated)
        throw new Error('本机登录尚未成功。')
      return status
    },
    logout: async () => {
      const result = await fetcher('/api/auth/logout', { method: 'POST' })
      if (!result || typeof result !== 'object' || !('authenticated' in result) || result.authenticated !== false)
        throw new Error('退出结果尚未确认，请重试。')
    },
  }
}
