export function useMaterialQuotationRepository() {
  const http = useNuxtApp().$repositories.materialQuotations
  const repository = () => {
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
