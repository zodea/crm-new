export type RepositoryFetch = (url: string, options?: object) => Promise<unknown>
export type RepositoryFileFetch = (url: string, options: { responseType: 'blob' }) => Promise<Blob>

export function lazyDomain<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

type AsyncMethod = (...args: never[]) => Promise<unknown>
type AsyncRepository<T> = { [K in keyof T]: AsyncMethod }

// Form adapters spread these methods before any domain has loaded.
export function deferredRepository<T extends AsyncRepository<T>>(load: () => Promise<T>, names: readonly (keyof T & string)[]): T {
  return Object.fromEntries(names.map(name => [name, async (...args: unknown[]) => {
    const repository = await load()
    return Reflect.apply(Reflect.get(repository, name), repository, args)
  }])) as unknown as T
}
