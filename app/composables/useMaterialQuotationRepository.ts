import { quotationProblem } from '~/lib/material-quotation/contract'
import { isDesktopRuntime } from '~/lib/platform/runtime'

export function useMaterialQuotationRepository() {
  const http = useNuxtApp().$repositories.materialQuotations
  const repository = () => {
    if (isDesktopRuntime())
      return quotationProblem('unavailable', '独立桌面尚无可核验的报价会话归属，请使用已开放的中央报价入口；本地报价图与原件仍保留')
    return Promise.resolve(http)
  }
  return {
    list: async () => (await repository()).list(),
    context: async () => (await repository()).context(),
    loadForm: async (id: string) => (await repository()).loadForm(id),
    execute: async (request: Parameters<typeof http.execute>[0]) => (await repository()).execute(request),
    resolve: async (commandId: string) => (await repository()).resolve(commandId),
    original: async (id: string, fileId: string, version?: string, signal?: AbortSignal) => (await repository()).original(id, fileId, version, signal),
  }
}
